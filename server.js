const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);

// Serve static files (if any)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve user dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- Placeholder for API endpoints ---
// app.post('/api/...', ...)
// app.get('/api/...', ...)

// --- Placeholder for Socket.io integration ---
// const { Server } = require('socket.io');
// const io = new Server(server);
// io.on('connection', (socket) => { ... });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`It's Over server running at http://localhost:${PORT}`);
});
