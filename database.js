const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(path.join(__dirname, 'dating_game.db'));
    this.init();
  }

  init() {
    // Users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        anonymous_id TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        age INTEGER,
        gender TEXT,
        location TEXT,
        bio TEXT,
        qualities TEXT,
        desired_qualities TEXT,
        coins INTEGER DEFAULT 1000,
        status TEXT DEFAULT 'active',
        group_type TEXT DEFAULT 'normal',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Matches table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER,
        user2_id INTEGER,
        match_type TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id),
        FOREIGN KEY (user2_id) REFERENCES users (id)
      )
    `);

    // Messages table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        message TEXT,
        coins_sent INTEGER DEFAULT 0,
        message_type TEXT DEFAULT 'text',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users (id),
        FOREIGN KEY (receiver_id) REFERENCES users (id)
      )
    `);

    // Milestones table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        milestone_type TEXT,
        milestone_value INTEGER,
        coins_earned INTEGER,
        achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Coin transactions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS coin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        amount INTEGER,
        transaction_type TEXT,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users (id),
        FOREIGN KEY (receiver_id) REFERENCES users (id)
      )
    `);

    // Game activities table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS game_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER,
        user2_id INTEGER,
        activity_type TEXT,
        content TEXT,
        is_ai_generated BOOLEAN DEFAULT FALSE,
        guess_correct BOOLEAN,
        coins_earned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id),
        FOREIGN KEY (user2_id) REFERENCES users (id)
      )
    `);

    // Couple rankings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS couple_rankings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER,
        user2_id INTEGER,
        combined_coins INTEGER,
        activity_score INTEGER,
        love_confession BOOLEAN DEFAULT FALSE,
        relationship_status TEXT DEFAULT 'dating',
        ranking_points INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id),
        FOREIGN KEY (user2_id) REFERENCES users (id)
      )
    `);

    // Virtual gifts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS virtual_gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cost INTEGER NOT NULL,
        category TEXT,
        emoji TEXT,
        description TEXT
      )
    `);

    // Insert default virtual gifts
    this.insertDefaultGifts();
  }

  insertDefaultGifts() {
    const gifts = [
      { name: 'Red Rose', cost: 50, category: 'flowers', emoji: '🌹', description: 'A symbol of love' },
      { name: 'Bouquet', cost: 150, category: 'flowers', emoji: '💐', description: 'Beautiful flower bouquet' },
      { name: 'Heart', cost: 25, category: 'emotions', emoji: '❤️', description: 'Show your love' },
      { name: 'Kiss', cost: 75, category: 'emotions', emoji: '💋', description: 'Send a virtual kiss' },
      { name: 'Chocolate', cost: 100, category: 'treats', emoji: '🍫', description: 'Sweet chocolate treat' },
      { name: 'Teddy Bear', cost: 200, category: 'toys', emoji: '🧸', description: 'Cuddly teddy bear' },
      { name: 'Diamond Ring', cost: 500, category: 'jewelry', emoji: '💍', description: 'Precious diamond ring' },
      { name: 'Love Letter', cost: 80, category: 'messages', emoji: '💌', description: 'Romantic love letter' }
    ];

    gifts.forEach(gift => {
      this.db.run(`
        INSERT OR IGNORE INTO virtual_gifts (name, cost, category, emoji, description)
        VALUES (?, ?, ?, ?, ?)
      `, [gift.name, gift.cost, gift.category, gift.emoji, gift.description]);
    });
  }

  // User operations
  createUser(userData, callback) {
    const { email, anonymous_id, password, name, age, gender, location, bio, qualities, desired_qualities } = userData;
    this.db.run(`
      INSERT INTO users (email, anonymous_id, password, name, age, gender, location, bio, qualities, desired_qualities)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [email, anonymous_id, password, name, age, gender, location, bio, qualities, desired_qualities], callback);
  }

  getUserByAnonymousId(anonymous_id, callback) {
    this.db.get('SELECT * FROM users WHERE anonymous_id = ?', [anonymous_id], callback);
  }

  getAllUsers(callback) {
    this.db.all('SELECT * FROM users ORDER BY created_at DESC', callback);
  }

  updateUserCoins(userId, coins, callback) {
    this.db.run('UPDATE users SET coins = ? WHERE id = ?', [coins, userId], callback);
  }

  // Match operations
  createMatch(user1_id, user2_id, match_type, callback) {
    this.db.run(`
      INSERT INTO matches (user1_id, user2_id, match_type)
      VALUES (?, ?, ?)
    `, [user1_id, user2_id, match_type], callback);
  }

  getUserMatches(userId, callback) {
    this.db.all(`
      SELECT m.*, u1.name as user1_name, u1.anonymous_id as user1_id, 
             u2.name as user2_name, u2.anonymous_id as user2_id
      FROM matches m
      JOIN users u1 ON m.user1_id = u1.id
      JOIN users u2 ON m.user2_id = u2.id
      WHERE m.user1_id = ? OR m.user2_id = ?
    `, [userId, userId], callback);
  }

  // Message operations
  saveMessage(messageData, callback) {
    const { sender_id, receiver_id, message, coins_sent, message_type } = messageData;
    this.db.run(`
      INSERT INTO messages (sender_id, receiver_id, message, coins_sent, message_type)
      VALUES (?, ?, ?, ?, ?)
    `, [sender_id, receiver_id, message, coins_sent || 0, message_type || 'text'], callback);
  }

  getMessages(user1_id, user2_id, callback) {
    this.db.all(`
      SELECT m.*, u.name as sender_name, u.anonymous_id as sender_anonymous_id
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `, [user1_id, user2_id, user2_id, user1_id], callback);
  }

  // Milestone operations
  addMilestone(userId, milestoneType, milestoneValue, coinsEarned, callback) {
    this.db.run(`
      INSERT INTO milestones (user_id, milestone_type, milestone_value, coins_earned)
      VALUES (?, ?, ?, ?)
    `, [userId, milestoneType, milestoneValue, coinsEarned], callback);
  }

  getUserMilestones(userId, callback) {
    this.db.all('SELECT * FROM milestones WHERE user_id = ? ORDER BY achieved_at DESC', [userId], callback);
  }

  // Coin transaction operations
  addCoinTransaction(transactionData, callback) {
    const { sender_id, receiver_id, amount, transaction_type, message } = transactionData;
    this.db.run(`
      INSERT INTO coin_transactions (sender_id, receiver_id, amount, transaction_type, message)
      VALUES (?, ?, ?, ?, ?)
    `, [sender_id, receiver_id, amount, transaction_type, message], callback);
  }

  // Virtual gifts operations
  getVirtualGifts(callback) {
    this.db.all('SELECT * FROM virtual_gifts ORDER BY category, cost', callback);
  }

  // Game activities
  saveGameActivity(activityData, callback) {
    const { user1_id, user2_id, activity_type, content, is_ai_generated, guess_correct, coins_earned } = activityData;
    this.db.run(`
      INSERT INTO game_activities (user1_id, user2_id, activity_type, content, is_ai_generated, guess_correct, coins_earned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [user1_id, user2_id, activity_type, content, is_ai_generated, guess_correct, coins_earned], callback);
  }

  // Analytics
  getSystemStats(callback) {
    this.db.get(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
        SUM(coins) as total_coins,
        (SELECT COUNT(*) FROM matches) as total_matches,
        (SELECT COUNT(*) FROM messages) as total_messages
      FROM users
    `, callback);
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;
