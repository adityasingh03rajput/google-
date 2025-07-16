require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('./database');

const app = express();
const server = http.createServer(app);
const db = new Database();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use(express.json());
app.use(express.static(path.join(__dirname)));
// Improved CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running', time: new Date().toISOString() });
});

// Root endpoint for API status
app.get('/', (req, res) => {
  res.json({
    message: "Welcome to It's Over API!",
    status: 'ok',
    endpoints: [
      '/api/register',
      '/api/login',
      '/api/admin/register',
      '/api/admin/login',
      '/api/admin/create-user',
      '/api/admin/users',
      '/api/admin/stats',
      '/api/matches/:userId',
      '/api/gifts',
      '/api/milestones/:userId',
      '/api/messages/:userId/:partnerId',
      '/health'
    ]
  });
});

// Admins table setup is now in database.js
// Serve admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API: Admin Registration
app.post('/api/admin/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    db.db.get('SELECT * FROM admins WHERE email = ? OR username = ?', [email, username], async (err, admin) => {
      if (err) {
        console.error('DB error during admin registration:', err);
        return res.status(500).json({ error: 'Database error', details: err.message });
      }
      if (admin) {
        return res.status(400).json({ error: 'Admin with this email or username already exists' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      db.db.run(
        'INSERT INTO admins (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
          if (err) {
            console.error('DB error during admin registration (insert):', err);
            return res.status(500).json({ error: 'Registration failed', details: err.message });
          }
          res.json({ success: true, admin: { id: this.lastID, username, email } });
        }
      );
    });
  } catch (error) {
    console.error('Server error during admin registration:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API: Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    db.db.get('SELECT * FROM admins WHERE email = ?', [email], async (err, admin) => {
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
    res.status(500).json({ error: 'Server error', details: error.message });
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

// API: Admin creates a new user
app.post('/api/admin/create-user', verifyAdminToken, async (req, res) => {
  try {
    const { name, email, password, anonymous_id, age, gender, location, bio, qualities, desired_qualities } = req.body;
    if (!name || !email || !password || !anonymous_id) {
      return res.status(400).json({ error: 'All fields (name, email, user ID, password) are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.createUser({
      name,
      email,
      password: hashedPassword,
      anonymous_id,
      age,
      gender,
      location,
      bio,
      qualities,
      desired_qualities
    }, function(err) {
      if (err) {
        console.error('DB error during user creation:', err);
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'User ID or email already exists', details: err.message });
        }
        return res.status(400).json({ error: 'User registration failed', details: err.message });
      }
      res.json({ success: true, user: { id: this.lastID, anonymous_id, name, email } });
    });
  } catch (error) {
    console.error('Server error during user creation:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API: User self-registration
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, anonymous_id, age, gender, location, bio, qualities, desired_qualities } = req.body;
    if (!name || !email || !password || !anonymous_id) {
      return res.status(400).json({ error: 'All fields (name, email, user ID, password) are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.createUser({
      name,
      email,
      password: hashedPassword,
      anonymous_id,
      age,
      gender,
      location,
      bio,
      qualities,
      desired_qualities
    }, function(err) {
      if (err) {
        console.error('DB error during user registration:', err);
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'User ID or email already exists', details: err.message });
        }
        return res.status(400).json({ error: 'User registration failed', details: err.message });
      }
      res.json({ success: true, user: { id: this.lastID, anonymous_id, name, email } });
    });
  } catch (error) {
    console.error('Server error during user registration:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API: User login
app.post('/api/login', async (req, res) => {
  try {
    const { anonymous_id, password } = req.body;
    if (!anonymous_id || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    db.getUserByAnonymousId(anonymous_id, async (err, user) => {
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
          name: user.name,
          email: user.email,
          coins: user.coins
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API: Get all users (admin only)
app.get('/api/admin/users', verifyAdminToken, (req, res) => {
  db.getAllUsers((err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users', details: err.message });
    }
    res.json(users);
  });
});

// API: Get system stats (admin only)
app.get('/api/admin/stats', verifyAdminToken, (req, res) => {
  db.getSystemStats((err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
    }
    res.json(stats);
  });
});

// API: Get matches for a user
app.get('/api/matches/:userId', (req, res) => {
  const userId = req.params.userId;
  db.getUserMatches(userId, (err, matches) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch matches', details: err.message });
    }
    res.json(matches);
  });
});

// API: Get virtual gifts
app.get('/api/gifts', (req, res) => {
  db.getVirtualGifts((err, gifts) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch gifts', details: err.message });
    }
    res.json(gifts);
  });
});

// API: Get milestones for a user
app.get('/api/milestones/:userId', (req, res) => {
  const userId = req.params.userId;
  db.getUserMilestones(userId, (err, milestones) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch milestones', details: err.message });
    }
    res.json(milestones);
  });
});

// API: Get messages between two users
app.get('/api/messages/:userId/:partnerId', (req, res) => {
  const userId = req.params.userId;
  const partnerId = req.params.partnerId;
  db.getMessages(userId, partnerId, (err, messages) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
    }
    res.json(messages);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close();
  server.close(() => {
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 API root: http://localhost:${PORT}/`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
});
