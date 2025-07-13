import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import { CreateUserRequest, LoginRequest, AuthResponse, User } from '../types';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, password }: CreateUserRequest = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if username already exists
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Generate unique friend code
    let friendCode: string;
    let codeExists = true;
    do {
      friendCode = db.generateFriendCode();
      const existing = await db.get('SELECT id FROM users WHERE friend_code = ?', [friendCode]);
      codeExists = !!existing;
    } while (codeExists);

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const result = await db.run(
      'INSERT INTO users (username, password_hash, friend_code) VALUES (?, ?, ?)',
      [username, passwordHash, friendCode]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: Number(result.lastInsertRowid), username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const response: AuthResponse = {
      success: true,
      message: 'User registered successfully',
      user: {
        id: Number(result.lastInsertRowid),
        username,
        friendCode,
        isAdmin: false
      },
      token
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { username, password }: LoginRequest = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Find user
    const user: User = await db.get(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Update last login
    await db.run(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const response: AuthResponse = {
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        friendCode: user.friend_code,
        isAdmin: !!user.is_admin
      },
      token
    };

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Verify token endpoint
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user: User = await db.get(
      'SELECT id, username, friend_code, is_admin FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        friendCode: user.friend_code,
        isAdmin: !!user.is_admin
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

export default router;