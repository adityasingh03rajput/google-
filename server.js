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
// The frontend now sends curated, trending Indian topics for 2025 at the top of each list (movies, songs, interests)
// Matching logic remains the same, but the lists are more relevant for Indian users in 2025
const users = new Map(); // username -> { ws, coins, profile, room }
const messages = []; // Store all messages for unsend feature
const roomMessages = new Map(); // roomId -> [messages]
const rooms = new Map(); // roomId -> [usernames]
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

// Car Crash Game data
const carCrashScores = new Map(); // username -> score
const CAR_CRASH_COIN_REWARD = 5; // Coins awarded for high scores

// Permanent match storage: username -> { match: username, room: roomId }
const permanentMatches = new Map();
const REST_ROOM = 'rest_room';

// Broadcast to all clients
function broadcast(data, excludeUsername = null, room = REST_ROOM) {
  const message = JSON.stringify(data);
  users.forEach((user, username) => {
    if (username !== excludeUsername && user.ws.readyState === WebSocket.OPEN && user.room === room) {
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
  let userProfile = null;
  let assignedRoom = REST_ROOM;

  // Check if user has a permanent match
  if (permanentMatches.has(username)) {
    const matchInfo = permanentMatches.get(username);
    assignedRoom = matchInfo.room;
  }

  // Store profile if received before join
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'profile') {
        userProfile = {
          city: (data.city || '').trim().toLowerCase(),
          qualities: (data.qualities || []).map(s => s.trim().toLowerCase()),
          interests: (data.interests || []).map(s => s.trim().toLowerCase()),
          movies: (data.movies || []).map(s => s.trim().toLowerCase()),
          songs: (data.songs || []).map(s => s.trim().toLowerCase()),
          expectedQualities: (data.expectedQualities || []).map(s => s.trim().toLowerCase()),
          expectedInterests: (data.expectedInterests || []).map(s => s.trim().toLowerCase()),
          expectedMovies: (data.expectedMovies || []).map(s => s.trim().toLowerCase()),
          expectedSongs: (data.expectedSongs || []).map(s => s.trim().toLowerCase()),
        };
        return;
      }

      switch (data.type) {
        case 'join':
          // Generate random username if not provided
          if (!data.username) {
            username = `User${Math.floor(Math.random() * 1000)}`;
          } else {
            username = data.username;
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
          // If user has a permanent match, restore room and skip matching
          if (permanentMatches.has(username)) {
            assignedRoom = permanentMatches.get(username).room;
            // Register new user
            users.set(username, {
              ws,
              coins: INITIAL_COINS,
              milestonesReached: [],
              profile: userProfile,
              room: assignedRoom
            });
            // Send initial coin balance
            ws.send(JSON.stringify({
              type: 'coin-update',
              coins: INITIAL_COINS,
              username: username
            }));
            // Notify user of match
            const matchUser = permanentMatches.get(username).match;
            ws.send(JSON.stringify({ type: 'matched', room: assignedRoom, with: matchUser }));
            // Send chat history for the room
            if (roomMessages.has(assignedRoom)) {
              ws.send(JSON.stringify({ type: 'chat-history', room: assignedRoom, messages: roomMessages.get(assignedRoom) }));
            }
            updateUserList();
            return;
          }
          // Not matched: assign to rest room
          assignedRoom = REST_ROOM;
          users.set(username, {
            ws,
            coins: INITIAL_COINS,
            milestonesReached: [],
            profile: userProfile,
            room: assignedRoom
          });
          ws.send(JSON.stringify({
            type: 'coin-update',
            coins: INITIAL_COINS,
            username: username
          }));
          ws.send(JSON.stringify({
            type: 'rest-room',
            message: 'Welcome to the Rest Room! Try the Car Crash Game to earn coins!'
          }));
          updateUserList();
          // Try to match
          let matchedRoom = null;
          if (userProfile) {
            for (const [otherUsername, otherUser] of users.entries()) {
              if (!otherUser.profile || otherUser.room !== REST_ROOM) continue;
              if (permanentMatches.has(username) || permanentMatches.has(otherUsername)) continue;
              if (userProfile.city !== otherUser.profile.city) continue;
              const qualitiesMatch = userProfile.expectedQualities.every(q => otherUser.profile.qualities.includes(q));
              const interestsMatch = userProfile.expectedInterests.every(i => otherUser.profile.interests.includes(i));
              const moviesMatch = userProfile.expectedMovies.every(m => otherUser.profile.movies.includes(m));
              const songsMatch = userProfile.expectedSongs.every(s => otherUser.profile.songs.includes(s));
              const reverseQualitiesMatch = otherUser.profile.expectedQualities.every(q => userProfile.qualities.includes(q));
              const reverseInterestsMatch = otherUser.profile.expectedInterests.every(i => userProfile.interests.includes(i));
              const reverseMoviesMatch = otherUser.profile.expectedMovies.every(m => userProfile.movies.includes(m));
              const reverseSongsMatch = otherUser.profile.expectedSongs.every(s => userProfile.songs.includes(s));
              if (qualitiesMatch && interestsMatch && moviesMatch && songsMatch && reverseQualitiesMatch && reverseInterestsMatch && reverseMoviesMatch && reverseSongsMatch) {
                matchedRoom = `room_${username}_${otherUsername}_${Date.now()}`;
                rooms.set(matchedRoom, [username, otherUsername]);
                otherUser.room = matchedRoom;
                users.get(username).room = matchedRoom;
                permanentMatches.set(username, { match: otherUsername, room: matchedRoom });
                permanentMatches.set(otherUsername, { match: username, room: matchedRoom });
                if (otherUser.ws.readyState === WebSocket.OPEN) {
                  otherUser.ws.send(JSON.stringify({ type: 'matched', room: matchedRoom, with: username }));
                }
                ws.send(JSON.stringify({ type: 'matched', room: matchedRoom, with: otherUsername }));
                break;
              }
            }
          }
          break;

        case 'text-message':
          // Broadcast text message to all users
          const textMsg = {
            type: 'text-message',
            username,
            message: data.message,
            timestamp: Date.now(),
            id: uuid.v4(),
            room: data.room || assignedRoom
          };
          messages.push({ ...textMsg }); // Store message with room info
          if (!roomMessages.has(textMsg.room)) roomMessages.set(textMsg.room, []);
          roomMessages.get(textMsg.room).push({ ...textMsg });
          broadcast(textMsg, null, textMsg.room);
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

        case 'unsend-message':
          // Unsend message logic
          if (!data.messageId) break;
          // Find the message
          const msgIndex = messages.findIndex(m => m.id === data.messageId);
          if (msgIndex !== -1 && messages[msgIndex].username === username) {
            const msgRoom = messages[msgIndex].room || 'public';
            messages.splice(msgIndex, 1); // Remove from storage
            broadcast({ type: 'unsend-message', messageId: data.messageId }, null, msgRoom);
          }
          break;

        case 'car-crash-score':
          // Handle car crash game score submission
          if (data.score && typeof data.score === 'number') {
            const user = users.get(username);
            if (!user) break;

            // Only process scores from users in the rest room
            if (user.room !== REST_ROOM) break;

            // Store the score
            const currentHighScore = carCrashScores.get(username) || 0;
            if (data.score > currentHighScore) {
              carCrashScores.set(username, data.score);

              // Award coins for high scores
              user.coins += CAR_CRASH_COIN_REWARD;

              // Notify user of new high score and coins
              ws.send(JSON.stringify({
                type: 'car-crash-highscore',
                score: data.score,
                coins: CAR_CRASH_COIN_REWARD,
                message: `New high score! You earned ${CAR_CRASH_COIN_REWARD} coins!`
              }));

              // Update user's coin balance
              ws.send(JSON.stringify({
                type: 'coin-update',
                coins: user.coins,
                username
              }));

              // Check for milestones
              checkMilestones(username, user.coins);

              // Broadcast high score to rest room
              broadcast({
                type: 'car-crash-leaderboard-update',
                username,
                score: data.score
              }, null, REST_ROOM);
            }
          }
          break;

        case 'request-car-crash-leaderboard':
          // Send car crash game leaderboard to requester
          const leaderboard = Array.from(carCrashScores.entries())
            .map(([user, score]) => ({ username: user, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10); // Top 10 scores

          ws.send(JSON.stringify({
            type: 'car-crash-leaderboard',
            leaderboard
          }));
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Clean up on connection close
  ws.on('close', () => {
    const user = users.get(username);
    if (user && user.room && user.room !== REST_ROOM) {
      // Remove the user from the room
      const roomUsers = rooms.get(user.room);
      if (roomUsers) {
        const otherUser = roomUsers.find(u => u !== username);
        // Do NOT return other user to public; keep them in the private room
        // Room stays alive for reconnection
      }
      // Do not delete the room or permanent match
    }
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
