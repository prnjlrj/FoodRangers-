const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// In-memory cache
const userUniqueWording = new Map();
const userProfiles = new Map(); // userId -> profile

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

// Complete Database Setup
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

    // User Profiles table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNIQUE,
        phone VARCHAR(15),
        addresses JSON,
        order_no VARCHAR(36) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Orders table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS order_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(36),
        user_id INT,
        type ENUM('donate', 'receive') NOT NULL,
        food_type VARCHAR(100),
        quantity VARCHAR(50),
        description TEXT,
        status ENUM('pending', 'accepted', 'completed', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_type (type)
      )
    `);

    console.log('✅ All tables ready - FoodRangers platform active!');
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

// Profile Setup
app.post('/api/profile/setup', async (req, res) => {
    try {
        const { userId, phone, addresses } = req.body;
        const orderNo = uuidv4();

        await pool.execute(
            `INSERT INTO user_profiles (user_id, phone, addresses, order_no) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             phone=VALUES(phone), addresses=VALUES(addresses), order_no=VALUES(order_no)`,
            [userId, phone, JSON.stringify(addresses || []), orderNo]
        );

        // Cache profile
        userProfiles.set(userId, { phone, addresses, orderNo });

        res.json({ 
            message: 'Profile created!', 
            profile: { phone, addresses, orderNo }
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Profile setup failed' });
    }
});

// Create Order
app.post('/api/orders', async (req, res) => {
    try {
        const { userId, orderNo, type, food_type, quantity, description } = req.body;
        
        const orderId = uuidv4();
        
        await pool.execute(
            `INSERT INTO order_details (order_no, user_id, type, food_type, quantity, description) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [orderNo, userId, type, food_type, quantity, description]
        );

        res.json({ 
            message: `Food ${type} posted successfully!`,
            order: { id: orderId, type, food_type, quantity, status: 'pending' }
        });
    } catch (error) {
        console.error('Order error:', error);
        res.status(500).json({ error: 'Order creation failed' });
    }
});

// Get User Orders
app.get('/api/orders/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const [orders] = await pool.execute(
            'SELECT * FROM order_details WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        res.json({ orders });
    } catch (error) {
        console.error('Orders fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get All Open Orders (for matching)
app.get('/api/orders/open', async (req, res) => {
    try {
        const [orders] = await pool.execute(
            `SELECT o.*, u.username, u.account_type, p.phone 
             FROM order_details o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN user_profiles p ON u.id = p.user_id
             WHERE o.status = 'pending' 
             ORDER BY o.created_at DESC`
        );
        res.json({ orders });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch open orders' });
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
        
        res.json({ 
            message: 'Account created successfully!',
            user: { 
                id: result.insertId, 
                username, 
                email,
                account_type: accountType,
                uniqueWording
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login Route
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const [users] = await pool.execute(
            'SELECT id, username, email, password, unique_wording, account_type FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // CamelCase for frontend
        const safeUser = {
            id: user.id,
            username: user.username,
            email: user.email,
            account_type: user.account_type,
            uniqueWording: user.unique_wording
        };
        
        userUniqueWording.set(user.id, user.unique_wording);
        
        res.json({ 
            message: 'Login successful!',
            user: safeUser
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/food-hub.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'food-hub.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 FoodRangers running on http://localhost:${PORT}`);
});
