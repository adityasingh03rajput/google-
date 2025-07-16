require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { PythonShell } = require('python-shell');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to check server status
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running', users: Object.keys(users).length });
});

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected users and their stats
const users = {};
const userStats = {};
// Track seen status for each message
const seenStatus = {};

// Milestone and coin settings
const MILESTONES = {
  messages: [10, 50, 100, 200],
  stickers: [10, 25, 50],
  time: [600, 1800, 3600] // seconds: 10min, 30min, 1hr
};
const MILESTONE_REWARDS = {
  messages: 15,
  stickers: 10,
  time: 25
};
const STICKER_COST = 3;

function broadcast(type, data) {
  const message = JSON.stringify({ type, ...data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function sendUserList() {
  const userList = Object.values(users);
  broadcast('user-list', { users: userList });
}

function sendCoinUpdate(username, ws) {
  if (userStats[username]) {
    const msg = JSON.stringify({ type: 'coin-update', username, coins: userStats[username].coins });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      // Fallback to find the user's socket and send
      for (const client of wss.clients) {
        if (client.username === username && client.readyState === WebSocket.OPEN) {
          client.send(msg);
          break;
        }
      }
    }
  }
}

function checkMilestones(username, type) {
  const stats = userStats[username];
  if (!stats) return;
  const milestones = MILESTONES[type] || [];
  const reward = MILESTONE_REWARDS[type] || 0;
  
  milestones.forEach(milestone => {
    const key = `${type}_milestone_${milestone}`;
    let statValue;
    if (type === 'time') {
      statValue = Math.floor((Date.now() - stats.joinTime) / 1000);
    } else {
      statValue = stats[type];
    }
    
    if (statValue >= milestone && !stats[key]) {
      stats[key] = true;
      stats.coins += reward;
      let milestoneText = '';
      if (type === 'time') {
        milestoneText = `Chatted for ${Math.floor(milestone / 60)} minutes!`;
      } else {
        milestoneText = `Sent ${milestone} ${type}!`;
      }
      broadcast('milestone', {
        username,
        milestone: milestoneText,
        coins: stats.coins,
        type,
        value: milestone
      });
      sendCoinUpdate(username);
    }
  });
}

// Time milestone checker (runs every 10s)
setInterval(() => {
  Object.keys(userStats).forEach(username => {
    checkMilestones(username, 'time');
  });
}, 10000);

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (err) {
      console.error('Invalid JSON received:', msg);
      return;
    }
    
    const { username } = ws;

    switch (data.type) {
      case 'join':
        ws.username = data.username;
        users[ws._socket.remotePort] = ws.username;
        if (!userStats[ws.username]) {
          userStats[ws.username] = {
            messages: 0,
            stickers: 0,
            coins: 50, // Initial 50 coins
            joinTime: Date.now()
          };
        }
        broadcast('user-joined', { username: ws.username });
        sendUserList();
        sendCoinUpdate(ws.username, ws);
        break;
      
      case 'text-message':
        if (username && userStats[username]) {
          userStats[username].messages += 1;
          const msgObj = {
            username,
            message: data.message,
            timestamp: new Date().toISOString(),
            id: Date.now() + Math.random().toString(36).slice(2)
          };
          seenStatus[msgObj.id] = [];
          broadcast('text-message', msgObj);
          checkMilestones(username, 'messages');
          sendCoinUpdate(username, ws);
        }
        break;
        
      case 'sticker-message':
        if (username && userStats[username]) {
          if (userStats[username].coins < STICKER_COST) {
            ws.send(JSON.stringify({ type: 'sticker-error', message: `Not enough coins! (${STICKER_COST} required)` }));
            return;
          }
          userStats[username].coins -= STICKER_COST;
          userStats[username].stickers += 1;
          // Note: Python sticker processing is still here. You can remove it if not needed.
          PythonShell.run(
            path.join(__dirname, 'sticker_processor.py'),
            { args: [data.stickerId, username] },
            (err, results) => {
              const stickerData = err ? { stickerCode: '❓' } : JSON.parse(results[0]);
              broadcast('sticker-message', {
                ...stickerData,
                username,
                stickerId: data.stickerId,
                timestamp: new Date().toISOString()
              });
              checkMilestones(username, 'stickers');
              sendCoinUpdate(username, ws);
            }
          );
        }
        break;
        
      case 'seen-message':
        if (username && data.messageId && seenStatus[data.messageId] && !seenStatus[data.messageId].includes(username)) {
          seenStatus[data.messageId].push(username);
          broadcast('message-seen', { messageId: data.messageId, seenBy: username });
        }
        break;
        
      case 'coin-transfer':
        const fromUser = username;
        const toUser = data.to;
        const amount = parseInt(data.amount, 10);
        if (!userStats[fromUser] || !userStats[toUser]) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'User not found.' }));
        } else if (fromUser === toUser) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Cannot send to yourself.' }));
        } else if (isNaN(amount) || amount <= 0) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Invalid amount.' }));
        } else if (userStats[fromUser].coins < amount) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Not enough coins.' }));
        } else {
          userStats[fromUser].coins -= amount;
          userStats[toUser].coins += amount;
          ws.send(JSON.stringify({ type: 'coin-transfer-success', message: `Sent ${amount} coins to ${toUser}.` }));
          sendCoinUpdate(fromUser, ws);
          // Notify recipient
          for (const client of wss.clients) {
            if (client.username === toUser && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'coin-transfer-received', message: `Received ${amount} coins from ${fromUser}.` }));
              sendCoinUpdate(toUser, client);
            }
          }
        }
        break;
        
      case 'request-user-list':
        sendUserList();
        break;
        
      case 'request-coin-balance':
        sendCoinUpdate(username, ws);
        break;
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      delete users[ws._socket.remotePort];
      // Note: userStats are kept for now, so returning users keep their stats.
      broadcast('user-left', { username: ws.username });
      sendUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
