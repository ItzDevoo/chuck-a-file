import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import { SendMessageRequest, Message } from '../types';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// Middleware to verify JWT token
const authenticateToken = (req: any, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Send a message
router.post('/send', authenticateToken, async (req: any, res) => {
  try {
    const { recipientId, message, messageType = 'text' }: SendMessageRequest = req.body;

    if (!recipientId || !message) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID and message are required'
      });
    }

    // Verify that users are friends
    const friendship = await db.get(`
      SELECT * FROM friendships 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) 
      AND status = 'accepted'
    `, [req.userId, recipientId, recipientId, req.userId]);

    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'You can only send messages to friends'
      });
    }

    // Insert message
    const result = await db.run(
      'INSERT INTO messages (sender_id, recipient_id, message_text, message_type) VALUES (?, ?, ?, ?)',
      [req.userId, recipientId, message, messageType]
    );

    const newMessage = await db.get(
      'SELECT * FROM messages WHERE id = ?',
      [Number(result.lastInsertRowid)]
    );

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Get conversation history with a friend
router.get('/conversation/:friendId', authenticateToken, async (req: any, res) => {
  try {
    const friendId = parseInt(req.params.friendId);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: 'Friend ID is required'
      });
    }

    // Verify friendship
    const friendship = await db.get(`
      SELECT * FROM friendships 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) 
      AND status = 'accepted'
    `, [req.userId, friendId, friendId, req.userId]);

    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'You can only view conversations with friends'
      });
    }

    // Get messages
    const messages = await db.all(`
      SELECT m.*, u.username as sender_username 
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.recipient_id = ?) 
         OR (m.sender_id = ? AND m.recipient_id = ?)
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.userId, friendId, friendId, req.userId, limit, offset]);

    res.json({
      success: true,
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        limit,
        offset,
        hasMore: messages.length === limit
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ success: false, message: 'Failed to get conversation' });
  }
});

// Get all conversations for a user
router.get('/conversations', authenticateToken, async (req: any, res) => {
  try {
    const conversations = await db.all(`
      SELECT 
        u.id as friend_id,
        u.username as friend_username,
        u.friend_code,
        m.message_text as last_message,
        m.message_type as last_message_type,
        m.created_at as last_message_time,
        m.sender_id as last_sender_id
      FROM friendships f
      JOIN users u ON (
        CASE 
          WHEN f.user_id = ? THEN u.id = f.friend_id
          ELSE u.id = f.user_id
        END
      )
      LEFT JOIN messages m ON m.id = (
        SELECT m2.id FROM messages m2
        WHERE (m2.sender_id = ? AND m2.recipient_id = u.id) 
           OR (m2.sender_id = u.id AND m2.recipient_id = ?)
        ORDER BY m2.created_at DESC
        LIMIT 1
      )
      WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
      ORDER BY m.created_at DESC
    `, [req.userId, req.userId, req.userId, req.userId, req.userId]);

    res.json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Failed to get conversations' });
  }
});

export default router;