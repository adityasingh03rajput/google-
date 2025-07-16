require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Database setup
const db = new sqlite3.Database('./dating-game.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT UNIQUE,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT,
      coins INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      receiver_id INTEGER,
      message TEXT,
      coins_sent INTEGER DEFAULT 0,
      message_type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER,
      user2_id INTEGER,
      match_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user1_id) REFERENCES users(id),
      FOREIGN KEY(user2_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      milestone_type TEXT,
      count INTEGER,
      achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS coin_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      receiver_id INTEGER,
      amount INTEGER,
      transaction_type TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// Database helper functions
const dbHelpers = {
  getUserById: (id, callback) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], callback);
  },
  getUserByAnonymousId: (anonymousId, callback) => {
    db.get('SELECT * FROM users WHERE anonymous_id = ?', [anonymousId], callback);
  },
  createUser: (user, callback) => {
    const { anonymous_id, username, email, password } = user;
    db.run(
      'INSERT INTO users (anonymous_id, username, email, password) VALUES (?, ?, ?, ?)',
      [anonymous_id, username, email, password],
      function(err) {
        callback(err, this.lastID);
      }
    );
  },
  saveMessage: (message, callback) => {
    const { sender_id, receiver_id, message: content, coins_sent, message_type } = message;
    db.run(
      'INSERT INTO messages (sender_id, receiver_id, message, coins_sent, message_type) VALUES (?, ?, ?, ?, ?)',
      [sender_id, receiver_id, content, coins_sent, message_type],
      callback
    );
  },
  updateUserCoins: (userId, newBalance, callback) => {
    db.run('UPDATE users SET coins = ? WHERE id = ?', [newBalance, userId], callback);
  },
  addCoinTransaction: (transaction, callback) => {
    const { sender_id, receiver_id, amount, transaction_type, message } = transaction;
    db.run(
      'INSERT INTO coin_transactions (sender_id, receiver_id, amount, transaction_type, message) VALUES (?, ?, ?, ?, ?)',
      [sender_id, receiver_id, amount, transaction_type, message],
      callback
    );
  }
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const anonymous_id = uuidv4();
    
    dbHelpers.createUser({
      anonymous_id,
      username,
      email,
      password: hashedPassword
    }, (err, userId) => {
      if (err) {
        return res.status(400).json({ error: 'Registration failed' });
      }
      res.json({ 
        success: true,
        user: { id: userId, anonymous_id, username, email }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Registration Endpoint
app.post('/api/admin/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    // Check if admin already exists
    db.get('SELECT * FROM admins WHERE email = ? OR username = ?', [email, username], async (err, admin) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (admin) {
        return res.status(400).json({ error: 'Admin with this email or username already exists' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      db.run(
        'INSERT INTO admins (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Registration failed' });
          }
          res.json({ 
            success: true,
            admin: { id: this.lastID, username, email }
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Login Endpoint
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    db.get('SELECT * FROM admins WHERE email = ?', [email], async (err, admin) => {
      if (err || !admin) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = jwt.sign(
        { adminId: admin.id, email: admin.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({
        token,
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware to verify admin JWT
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.admin = decoded;
    next();
  });
}

// Admin creates a new user
app.post('/api/admin/create-user', verifyAdminToken, async (req, res) => {
  try {
    const { username, email, password, anonymous_id } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userAnonymousId = anonymous_id && anonymous_id.trim() ? anonymous_id.trim() : uuidv4();
    dbHelpers.createUser({
      anonymous_id: userAnonymousId,
      username,
      email,
      password: hashedPassword
    }, (err, userId) => {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'User ID or email already exists' });
        }
        return res.status(400).json({ error: 'User registration failed' });
      }
      res.json({
        success: true,
        user: { id: userId, anonymous_id: userAnonymousId, username, email }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign(
        { userId: user.id, anonymousId: user.anonymous_id }, 
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({ 
        token,
        user: {
          id: user.id,
          anonymous_id: user.anonymous_id,
          username: user.username,
          email: user.email,
          coins: user.coins
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    for (const [userId, connection] of activeConnections.entries()) {
      if (connection === ws) {
        activeConnections.delete(userId);
        console.log(`User ${userId} disconnected`);
        broadcastUserStatus(userId, 'offline');
        break;
      }
    }
  });
});

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'join':
      if (!data.token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        return;
      }

      try {
        const decoded = jwt.verify(data.token, JWT_SECRET);
        activeConnections.set(decoded.userId, ws);
        ws.userId = decoded.userId;
        broadcastUserStatus(decoded.userId, 'online');
        ws.send(JSON.stringify({ 
          type: 'welcome',
          message: 'Connected successfully',
          userId: decoded.userId
        }));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      }
      break;

    case 'send-message':
      if (!ws.userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }

      const messageData = {
        senderId: ws.userId,
        receiverId: data.receiverId,
        message: data.message,
        coinsSent: data.coinsSent || 0,
        messageType: data.messageType || 'text'
      };

      dbHelpers.saveMessage(messageData, (err) => {
        if (err) {
          console.error('Error saving message:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to send message' }));
          return;
        }

        // Notify receiver
        const receiverWs = activeConnections.get(data.receiverId);
        if (receiverWs) {
          receiverWs.send(JSON.stringify({
            type: 'new-message',
            ...messageData,
            timestamp: new Date().toISOString()
          }));
        }

        ws.send(JSON.stringify({
          type: 'message-sent',
          message: 'Message delivered',
          timestamp: new Date().toISOString()
        }));
      });
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💖 WebSocket server ready at ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close();
  server.close(() => {
    process.exit(0);
  });
});
