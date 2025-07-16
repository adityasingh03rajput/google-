require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { PythonShell } = require('python-shell');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to check server status
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running', users: Object.keys(users).length });
});

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected users
const users = {};
// Store user stats
const userStats = {};

// Milestone definitions
const MILESTONES = {
  messages: [10, 50, 100, 200],
  stickers: [10, 25, 50],
  time: [600, 1800, 3600] // seconds: 10min, 30min, 1hr
};
const MILESTONE_REWARDS = {
  messages: 15, // coins per message milestone
  stickers: 10,  // coins per sticker milestone
  time: 25      // coins per time milestone
};
const STICKER_COST = 3; // coins required to send a sticker

function checkMilestones(username, type) {
  const stats = userStats[username];
  if (!stats) return;
  let achieved = false;
  if (type === 'messages') {
    MILESTONES.messages.forEach(milestone => {
      if (stats.messages === milestone && !stats[`msg_milestone_${milestone}`]) {
        stats[`msg_milestone_${milestone}`] = true;
        stats.coins += MILESTONE_REWARDS.messages;
        broadcast('milestone', {
          username,
          milestone: `Sent ${milestone} messages!`,
          coins: stats.coins,
          type: 'messages',
          value: milestone
        });
        sendCoinUpdate(username);
        achieved = true;
      }
    });
  } else if (type === 'stickers') {
    MILESTONES.stickers.forEach(milestone => {
      if (stats.stickers === milestone && !stats[`sticker_milestone_${milestone}`]) {
        stats[`sticker_milestone_${milestone}`] = true;
        stats.coins += MILESTONE_REWARDS.stickers;
        broadcast('milestone', {
          username,
          milestone: `Sent ${milestone} stickers!`,
          coins: stats.coins,
          type: 'stickers',
          value: milestone
        });
        sendCoinUpdate(username);
        achieved = true;
      }
    });
  }
  return achieved;
}

// Time milestone checker (runs every 10s)
setInterval(() => {
  Object.keys(userStats).forEach(username => {
    const stats = userStats[username];
    if (!stats) return;
    const seconds = Math.floor((Date.now() - stats.joinTime) / 1000);
    MILESTONES.time.forEach(milestone => {
      if (seconds >= milestone && !stats[`time_milestone_${milestone}`]) {
        stats[`time_milestone_${milestone}`] = true;
        stats.coins += MILESTONE_REWARDS.time;
        broadcast('milestone', {
          username,
          milestone: `Chatted for ${Math.floor(milestone/60)} minutes!`,
          coins: stats.coins,
          type: 'time',
          value: milestone
        });
        sendCoinUpdate(username);
      }
    });
  });
}, 10000);

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
      // fallback: broadcast to all (should be improved for per-user targeting)
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }
  }
}

wss.on('connection', (ws) => {
  let username = null;
  let joinTimestamp = Date.now();

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'join') {
        username = data.username;
        users[ws._socket.remotePort] = username;
        // Initialize user stats
        userStats[username] = userStats[username] || {
          messages: 0,
          stickers: 0,
          coins: 0,
          joinTime: joinTimestamp
        };
        broadcast('user-joined', { username });
        sendUserList();
        sendCoinUpdate(username, ws);
      } else if (data.type === 'text-message') {
        if (username && userStats[username]) {
          userStats[username].messages += 1;
          checkMilestones(username, 'messages');
        }
        broadcast('text-message', {
          username,
          message: data.message,
          timestamp: new Date().toISOString()
        });
        sendCoinUpdate(username, ws);
      } else if (data.type === 'sticker-message') {
        if (username && userStats[username]) {
          if (userStats[username].coins < STICKER_COST) {
            // Not enough coins
            ws.send(JSON.stringify({ type: 'sticker-error', message: `Not enough coins to send a sticker! (${STICKER_COST} required)` }));
            return;
          }
          userStats[username].stickers += 1;
          userStats[username].coins -= STICKER_COST;
          checkMilestones(username, 'stickers');
        }
        // Process with Python
        PythonShell.run(
          path.join(__dirname, 'sticker_processor.py'),
          {
            mode: 'text',
            pythonOptions: ['-u'],
            args: [data.stickerId, username]
          },
          (err, results) => {
            if (err) {
              broadcast('sticker-message', {
                username,
                stickerId: data.stickerId,
                stickerCode: '❓',
                timestamp: new Date().toISOString()
              });
            } else {
              const stickerData = JSON.parse(results[0]);
              broadcast('sticker-message', stickerData);
            }
          }
        );
        sendCoinUpdate(username, ws);
      } else if (data.type === 'request-user-list') {
        sendUserList();
      } else if (data.type === 'request-coin-balance') {
        sendCoinUpdate(username, ws);
      } else if (data.type === 'coin-transfer') {
        // data: { type: 'coin-transfer', to: 'recipient', amount: 10 }
        const fromUser = username;
        const toUser = data.to;
        const amount = parseInt(data.amount, 10);
        if (!userStats[fromUser] || !userStats[toUser]) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'User not found.' }));
          return;
        }
        if (fromUser === toUser) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Cannot transfer coins to yourself.' }));
          return;
        }
        if (isNaN(amount) || amount <= 0) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Invalid amount.' }));
          return;
        }
        if (userStats[fromUser].coins < amount) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Not enough coins.' }));
          return;
        }
        userStats[fromUser].coins -= amount;
        userStats[toUser].coins += amount;
        ws.send(JSON.stringify({ type: 'coin-transfer-success', message: `Transferred ${amount} coins to ${toUser}.` }));
        sendCoinUpdate(fromUser, ws);
        // Notify recipient if online
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            // Find the username for this client
            let clientName = null;
            for (const port in users) {
              if (client._socket.remotePort == port) clientName = users[port];
            }
            if (clientName === toUser) {
              client.send(JSON.stringify({ type: 'coin-transfer-received', message: `You received ${amount} coins from ${fromUser}.` }));
              sendCoinUpdate(toUser, client);
            }
          }
        });
      }
    } catch (err) {
      console.error('Message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (username) {
      broadcast('user-left', { username });
      // Remove user by port
      delete users[ws._socket.remotePort];
      sendUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
