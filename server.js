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

wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'join') {
        username = data.username;
        users[ws._socket.remotePort] = username;
        broadcast('user-joined', { username });
        sendUserList();
      } else if (data.type === 'text-message') {
        broadcast('text-message', {
          username,
          message: data.message,
          timestamp: new Date().toISOString()
        });
      } else if (data.type === 'sticker-message') {
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
      } else if (data.type === 'request-user-list') {
        sendUserList();
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
