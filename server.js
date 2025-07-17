// LoveConnect Dating App WebSocket Server (Full Rewrite)
// Author: GPT-4

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Config ---
const PORT = 3001;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const INITIAL_COINS = 50;

// --- Ensure Data Directory ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- In-memory State ---
const sessions = new Map(); // username -> { ws, coins, currentMatch, ... }
let users = {};             // username -> { passwordHash, displayName, createdAt }
let profiles = {};          // username -> { displayName, bio, ... }
let matches = {};           // matchId -> { user1, user2, roomId, createdAt }
let rooms = {};             // roomId -> { participants, messages, createdAt }

// --- Persistence Helpers ---
function loadJson(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Failed to load', file, e); }
  return fallback;
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.error('Failed to save', file, e); }
}
users = loadJson(USERS_FILE);
profiles = loadJson(PROFILES_FILE);
setInterval(() => { saveJson(USERS_FILE, users); saveJson(PROFILES_FILE, profiles); }, 60000);

// --- Auth Helpers ---
function hashPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function verifyPassword(pw, hash) { return hashPassword(pw) === hash; }

// --- WebSocket Server ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`LoveConnect server running on ws://localhost:${PORT}`);

wss.on('connection', ws => {
  let username = null;

  ws.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch { ws.send(json({ type: 'error', message: 'Invalid JSON' })); return; }

    // --- Registration ---
    if (data.type === 'register') {
      if (!data.username || !data.password || !data.displayName) return ws.send(json({ type: 'auth-error', message: 'Missing fields' }));
      if (users[data.username]) return ws.send(json({ type: 'auth-error', message: 'Username taken' }));
      users[data.username] = { passwordHash: hashPassword(data.password), displayName: data.displayName, createdAt: Date.now() };
      profiles[data.username] = { displayName: data.displayName, bio: '', age: null, location: '', interests: [], qualities: [], coins: INITIAL_COINS };
      saveJson(USERS_FILE, users); saveJson(PROFILES_FILE, profiles);
      username = data.username;
      sessions.set(username, { ws, coins: INITIAL_COINS, currentMatch: null });
      ws.send(json({ type: 'auth-success', profile: profiles[username], coins: INITIAL_COINS }));
      broadcastUserList();
      sendMatches(username);
      return;
    }

    // --- Login ---
    if (data.type === 'login') {
      const user = users[data.username];
      if (!user || !verifyPassword(data.password, user.passwordHash)) return ws.send(json({ type: 'auth-error', message: 'Invalid credentials' }));
        username = data.username;
      sessions.set(username, { ws, coins: profiles[username]?.coins || INITIAL_COINS, currentMatch: null });
      ws.send(json({ type: 'auth-success', profile: profiles[username], coins: profiles[username]?.coins || INITIAL_COINS }));
      broadcastUserList();
      sendMatches(username);
          return;
        }
        
    // --- Auth Required ---
    if (!username) return ws.send(json({ type: 'error', message: 'Not authenticated' }));

    // --- Profile Update ---
    if (data.type === 'update-profile') {
      const allowed = ['displayName','bio','age','location','interests','qualities'];
      for (const k of allowed) if (data[k] !== undefined) profiles[username][k] = data[k];
      saveJson(PROFILES_FILE, profiles);
      ws.send(json({ type: 'profile-updated', profile: profiles[username] }));
      sendMatches(username);
          return;
        }
        
    // --- Get Matches ---
    if (data.type === 'get-matches') {
      sendMatches(username);
          return;
        }
        
    // --- Create Match ---
    if (data.type === 'create-match') {
      const target = data.targetUser;
      if (!target || !profiles[target] || username === target) return ws.send(json({ type: 'error', message: 'Invalid match target' }));
      if (getCurrentMatch(username) || getCurrentMatch(target)) return ws.send(json({ type: 'error', message: 'Already matched' }));
      const matchId = uuidv4();
      const roomId = 'room_' + matchId;
      matches[matchId] = { user1: username, user2: target, roomId, createdAt: Date.now() };
      rooms[roomId] = { participants: [username, target], messages: [], createdAt: Date.now() };
      sessions.get(username).currentMatch = { partner: target, roomId, matchId };
      sessions.get(target)?.ws?.send(json({ type: 'match-created', partner: username, partnerProfile: profiles[username], roomId, matchId }));
      ws.send(json({ type: 'match-created', partner: target, partnerProfile: profiles[target], roomId, matchId }));
        updateAllMatches();
          return;
        }
        
    // --- End Match ---
    if (data.type === 'end-match') {
      const match = getCurrentMatch(username);
      if (!match) return ws.send(json({ type: 'error', message: 'No active match' }));
      const partner = match.partner;
      sessions.get(username).currentMatch = null;
      sessions.get(partner).currentMatch = null;
      delete matches[match.matchId];
      ws.send(json({ type: 'match-ended', partner }));
      sessions.get(partner)?.ws?.send(json({ type: 'match-ended', partner: username }));
        updateAllMatches();
          return;
        }
        
    // --- Start Conversation ---
    if (data.type === 'start-conversation') {
      const target = data.targetUser;
      if (!target || !profiles[target]) return ws.send(json({ type: 'error', message: 'User not found' }));
      const roomId = getOrCreateRoom(username, target);
      ws.send(json({ type: 'conversation-started', roomId, targetUser: target, messages: rooms[roomId].messages }));
      sessions.get(target)?.ws?.send(json({ type: 'conversation-request', roomId, fromUser: username, fromUserProfile: profiles[username] }));
          return;
        }
        
    // --- Send Message ---
    if (data.type === 'send-message') {
      const { roomId, message } = data;
      if (!roomId || !message || !rooms[roomId] || !rooms[roomId].participants.includes(username)) return ws.send(json({ type: 'error', message: 'Room not found or access denied' }));
      const msgObj = { id: uuidv4(), sender: username, content: message, timestamp: Date.now(), type: 'text' };
      rooms[roomId].messages.push(msgObj);
      for (const p of rooms[roomId].participants) sessions.get(p)?.ws?.send(json({ type: 'new-message', roomId, message: msgObj }));
          return;
        }
        
    // --- Send Virtual Gift ---
    if (data.type === 'send-virtual-gift') {
      const { recipient, giftType, message: giftMsg } = data;
      if (!recipient || !giftType || !sessions.get(recipient)) return ws.send(json({ type: 'error', message: 'Recipient not found/online' }));
      const cost = { flower: 5, chocolate: 10, teddy: 20, ring: 50 }[giftType] || 10;
      if (sessions.get(username).coins < cost) return ws.send(json({ type: 'error', message: `Not enough coins. This gift costs ${cost} coins.` }));
      sessions.get(username).coins -= cost;
      profiles[username].coins = sessions.get(username).coins;
      const gift = { id: uuidv4(), type: giftType, sender: username, message: giftMsg || '', timestamp: Date.now(), cost };
      sessions.get(recipient).ws.send(json({ type: 'gift-received', gift }));
      ws.send(json({ type: 'gift-sent', gift, remainingCoins: sessions.get(username).coins }));
      saveJson(PROFILES_FILE, profiles);
          return;
        }
        
    // --- Schedule Virtual Date ---
    if (data.type === 'schedule-virtual-date') {
      const { partner, dateTime, activity, description } = data;
      if (!partner || !dateTime || !activity || !profiles[partner]) return ws.send(json({ type: 'error', message: 'Missing fields or partner not found' }));
      const virtualDate = { id: uuidv4(), initiator: username, partner, dateTime, activity, description: description || '', status: 'pending' };
      if (!profiles[username].virtualDates) profiles[username].virtualDates = [];
      profiles[username].virtualDates.push(virtualDate);
      saveJson(PROFILES_FILE, profiles);
      sessions.get(partner)?.ws?.send(json({ type: 'virtual-date-invitation', date: virtualDate }));
      ws.send(json({ type: 'virtual-date-scheduled', date: virtualDate }));
          return;
    }
  });

  ws.on('close', () => {
    if (username) { sessions.delete(username); broadcastUserList(); }
  });
});

// --- Utility Functions ---
function json(obj) { return JSON.stringify(obj); }
function broadcastUserList() {
  const online = Array.from(sessions.keys()).map(u => ({ username: u, displayName: profiles[u]?.displayName || u }));
  for (const s of sessions.values()) s.ws.send(json({ type: 'user-list', users: online }));
}
function getCurrentMatch(username) { return sessions.get(username)?.currentMatch; }
function sendMatches(username) {
  const userProfile = profiles[username];
  if (!userProfile) return;
  const available = Object.keys(profiles).filter(u => u !== username && !getCurrentMatch(u)).map(u => ({
    username: u,
    displayName: profiles[u].displayName,
    bio: profiles[u].bio || '',
    age: profiles[u].age || null,
    location: profiles[u].location || '',
    matchPercentage: calcMatchPercent(userProfile, profiles[u])
  })).sort((a, b) => b.matchPercentage - a.matchPercentage);
  sessions.get(username)?.ws?.send(json({ type: 'matches-update', matches: available }));
}
function updateAllMatches() { for (const u of sessions.keys()) sendMatches(u); }
function getOrCreateRoom(u1, u2) {
  const key = [u1, u2].sort().join('_');
  let roomId = Object.keys(rooms).find(rid => rooms[rid].participants.sort().join('_') === key);
  if (!roomId) {
    roomId = 'private_' + uuidv4();
    rooms[roomId] = { participants: [u1, u2], messages: [], createdAt: Date.now() };
  }
  return roomId;
}
function calcMatchPercent(p1, p2) {
  let score = 0, total = 0;
  if (p1.interests && p2.interests) { score += intersect(p1.interests, p2.interests).length * 2; total += Math.max(p1.interests.length, p2.interests.length) * 2; }
  if (p1.qualities && p2.qualities) { score += intersect(p1.qualities, p2.qualities).length * 2; total += Math.max(p1.qualities.length, p2.qualities.length) * 2; }
  return total ? Math.round((score / total) * 100) : 0;
}
function intersect(a, b) { return a.filter(x => b.includes(x)); }
