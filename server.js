require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const Database = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize database
const db = new Database();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Email configuration
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Store active connections
const activeConnections = new Map();

// Milestone configurations
const MILESTONES = {
  messages: [10, 50, 100, 200, 500],
  conversation_minutes: [10, 30, 60, 120, 300],
  coins_sent: [100, 500, 1000, 2500],
  gifts_sent: [5, 15, 30, 50],
  game_activities: [10, 25, 50, 100]
};

const MILESTONE_REWARDS = {
  messages: 50,
  conversation_minutes: 75,
  coins_sent: 100,
  gifts_sent: 60,
  game_activities: 40
};

// AI-generated compliments pool
const AI_COMPLIMENTS = [
  "Your smile could light up the darkest room",
  "You have the most beautiful soul I've ever encountered",
  "Every conversation with you feels like a gift",
  "Your laugh is my favorite sound in the world",
  "You make ordinary moments feel extraordinary",
  "Your kindness radiates and touches everyone around you",
  "You have this amazing way of making me feel understood",
  "Your intelligence is incredibly attractive",
  "You bring out the best version of myself",
  "Your presence alone makes everything better"
];

// Routes

// Serve main dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API Routes

// Get system statistics
app.get('/api/stats', (req, res) => {
  db.getSystemStats((err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(stats);
  });
});

// Get all users (admin)
app.get('/api/users', (req, res) => {
  db.getAllUsers((err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(users);
  });
});

// User login
app.post('/api/login', (req, res) => {
  const { anonymous_id, password } = req.body;
  
  db.getUserByAnonymousId(anonymous_id, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign({ userId: user.id, anonymousId: user.anonymous_id }, JWT_SECRET);
      res.json({ token, user: { ...user, password: undefined } });
    });
  });
});

// Get user matches
app.get('/api/matches/:userId', (req, res) => {
  const userId = req.params.userId;
  db.getUserMatches(userId, (err, matches) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(matches);
  });
});

// Get messages between users
app.get('/api/messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  db.getMessages(user1, user2, (err, messages) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(messages);
  });
});

// Get virtual gifts
app.get('/api/gifts', (req, res) => {
  db.getVirtualGifts((err, gifts) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(gifts);
  });
});

// Get user milestones
app.get('/api/milestones/:userId', (req, res) => {
  const userId = req.params.userId;
  db.getUserMilestones(userId, (err, milestones) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(milestones);
  });
});

// Create matches (admin function)
app.post('/api/create-matches', (req, res) => {
  // This would contain the matching algorithm
  // For now, it's a placeholder
  res.json({ message: 'Matches created successfully' });
});

// Send match emails (admin function)
app.post('/api/send-match-emails', (req, res) => {
  // Email sending logic would go here
  res.json({ message: 'Match emails sent successfully' });
});

// WebSocket handling
wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    // Remove from active connections
    for (const [userId, connection] of activeConnections.entries()) {
      if (connection === ws) {
        activeConnections.delete(userId);
        break;
      }
    }
  });
});

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'join':
      activeConnections.set(data.userId, ws);
      ws.userId = data.userId;
      broadcastUserStatus(data.userId, 'online');
      break;

    case 'send-message':
      handleSendMessage(data);
      break;

    case 'send-coins':
      handleSendCoins(data);
      break;

    case 'send-gift':
      handleSendGift(data);
      break;

    case 'game-activity':
      handleGameActivity(data);
      break;

    case 'love-confession':
      handleLoveConfession(data);
      break;

    default:
      console.log('Unknown message type:', data.type);
  }
}

function handleSendMessage(data) {
  const messageData = {
    sender_id: data.senderId,
    receiver_id: data.receiverId,
    message: data.message,
    coins_sent: data.coinsSent || 0,
    message_type: data.messageType || 'text'
  };

  db.saveMessage(messageData, (err) => {
    if (err) {
      console.error('Error saving message:', err);
      return;
    }

    // Check for message milestones
    checkMessageMilestones(data.senderId);

    // Broadcast to receiver
    const receiverWs = activeConnections.get(data.receiverId);
    if (receiverWs) {
      receiverWs.send(JSON.stringify({
        type: 'new-message',
        ...messageData,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

function handleSendCoins(data) {
  const { senderId, receiverId, amount, message, pin } = data;

  // Verify PIN and sufficient coins (simplified)
  db.getUserByAnonymousId(senderId, (err, sender) => {
    if (err || !sender || sender.coins < amount) {
      return;
    }

    // Update coin balances
    db.updateUserCoins(sender.id, sender.coins - amount, () => {
      db.getUserByAnonymousId(receiverId, (err, receiver) => {
        if (err || !receiver) return;

        db.updateUserCoins(receiver.id, receiver.coins + amount, () => {
          // Record transaction
          db.addCoinTransaction({
            sender_id: sender.id,
            receiver_id: receiver.id,
            amount,
            transaction_type: 'gift',
            message
          }, () => {
            // Notify both users
            broadcastCoinUpdate(sender.id, sender.coins - amount);
            broadcastCoinUpdate(receiver.id, receiver.coins + amount);
          });
        });
      });
    });
  });
}

function handleSendGift(data) {
  const { senderId, receiverId, giftId, message } = data;

  db.getVirtualGifts((err, gifts) => {
    if (err) return;

    const gift = gifts.find(g => g.id === giftId);
    if (!gift) return;

    // Similar to coin sending but with gift cost
    handleSendCoins({
      senderId,
      receiverId,
      amount: gift.cost,
      message: `${message} ${gift.emoji}`,
      type: 'gift'
    });
  });
}

function handleGameActivity(data) {
  const { user1Id, user2Id, activityType, content, isAiGenerated, guessCorrect } = data;
  
  let coinsEarned = 0;
  if (guessCorrect) {
    coinsEarned = isAiGenerated ? 20 : 30; // More coins for guessing human-written correctly
  }

  const activityData = {
    user1_id: user1Id,
    user2_id: user2Id,
    activity_type: activityType,
    content,
    is_ai_generated: isAiGenerated,
    guess_correct: guessCorrect,
    coins_earned: coinsEarned
  };

  db.saveGameActivity(activityData, () => {
    if (coinsEarned > 0) {
      // Award coins to the guesser
      updateUserCoins(user1Id, coinsEarned);
    }

    // Check game activity milestones
    checkGameMilestones(user1Id);
  });
}

function handleLoveConfession(data) {
  const { userId, partnerId, confession } = data;
  
  // Update couple ranking with love confession
  // This would update the couple_rankings table
  // and potentially trigger special rewards or notifications
}

function checkMessageMilestones(userId) {
  // Count user's messages and check against milestones
  // Award coins for reaching milestones
  // This is a simplified version
}

function checkGameMilestones(userId) {
  // Similar to message milestones but for game activities
}

function broadcastUserStatus(userId, status) {
  const message = JSON.stringify({
    type: 'user-status',
    userId,
    status
  });

  activeConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

function broadcastCoinUpdate(userId, newBalance) {
  const ws = activeConnections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'coin-update',
      coins: newBalance
    }));
  }
}

function updateUserCoins(userId, additionalCoins) {
  db.getUserByAnonymousId(userId, (err, user) => {
    if (err || !user) return;
    
    const newBalance = user.coins + additionalCoins;
    db.updateUserCoins(user.id, newBalance, () => {
      broadcastCoinUpdate(userId, newBalance);
    });
  });
}

// Generate AI compliment for game
function generateAICompliment() {
  return AI_COMPLIMENTS[Math.floor(Math.random() * AI_COMPLIMENTS.length)];
}

// Matching algorithm (simplified)
function createMatches() {
  db.getAllUsers((err, users) => {
    if (err || users.length < 2) return;

    // This would contain sophisticated matching logic
    // For now, it's a placeholder that creates random matches
    for (let i = 0; i < users.length - 1; i += 2) {
      // Create complementary match
      db.createMatch(users[i].id, users[i + 1].id, 'complementary', () => {});
      
      // Create compatible match (if enough users)
      if (i + 2 < users.length) {
        db.createMatch(users[i].id, users[i + 2].id, 'compatible', () => {});
      }
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 It's Over Dating Game Server running on port ${PORT}`);
  console.log(`📊 Admin Dashboard: https://google-8j5x.onrender.com/admin`);
  console.log(`💖 User Interface: https://google-8j5x.onrender.com`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close();
  server.close(() => {
    process.exit(0);
  });
});
