const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const uuid = require('uuid'); // For generating unique message IDs

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket chat server is running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// User data storage
const users = new Map(); // username -> { ws, coins }
const stickers = {
  happy: '😊',
  sad: '😢',
  thumbsup: '👍',
  heart: '❤️',
  laugh: '😂'
};
const STICKER_COST = 3;
const INITIAL_COINS = 10;
const MILESTONES = [
  { threshold: 5, message: "First steps!", coins: 5 },
  { threshold: 20, message: "Getting popular!", coins: 10 },
  { threshold: 50, message: "Chat superstar!", coins: 20 }
];

// Broadcast to all clients
function broadcast(data, excludeUsername = null) {
  const message = JSON.stringify(data);
  users.forEach((user, username) => {
    if (username !== excludeUsername && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(message);
    }
  });
}

// Send user list to all clients
function updateUserList() {
  const userList = Array.from(users.keys());
  broadcast({ type: 'user-list', users: userList });
}

// Check for milestones when coins change
function checkMilestones(username, newCoinCount) {
  const user = users.get(username);
  if (!user) return;

  for (const milestone of MILESTONES) {
    if (newCoinCount >= milestone.threshold && 
        (!user.milestonesReached || !user.milestonesReached.includes(milestone.threshold))) {
      // Mark this milestone as reached
      if (!user.milestonesReached) user.milestonesReached = [];
      user.milestonesReached.push(milestone.threshold);
      
      // Award bonus coins
      user.coins += milestone.coins;
      
      // Notify user
      const ws = user.ws;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'milestone',
          milestone: milestone.message,
          coins: milestone.coins,
          username: username
        }));
        
        // Also send coin update
        ws.send(JSON.stringify({
          type: 'coin-update',
          coins: user.coins,
          username: username
        }));
      }
      break; // Only notify for the highest reached milestone
    }
  }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true);
  let username = parameters.query.username;
  
  // Generate random username if not provided
  if (!username) {
    username = `User${Math.floor(Math.random() * 1000)}`;
  }
  
  // Check if username is already taken
  if (users.has(username)) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Username already taken. Please choose another.' 
    }));
    ws.close();
    return;
  }
  
  // Register new user
  users.set(username, { 
    ws, 
    coins: INITIAL_COINS,
    milestonesReached: []
  });
  
  // Send initial coin balance
  ws.send(JSON.stringify({
    type: 'coin-update',
    coins: INITIAL_COINS,
    username: username
  }));
  
  // Notify all users about new connection
  broadcast({ 
    type: 'user-joined', 
    username 
  });
  
  // Send updated user list
  updateUserList();
  
  // Message handler
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'text-message':
          // Broadcast text message to all users
          const textMsg = {
            type: 'text-message',
            username,
            message: data.message,
            timestamp: Date.now(),
            id: uuid.v4()
          };
          broadcast(textMsg);
          break;
          
        case 'sticker-message':
          // Handle sticker message (with coin cost)
          const user = users.get(username);
          if (user.coins >= STICKER_COST) {
            user.coins -= STICKER_COST;
            
            // Send coin update to sender
            ws.send(JSON.stringify({
              type: 'coin-update',
              coins: user.coins,
              username
            }));
            
            // Broadcast sticker to all users
            broadcast({
              type: 'sticker-message',
              username,
              stickerCode: stickers[data.stickerId] || '❓',
              timestamp: Date.now()
            });
            
            // Check for milestones
            checkMilestones(username, user.coins);
          } else {
            ws.send(JSON.stringify({
              type: 'sticker-error',
              message: `Not enough coins! Stickers cost ${STICKER_COST} coins.`
            }));
          }
          break;
          
        case 'coin-transfer':
          // Handle coin transfer between users
          const fromUser = users.get(username);
          const toUser = users.get(data.to);
          
          if (!toUser) {
            ws.send(JSON.stringify({
              type: 'coin-transfer-error',
              message: `User "${data.to}" not found.`
            }));
            return;
          }
          
          if (data.amount <= 0) {
            ws.send(JSON.stringify({
              type: 'coin-transfer-error',
              message: 'Amount must be positive.'
            }));
            return;
          }
          
          if (fromUser.coins < data.amount) {
            ws.send(JSON.stringify({
              type: 'coin-transfer-error',
              message: 'Not enough coins for this transfer.'
            }));
            return;
          }
          
          // Perform transfer
          fromUser.coins -= data.amount;
          toUser.coins += data.amount;
          
          // Update sender
          ws.send(JSON.stringify({
            type: 'coin-update',
            coins: fromUser.coins,
            username
          }));
          
          ws.send(JSON.stringify({
            type: 'coin-transfer-success',
            message: `Sent ${data.amount} coins to ${data.to}.`
          }));
          
          // Update recipient if they're online
          if (toUser.ws.readyState === WebSocket.OPEN) {
            toUser.ws.send(JSON.stringify({
              type: 'coin-update',
              coins: toUser.coins,
              username: data.to
            }));
            
            toUser.ws.send(JSON.stringify({
              type: 'coin-transfer-received',
              message: `Received ${data.amount} coins from ${username}.`
            }));
          }
          
          // Check milestones for both users
          checkMilestones(username, fromUser.coins);
          checkMilestones(data.to, toUser.coins);
          break;
          
        case 'request-user-list':
          // Send current user list to requester
          ws.send(JSON.stringify({
            type: 'user-list',
            users: Array.from(users.keys())
          }));
          break;
          
        case 'seen-message':
          // Handle message seen notification
          if (data.messageId && users.has(data.seenBy)) {
            broadcast({
              type: 'message-seen',
              messageId: data.messageId,
              seenBy: data.seenBy
            }, username);
          }
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });
  
  // Clean up on connection close
  ws.on('close', () => {
    users.delete(username);
    broadcast({ 
      type: 'user-left', 
      username 
    });
    updateUserList();
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
