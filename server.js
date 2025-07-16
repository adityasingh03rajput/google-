// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { PythonShell } = require('python-shell');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Store connected users
const users = {};

// Serve static files
app.use(express.static('public'));

// Socket.io connection
io.on('connection', (socket) => {
    console.log('New user connected');
    
    // Handle new user joining
    socket.on('join', (username) => {
        users[socket.id] = username;
        socket.broadcast.emit('user-joined', username);
    });
    
    // Handle text messages
    socket.on('text-message', (message) => {
        const username = users[socket.id];
        io.emit('text-message', { username, message });
    });
    
    // Handle sticker messages
    socket.on('sticker-message', (stickerId) => {
        const username = users[socket.id];
        
        // Optional: Process with Python
        let options = {
            mode: 'text',
            pythonOptions: ['-u'],
            scriptPath: './python_logic',
            args: [stickerId, username]
        };
        
        PythonShell.run('sticker_processor.py', options, (err, results) => {
            if (err) throw err;
            // Results contains processed sticker data
            io.emit('sticker-message', { 
                username, 
                stickerId,
                processedData: results[0] 
            });
        });
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        const username = users[socket.id];
        delete users[socket.id];
        socket.broadcast.emit('user-left', username);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
