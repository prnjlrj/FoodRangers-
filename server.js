const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// In-memory cache with defaults
const userUniqueWording = new Map();
const userProfiles = new Map();

const DEFAULT_PROFILE = {
    profile_uuid: null,
    phone: '',
    addresses: [],
    order_no: ''
};

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'type',
    password: 'random@123',
    database: 'foodrangers',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ✅ FIXED Database Setup - No JSON defaults
async function initDatabase() {
  try {
    // Users table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        account_type ENUM('individual', 'organisation') NOT NULL DEFAULT 'individual',
        unique_wording VARCHAR(36) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FIXED profile_details table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS profile_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNIQUE,
        profile_uuid VARCHAR(36) UNIQUE,
        phone VARCHAR(15) DEFAULT '',
        addresses JSON,
        order_no VARCHAR(36) UNIQUE DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Tables ready - FoodRangers active!');
  } catch (error) {
    console.error('❌ Database error:', error);
  }
}

initDatabase();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Get unique wording
app.get('/api/user/:userId/unique-wording', (req, res) => {
    const userId = parseInt(req.params.userId);
    const uniqueWording = userUniqueWording.get(userId);
    if (!uniqueWording) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json({ uniqueWording });
});

// Profile Setup with profile_uuid
app.post('/api/profile/setup', async (req, res) => {
    try {
        const { userId, phone, addresses } = req.body;
        const profileUuid = uuidv4();
        const orderNo = uuidv4();

        await pool.execute(
            `INSERT INTO profile_details (user_id, profile_uuid, phone, addresses, order_no) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             profile_uuid=VALUES(profile_uuid),
             phone=VALUES(phone), 
             addresses=VALUES(addresses), 
             order_no=VALUES(order_no)`,
            [userId, profileUuid, phone || '', JSON.stringify(addresses || []), orderNo]
        );

        const profileData = {
            profile_uuid: profileUuid,
            phone: phone || '',
            addresses: addresses || [],
            order_no: orderNo
        };
        userProfiles.set(userId, profileData);

        res.json({ 
            message: 'Profile created successfully!', 
            profile: profileData
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Profile setup failed' });
    }
});

// Get User Profile (cache + safe defaults)
app.get('/api/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let profile = userProfiles.get(parseInt(userId));
        
        if (!profile) {
            const [profiles] = await pool.execute(
                'SELECT * FROM profile_details WHERE user_id = ?',
                [userId]
            );
            profile = profiles[0] || { ...DEFAULT_PROFILE, user_id: parseInt(userId) };
            
            // Safe JSON parse
            try {
                profile.addresses = profile.addresses ? JSON.parse(profile.addresses) : [];
            } catch (e) {
                profile.addresses = [];
            }
            
            userProfiles.set(parseInt(userId), profile);
        }
        
        res.json({ profile });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Signup Route
app.post('/signup', async (req, res) => {
    try {
        const { username, email, password, confirmPassword, accountType } = req.body;

        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        if (!['individual', 'organisation'].includes(accountType)) {
            return res.status(400).json({ error: 'Invalid account type' });
        }

        const [existing] = await pool.execute(
            'SELECT * FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const uniqueWording = uuidv4();
        
        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password, account_type, unique_wording) VALUES (?, ?, ?, ?, ?)',
            [username, email, hashedPassword, accountType, uniqueWording]
        );
        
        userUniqueWording.set(result.insertId, uniqueWording);
        userProfiles.set(result.insertId, { ...DEFAULT_PROFILE, user_id: result.insertId });
        
        console.log(`✅ New user: ${username} (ID: ${result.insertId})`);
        
        res.json({ 
            message: 'Account created successfully!',
            user: { 
                id: result.insertId, 
                username, 
                email,
                account_type: accountType,
                uniqueWording,
                phone: '',           // ✅ Empty defaults
                addresses: [],       // ✅ Empty array
                order_no: '',
                profile_uuid: null
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ✅ UPDATED Login Route - Includes Profile Data (Phone + Addresses)
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const [users] = await pool.execute(`
            SELECT u.id, u.username, u.email, u.password, u.unique_wording, u.account_type,
                   p.phone, p.addresses, p.order_no, p.profile_uuid
            FROM users u
            LEFT JOIN profile_details p ON u.id = p.user_id
            WHERE u.email = ?
        `, [email]);

        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Safe JSON parse addresses
        let addresses = [];
        try {
            addresses = user.addresses ? JSON.parse(user.addresses) : [];
        } catch (e) {
            addresses = [];
        }

        // Complete user object with profile (BLANK if no profile)
        const safeUser = {
            id: user.id,
            username: user.username,
            email: user.email,
            account_type: user.account_type,
            uniqueWording: user.unique_wording,
            phone: user.phone || '',
            addresses: addresses,
            order_no: user.order_no || '',
            profile_uuid: user.profile_uuid || null
        };
        
        userUniqueWording.set(user.id, user.unique_wording);
        userProfiles.set(user.id, safeUser);
        
        console.log(`✅ Login: ${user.username} (Phone: ${user.phone || 'N/A'})`);
        
        res.json({ 
            message: 'Login successful!',
            user: safeUser  // ✅ Includes phone + addresses (empty if no profile)!
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 FoodRangers running on http://localhost:${PORT}`);
});
