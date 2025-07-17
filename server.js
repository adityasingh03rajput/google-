// Dating App WebSocket Server with Authentication and Exclusive Matching
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Server configuration
const PORT = 3001;
const wss = new WebSocket.Server({ port: PORT });

// Data storage
const users = new Map(); // username -> { ws, displayName, currentMatch, messages }
const registeredUsers = new Map(); // username -> { passwordHash, displayName, createdAt }
const activeMatches = new Map(); // matchId -> { user1, user2, messages, createdAt }

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Authentication helpers
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

// Load registered users from disk
const USERS_FILE = path.join(DATA_DIR, 'auth-users.json');
try {
  if (fs.existsSync(USERS_FILE)) {
    const userData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    Object.entries(userData).forEach(([username, data]) => {
      registeredUsers.set(username, data);
    });
    console.log(`Loaded ${registeredUsers.size} registered users`);
  }
} catch (err) {
  console.error('Error loading users:', err);
}

// Save registered users
function saveUsers() {
  try {
    const userData = {};
    registeredUsers.forEach((data, username) => {
      userData[username] = data;
    });
    fs.writeFileSync(USERS_FILE, JSON.stringify(userData, null, 2), 'utf8');
    console.log('Users saved successfully');
  } catch (err) {
    console.error('Error saving users:', err);
  }
}

// Save users periodically
setInterval(saveUsers, 60000); // Save every minute

// Get available matches for a user (users who don't have active matches)
function getAvailableMatches(currentUsername) {
  const availableUsers = [];
  
  users.forEach((userData, username) => {
    if (username !== currentUsername && !userData.currentMatch) {
      availableUsers.push({
        username: username,
        displayName: userData.displayName,
        hasMatch: false,
        compatibility: Math.floor(Math.random() * 20) + 80 // Random compatibility 80-100%
      });
    }
  });
  
  return availableUsers;
}

// Create exclusive match between two users
function createMatch(user1, user2) {
  const matchId = uuidv4();
  
  // Set current match for both users
  const userData1 = users.get(user1);
  const userData2 = users.get(user2);
  
  if (!userData1 || !userData2) {
    return null;
  }
  
  // Check if either user already has a match
  if (userData1.currentMatch || userData2.currentMatch) {
    return null;
  }
  
  const matchData = {
    user1: user1,
    user2: user2,
    messages: [],
    createdAt: Date.now()
  };
  
  // Store active match
  activeMatches.set(matchId, matchData);
  
  // Set current match for both users
  userData1.currentMatch = {
    matchId: matchId,
    partner: user2,
    partnerDisplayName: userData2.displayName
  };
  
  userData2.currentMatch = {
    matchId: matchId,
    partner: user1,
    partnerDisplayName: userData1.displayName
  };
  
  return matchId;
}

// Remove match and allow users to find new matches
function removeMatch(matchId) {
  const match = activeMatches.get(matchId);
  if (!match) return false;
  
  // Clear current match for both users
  const user1Data = users.get(match.user1);
  const user2Data = users.get(match.user2);
  
  if (user1Data) user1Data.currentMatch = null;
  if (user2Data) user2Data.currentMatch = null;
  
  // Remove from active matches
  activeMatches.delete(matchId);
  
  return true;
}

// Broadcast to specific users
function sendToUser(username, data) {
  const user = users.get(username);
  if (user && user.ws.readyState === WebSocket.OPEN) {
    user.ws.send(JSON.stringify(data));
  }
}

// Send available matches to a user
function sendAvailableMatches(username) {
  const matches = getAvailableMatches(username);
  sendToUser(username, {
    type: 'available-matches',
    matches: matches
  });
}

// Broadcast available matches to all users
function broadcastAvailableMatches() {
  users.forEach((userData, username) => {
    sendAvailableMatches(username);
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  let currentUsername = null;

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (err) {
      console.error('Invalid message format:', err);
      return;
    }

    switch (data.type) {
      case 'register': {
        const { username, displayName, password } = data;
        
        if (!username || !displayName || !password) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Missing required fields'
          }));
          return;
        }
        
        if (registeredUsers.has(username)) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Username already exists'
          }));
          return;
        }
        
        // Create new user account
        const passwordHash = hashPassword(password);
        registeredUsers.set(username, {
          passwordHash: passwordHash,
          displayName: displayName,
          createdAt: Date.now()
        });
        
        // Set current user
        currentUsername = username;
        users.set(username, {
          ws: ws,
          displayName: displayName,
          currentMatch: null,
          messages: []
        });
        
        // Send success response
        ws.send(JSON.stringify({
          type: 'auth-success',
          username: username,
          displayName: displayName
        }));
        
        // Send available matches
        sendAvailableMatches(username);
        
        // Broadcast updated matches to all users
        broadcastAvailableMatches();
        
        // Save users
        saveUsers();
        
        console.log(`User registered: ${username} (${displayName})`);
        break;
      }
      
      case 'login': {
        const { username, password } = data;
        
        if (!username || !password) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Missing username or password'
          }));
          return;
        }
        
        const user = registeredUsers.get(username);
        if (!user || !verifyPassword(password, user.passwordHash)) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Invalid username or password'
          }));
          return;
        }
        
        // Set current user
        currentUsername = username;
        users.set(username, {
          ws: ws,
          displayName: user.displayName,
          currentMatch: null,
          messages: []
        });
        
        // Send success response
        ws.send(JSON.stringify({
          type: 'auth-success',
          username: username,
          displayName: user.displayName
        }));
        
        // Send available matches
        sendAvailableMatches(username);
        
        // Broadcast updated matches to all users
        broadcastAvailableMatches();
        
        console.log(`User logged in: ${username} (${user.displayName})`);
        break;
      }
      
      case 'reconnect': {
        const { username } = data;
        
        if (!registeredUsers.has(username)) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'User not found'
          }));
          return;
        }
        
        const user = registeredUsers.get(username);
        currentUsername = username;
        
        // Update user connection
        users.set(username, {
          ws: ws,
          displayName: user.displayName,
          currentMatch: users.get(username)?.currentMatch || null,
          messages: users.get(username)?.messages || []
        });
        
        // Send current match if exists
        const userData = users.get(username);
        if (userData.currentMatch) {
          ws.send(JSON.stringify({
            type: 'match-created',
            match: userData.currentMatch
          }));
        }
        
        // Send available matches
        sendAvailableMatches(username);
        
        console.log(`User reconnected: ${username}`);
        break;
      }
      
      case 'request-match': {
        if (!currentUsername) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Not authenticated'
          }));
          return;
        }
        
        const { targetUser } = data;
        const currentUserData = users.get(currentUsername);
        const targetUserData = users.get(targetUser);
        
        if (!targetUserData) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Target user not found'
          }));
          return;
        }
        
        // Check if current user already has a match
        if (currentUserData.currentMatch) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'You already have an active match'
          }));
          return;
        }
        
        // Check if target user already has a match
        if (targetUserData.currentMatch) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'This user is already matched with someone else'
          }));
          return;
        }
        
        // Create match
        const matchId = createMatch(currentUsername, targetUser);
        if (!matchId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to create match'
          }));
          return;
        }
        
        // Notify both users about the match
        const currentMatch = currentUserData.currentMatch;
        const targetMatch = targetUserData.currentMatch;
        
        sendToUser(currentUsername, {
          type: 'match-created',
          match: currentMatch
        });
        
        sendToUser(targetUser, {
          type: 'match-created',
          match: targetMatch
        });
        
        // Broadcast updated available matches to all users
        broadcastAvailableMatches();
        
        console.log(`Match created: ${currentUsername} <-> ${targetUser}`);
        break;
      }
      
      case 'send-message': {
        if (!currentUsername) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Not authenticated'
          }));
          return;
        }
        
        const userData = users.get(currentUsername);
        if (!userData.currentMatch) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No active match to send message to'
          }));
          return;
        }
        
        const { message } = data;
        if (!message || !message.trim()) {
          return;
        }
        
        const messageData = {
          id: uuidv4(),
          sender: currentUsername,
          content: message.trim(),
          timestamp: Date.now()
        };
        
        // Store message in match
        const match = activeMatches.get(userData.currentMatch.matchId);
        if (match) {
          match.messages.push(messageData);
        }
        
        // Send message to both users
        const partner = userData.currentMatch.partner;
        
        sendToUser(currentUsername, {
          type: 'new-message',
          message: messageData
        });
        
        sendToUser(partner, {
          type: 'new-message',
          message: messageData
        });
        
        break;
      }
      
      case 'end-match': {
        if (!currentUsername) {
          ws.send(JSON.stringify({
            type: 'auth-error',
            message: 'Not authenticated'
          }));
          return;
        }
        
        const userData = users.get(currentUsername);
        if (!userData.currentMatch) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No active match to end'
          }));
          return;
        }
        
        const partner = userData.currentMatch.partner;
        const matchId = userData.currentMatch.matchId;
        
        // Remove match
        if (removeMatch(matchId)) {
          // Notify both users
          sendToUser(currentUsername, {
            type: 'match-ended'
          });
          
          sendToUser(partner, {
            type: 'match-ended'
          });
          
          // Broadcast updated available matches
          broadcastAvailableMatches();
          
          console.log(`Match ended: ${currentUsername} <-> ${partner}`);
        }
        
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentUsername) {
      console.log(`User disconnected: ${currentUsername}`);
      
      // Keep user data but mark as offline
      const userData = users.get(currentUsername);
      if (userData) {
        userData.ws = null;
      }
      
      // Don't remove user completely to maintain matches
      // users.delete(currentUsername);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Cleanup inactive matches periodically
setInterval(() => {
  const now = Date.now();
  const MATCH_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  
  activeMatches.forEach((match, matchId) => {
    if (now - match.createdAt > MATCH_TIMEOUT) {
      console.log(`Cleaning up inactive match: ${matchId}`);
      removeMatch(matchId);
    }
  });
}, 60 * 60 * 1000); // Check every hour

console.log(`Dating App Authentication Server running on ws://localhost:${PORT}`);
console.log('Features:');
console.log('- User registration and login');
console.log('- Exclusive matching (1-on-1 only)');
console.log('- Private chat for matched couples');
console.log('- Match management (create/end matches)');
