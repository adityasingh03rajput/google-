require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { PythonShell } = require('python-shell');
const path = require('path');

const app = express();

// Add CORS middleware for API endpoints
const cors = require('cors');
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  }
});

// Store connected users
const users = {};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to check server status
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running', users: Object.keys(users).length });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // Send user list to a specific socket
  function sendUserList() {
    io.emit('user-list', Object.values(users));
  }

  // Handle user list request
  socket.on('request-user-list', () => {
    sendUserList();
  });

  // Handle new user joining
  socket.on('join', (username) => {
    users[socket.id] = username;
    io.emit('user-joined', username);
    sendUserList();
  });

  // Handle text messages
  socket.on('text-message', (message) => {
    const username = users[socket.id];
    io.emit('text-message', { username, message, timestamp: new Date().toISOString() });
  });

  // Handle sticker messages
  socket.on('sticker-message', (stickerId) => {
    const username = users[socket.id];
    
    // Process with Python (optional)
    PythonShell.run(
      path.join(__dirname, 'sticker_processor.py'),
      {
        mode: 'text',
        pythonOptions: ['-u'],
        args: [stickerId, username]
      },
      (err, results) => {
        if (err) {
          console.error("Python error:", err);
          io.emit('sticker-message', { 
            username, 
            stickerId,
            stickerCode: '❓', // Fallback sticker
            timestamp: new Date().toISOString()
          });
        } else {
          const stickerData = JSON.parse(results[0]);
          io.emit('sticker-message', stickerData);
        }
      }
    );
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const username = users[socket.id];
    if (username) {
      delete users[socket.id];
      io.emit('user-left', username);
      sendUserList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at ${process.env.SERVER_URL || `http://localhost:${PORT}`}`);
});
