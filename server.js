// Simple WebSocket chat server for safe.html
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ port: 3000 });

const users = new Map(); // username -> { ws, coins }
const messages = []; // { id, username, message, timestamp, type, stickerCode }
const INITIAL_COINS = 10;
const STICKER_COST = 3;
const stickers = {
  happy: '😊',
  sad: '😢',
  thumbsup: '👍',
  heart: '❤️',
  laugh: '😂',
};

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const [username, user] of users.entries()) {
    if (user.ws.readyState === WebSocket.OPEN && username !== exclude) {
      user.ws.send(msg);
    }
  }
}

function updateUserList() {
  broadcast({ type: 'user-list', users: Array.from(users.keys()) });
}

wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    switch (data.type) {
      case 'join': {
        if (!data.username || users.has(data.username)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid or duplicate username.' }));
          ws.close();
          return;
        }
        username = data.username;
        users.set(username, { ws, coins: INITIAL_COINS });
        ws.send(JSON.stringify({ type: 'coin-update', coins: INITIAL_COINS, username }));
        updateUserList();
        // Send chat history
        ws.send(JSON.stringify({ type: 'chat-history', messages }));
        broadcast({ type: 'user-joined', username }, username);
        break;
      }
      case 'text-message': {
        if (!username) return;
        const message = {
          type: 'text-message',
          id: uuidv4(),
          username,
          message: data.message,
          timestamp: Date.now(),
        };
        messages.push(message);
        broadcast(message);
        break;
      }
      case 'sticker-message': {
        if (!username) return;
        const user = users.get(username);
        if (user.coins < STICKER_COST) {
          ws.send(JSON.stringify({ type: 'sticker-error', message: `Not enough coins! Stickers cost ${STICKER_COST} coins.` }));
          return;
        }
        user.coins -= STICKER_COST;
        ws.send(JSON.stringify({ type: 'coin-update', coins: user.coins, username }));
        const stickerCode = stickers[data.stickerId] || '❓';
        const stickerMsg = {
          type: 'sticker-message',
          id: uuidv4(),
          username,
          stickerCode,
          timestamp: Date.now(),
        };
        messages.push(stickerMsg);
        broadcast(stickerMsg);
        break;
      }
      case 'coin-transfer': {
        if (!username) return;
        const fromUser = users.get(username);
        const toUser = users.get(data.to);
        const amount = parseInt(data.amount, 10);
        if (!toUser) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: `User "${data.to}" not found.` }));
          return;
        }
        if (isNaN(amount) || amount <= 0) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Amount must be positive.' }));
          return;
        }
        if (fromUser.coins < amount) {
          ws.send(JSON.stringify({ type: 'coin-transfer-error', message: 'Not enough coins for this transfer.' }));
          return;
        }
        fromUser.coins -= amount;
        toUser.coins += amount;
        ws.send(JSON.stringify({ type: 'coin-update', coins: fromUser.coins, username }));
        ws.send(JSON.stringify({ type: 'coin-transfer-success', message: `Sent ${amount} coins to ${data.to}.` }));
        if (toUser.ws.readyState === WebSocket.OPEN) {
          toUser.ws.send(JSON.stringify({ type: 'coin-update', coins: toUser.coins, username: data.to }));
          toUser.ws.send(JSON.stringify({ type: 'coin-transfer-received', message: `Received ${amount} coins from ${username}.` }));
        }
        break;
      }
      case 'unsend-message': {
        if (!username) return;
        const idx = messages.findIndex(m => m.id === data.messageId && m.username === username);
        if (idx !== -1) {
          messages.splice(idx, 1);
          broadcast({ type: 'unsend-message', messageId: data.messageId });
        }
        break;
      }
      case 'request-user-list': {
        updateUserList();
        break;
      }
    }
  });

  ws.on('close', () => {
    if (username && users.has(username)) {
      users.delete(username);
      broadcast({ type: 'user-left', username });
      updateUserList();
    }
  });
});

console.log('WebSocket chat server running on ws://localhost:3000');
