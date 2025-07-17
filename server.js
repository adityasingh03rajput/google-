// Dating App WebSocket Server
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Server configuration
const PORT = 3001;
const wss = new WebSocket.Server({ port: PORT });

// Data storage
const users = new Map(); // username -> { ws, profile, coins, matches, conversations }
const publicRooms = new Map(); // roomId -> { name, description, participants, messages }
const privateRooms = new Map(); // roomId -> { participants, messages, createdAt }
const INITIAL_COINS = 50;

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Load user profiles from disk or initialize
let userProfiles = {};
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
try {
  if (fs.existsSync(PROFILES_FILE)) {
    userProfiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(userProfiles).length} user profiles`);
  }
} catch (err) {
  console.error('Error loading profiles:', err);
}

// Save profiles periodically
function saveProfiles() {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(userProfiles), 'utf8');
    console.log('Profiles saved successfully');
  } catch (err) {
    console.error('Error saving profiles:', err);
  }
}
setInterval(saveProfiles, 60000); // Save every minute

// Broadcast to specific users
function broadcastToUsers(data, usernames) {
  const msg = JSON.stringify(data);
  usernames.forEach(username => {
    const user = users.get(username);
    if (user && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(msg);
    }
  });
}

// Send to specific user
function sendToUser(username, data) {
  const user = users.get(username);
  if (user && user.ws.readyState === WebSocket.OPEN) {
    user.ws.send(JSON.stringify(data));
  }
}

// Update online users list
function updateUserList() {
  const onlineUsers = Array.from(users.keys()).map(username => {
    return {
      username,
      displayName: userProfiles[username]?.displayName || username,
      avatar: userProfiles[username]?.avatar || null
    };
  });
  
  broadcastToUsers(
    { type: 'user-list', users: onlineUsers },
    Array.from(users.keys())
  );
}

// Calculate match percentage between two users
function calculateMatchPercentage(user1, user2) {
  if (!userProfiles[user1] || !userProfiles[user2]) return 0;
  
  const profile1 = userProfiles[user1];
  const profile2 = userProfiles[user2];
  
  let score = 0;
  let totalFactors = 0;
  
  // Match interests
  if (profile1.interests && profile2.interests) {
    const commonInterests = profile1.interests.filter(interest => 
      profile2.interests.includes(interest)
    );
    score += (commonInterests.length / Math.max(profile1.interests.length, profile2.interests.length)) * 40;
    totalFactors += 40;
  }
  
  // Match qualities
  if (profile1.qualities && profile2.qualities) {
    const commonQualities = profile1.qualities.filter(quality => 
      profile2.qualities.includes(quality)
    );
    score += (commonQualities.length / Math.max(profile1.qualities.length, profile2.qualities.length)) * 30;
    totalFactors += 30;
  }
  
  // Match movies
  if (profile1.favoriteMovies && profile2.favoriteMovies) {
    const commonMovies = profile1.favoriteMovies.filter(movie => 
      profile2.favoriteMovies.includes(movie)
    );
    score += (commonMovies.length / Math.max(profile1.favoriteMovies.length, profile2.favoriteMovies.length)) * 15;
    totalFactors += 15;
  }
  
  // Match songs
  if (profile1.favoriteSongs && profile2.favoriteSongs) {
    const commonSongs = profile1.favoriteSongs.filter(song => 
      profile2.favoriteSongs.includes(song)
    );
    score += (commonSongs.length / Math.max(profile1.favoriteSongs.length, profile2.favoriteSongs.length)) * 15;
    totalFactors += 15;
  }
  
  return totalFactors > 0 ? Math.round((score / totalFactors) * 100) : 0;
}

// Find matches for a user
function findMatches(username) {
  if (!userProfiles[username]) return [];
  
  const userProfile = userProfiles[username];
  const potentialMatches = Object.keys(userProfiles).filter(u => u !== username);
  
  const matches = potentialMatches.map(matchUsername => {
    const matchPercentage = calculateMatchPercentage(username, matchUsername);
    return {
      username: matchUsername,
      displayName: userProfiles[matchUsername].displayName || matchUsername,
      avatar: userProfiles[matchUsername].avatar || null,
      matchPercentage,
      bio: userProfiles[matchUsername].bio || '',
      age: userProfiles[matchUsername].age || null,
      location: userProfiles[matchUsername].location || '',
      online: users.has(matchUsername)
    };
  });
  
  // Sort by match percentage (highest first)
  return matches.sort((a, b) => b.matchPercentage - a.matchPercentage);
}

// Create or get private conversation between two users
function getPrivateConversation(user1, user2) {
  // Sort usernames to ensure consistent room ID
  const participants = [user1, user2].sort();
  const roomId = `private_${participants.join('_')}`;
  
  if (!privateRooms.has(roomId)) {
    privateRooms.set(roomId, {
      participants,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
  }
  
  return {
    roomId,
    room: privateRooms.get(roomId)
  };
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  let username = null;

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
        // Register new user
        if (!data.username || users.has(data.username)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Invalid or duplicate username.' 
          }));
          return;
        }
        
        username = data.username;
        
        // Create or update user profile
        if (!userProfiles[username]) {
          userProfiles[username] = {
            displayName: data.displayName || username,
            createdAt: Date.now(),
            bio: '',
            interests: [],
            qualities: [],
            favoriteMovies: [],
            favoriteSongs: [],
            avatar: null
          };
        }
        
        // Store user connection
        users.set(username, { 
          ws, 
          profile: userProfiles[username],
          coins: INITIAL_COINS,
          matches: [],
          conversations: []
        });
        
        // Send initial data to user
        ws.send(JSON.stringify({ 
          type: 'registration-success',
          profile: userProfiles[username],
          coins: INITIAL_COINS
        }));
        
        // Update user list for everyone
        updateUserList();
        
        // Find matches for this user
        const matches = findMatches(username);
        sendToUser(username, { type: 'matches-update', matches });
        
        break;
      }
      
      case 'update-profile': {
        if (!username) return;
        
        // Update profile fields
        const profile = userProfiles[username];
        const allowedFields = [
          'displayName', 'bio', 'age', 'location', 'gender', 
          'interests', 'qualities', 'favoriteMovies', 'favoriteSongs',
          'lookingFor', 'avatar'
        ];
        
        allowedFields.forEach(field => {
          if (data[field] !== undefined) {
            profile[field] = data[field];
          }
        });
        
        // Update in-memory user
        const user = users.get(username);
        if (user) {
          user.profile = profile;
        }
        
        // Save profiles
        saveProfiles();
        
        // Send confirmation
        ws.send(JSON.stringify({ 
          type: 'profile-updated', 
          profile 
        }));
        
        // Update matches since profile changed
        const matches = findMatches(username);
        sendToUser(username, { type: 'matches-update', matches });
        
        break;
      }
      
      case 'get-matches': {
        if (!username) return;
        
        // Find and send matches
        const matches = findMatches(username);
        ws.send(JSON.stringify({ 
          type: 'matches-update', 
          matches 
        }));
        
        break;
      }
      
      case 'start-conversation': {
        if (!username || !data.targetUser) return;
        
        const targetUser = data.targetUser;
        
        // Get or create private conversation
        const { roomId, room } = getPrivateConversation(username, targetUser);
        
        // Send conversation history to initiator
        sendToUser(username, {
          type: 'conversation-started',
          roomId,
          targetUser,
          messages: room.messages
        });
        
        // Notify target user if online
        if (users.has(targetUser)) {
          sendToUser(targetUser, {
            type: 'conversation-request',
            roomId,
            fromUser: username,
            fromUserProfile: userProfiles[username]
          });
        }
        
        break;
      }
      
      case 'send-message': {
        if (!username || !data.roomId || !data.message) return;
        
        const roomId = data.roomId;
        const room = privateRooms.get(roomId);
        
        if (!room || !room.participants.includes(username)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Room not found or access denied.' 
          }));
          return;
        }
        
        // Create message object
        const message = {
          id: uuidv4(),
          sender: username,
          content: data.message,
          timestamp: Date.now(),
          type: 'text'
        };
        
        // Add to room messages
        room.messages.push(message);
        room.lastActivity = Date.now();
        
        // Send to all participants
        room.participants.forEach(participant => {
          sendToUser(participant, {
            type: 'new-message',
            roomId,
            message
          });
        });
        
        break;
      }
      
      case 'send-media': {
        if (!username || !data.roomId || !data.mediaType || !data.mediaContent) return;
        
        const roomId = data.roomId;
        const room = privateRooms.get(roomId);
        
        if (!room || !room.participants.includes(username)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Room not found or access denied.' 
          }));
          return;
        }
        
        // Create media message object
        const message = {
          id: uuidv4(),
          sender: username,
          mediaType: data.mediaType, // 'image', 'audio', etc.
          mediaContent: data.mediaContent,
          timestamp: Date.now(),
          type: 'media'
        };
        
        // Add to room messages
        room.messages.push(message);
        room.lastActivity = Date.now();
        
        // Send to all participants
        room.participants.forEach(participant => {
          sendToUser(participant, {
            type: 'new-message',
            roomId,
            message
          });
        });
        
        break;
      }
      
      case 'create-couple-room': {
        if (!username || !data.partner || !data.roomName) return;
        
        const partner = data.roomName;
        const roomName = data.roomName;
        
        // Check if partner exists
        if (!userProfiles[partner]) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Partner not found.' 
          }));
          return;
        }
        
        // Create room ID
        const roomId = `couple_${uuidv4()}`;
        
        // Create room
        publicRooms.set(roomId, {
          name: roomName,
          description: data.description || '',
          participants: [username, partner],
          messages: [],
          createdAt: Date.now(),
          lastActivity: Date.now(),
          theme: data.theme || 'default',
          activities: []
        });
        
        // Notify both users
        [username, partner].forEach(user => {
          sendToUser(user, {
            type: 'couple-room-created',
            roomId,
            roomName,
            participants: [username, partner]
          });
        });
        
        break;
      }
      
      case 'add-relationship-milestone': {
        if (!username || !data.partner || !data.milestone) return;
        
        const partner = data.partner;
        
        // Check if partner exists
        if (!userProfiles[partner]) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Partner not found.' 
          }));
          return;
        }
        
        // Initialize relationship data if needed
        if (!userProfiles[username].relationships) {
          userProfiles[username].relationships = {};
        }
        
        if (!userProfiles[username].relationships[partner]) {
          userProfiles[username].relationships[partner] = {
            status: 'dating',
            startDate: Date.now(),
            milestones: []
          };
        }
        
        // Add milestone
        const milestone = {
          id: uuidv4(),
          type: data.milestone.type,
          description: data.milestone.description,
          date: data.milestone.date || Date.now(),
          media: data.milestone.media || null
        };
        
        userProfiles[username].relationships[partner].milestones.push(milestone);
        
        // Save profiles
        saveProfiles();
        
        // Notify both users
        sendToUser(username, {
          type: 'milestone-added',
          partner,
          milestone
        });
        
        if (users.has(partner)) {
          sendToUser(partner, {
            type: 'partner-added-milestone',
            partner: username,
            milestone
          });
        }
        
        break;
      }
      
      case 'send-virtual-gift': {
        if (!username || !data.recipient || !data.giftType) return;
        
        const recipient = data.recipient;
        const user = users.get(username);
        
        // Check if recipient exists
        if (!users.has(recipient)) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Recipient not found or offline.' 
          }));
          return;
        }
        
        // Gift costs
        const giftCosts = {
          flower: 5,
          chocolate: 10,
          teddy: 20,
          ring: 50,
          custom: data.customCost || 15
        };
        
        const cost = giftCosts[data.giftType] || 10;
        
        // Check if user has enough coins
        if (user.coins < cost) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: `Not enough coins. This gift costs ${cost} coins.` 
          }));
          return;
        }
        
        // Deduct coins
        user.coins -= cost;
        
        // Create gift object
        const gift = {
          id: uuidv4(),
          type: data.giftType,
          sender: username,
          message: data.message || '',
          timestamp: Date.now(),
          cost
        };
        
        // Notify recipient
        sendToUser(recipient, {
          type: 'gift-received',
          gift
        });
        
        // Notify sender
        sendToUser(username, {
          type: 'gift-sent',
          gift,
          remainingCoins: user.coins
        });
        
        break;
      }
      
      case 'schedule-virtual-date': {
        if (!username || !data.partner || !data.dateTime || !data.activity) return;
        
        const partner = data.partner;
        
        // Check if partner exists
        if (!userProfiles[partner]) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Partner not found.' 
          }));
          return;
        }
        
        // Create date object
        const virtualDate = {
          id: uuidv4(),
          initiator: username,
          partner,
          dateTime: data.dateTime,
          activity: data.activity,
          description: data.description || '',
          status: 'pending'
        };
        
        // Initialize virtual dates if needed
        if (!userProfiles[username].virtualDates) {
          userProfiles[username].virtualDates = [];
        }
        
        userProfiles[username].virtualDates.push(virtualDate);
        
        // Save profiles
        saveProfiles();
        
        // Notify partner if online
        if (users.has(partner)) {
          sendToUser(partner, {
            type: 'virtual-date-invitation',
            date: virtualDate
          });
        }
        
        // Notify initiator
        sendToUser(username, {
          type: 'virtual-date-scheduled',
          date: virtualDate
        });
        
        break;
      }
    }
  });

  ws.on('close', () => {
    if (username && users.has(username)) {
      users.delete(username);
      updateUserList();
    }
  });
});

console.log(`Dating App WebSocket server running on ws://localhost:${PORT}`);
