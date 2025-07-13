import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import { AddFriendRequest, User, Friendship } from '../types';
import { io } from '../server';

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

// Get user's friends list
router.get('/friends', authenticateToken, async (req: any, res) => {
  try {
    const friends = await db.all(`
      SELECT DISTINCT u.id, u.username, u.friend_code, f.created_at
      FROM friendships f
      JOIN users u ON (
        (f.user_id = ? AND u.id = f.friend_id) OR 
        (f.friend_id = ? AND u.id = f.user_id)
      )
      WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
      ORDER BY u.username
    `, [req.userId, req.userId, req.userId, req.userId]);

    res.json({ success: true, friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ success: false, message: 'Failed to get friends' });
  }
});

// Add friend by friend code
router.post('/add-friend', authenticateToken, async (req: any, res) => {
  try {
    const { friendCode }: AddFriendRequest = req.body;

    if (!friendCode) {
      return res.status(400).json({
        success: false,
        message: 'Friend code is required'
      });
    }

    // Find user by friend code
    const friend: User = await db.get(
      'SELECT id, username, friend_code FROM users WHERE friend_code = ?',
      [friendCode.toUpperCase()]
    );

    if (!friend) {
      return res.status(404).json({
        success: false,
        message: 'Friend code not found'
      });
    }

    if (friend.id === req.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add yourself as a friend'
      });
    }

    // Check if friendship already exists
    const existingFriendship: Friendship = await db.get(`
      SELECT * FROM friendships 
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `, [req.userId, friend.id, friend.id, req.userId]);

    if (existingFriendship) {
      if (existingFriendship.status === 'accepted') {
        return res.status(409).json({
          success: false,
          message: 'Already friends with this user'
        });
      } else {
        return res.status(409).json({
          success: false,
          message: 'Friend request already pending'
        });
      }
    }

    // Create friend request (pending status)
    await db.run(
      'INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)',
      [req.userId, friend.id, 'pending']
    );

    // Get sender info for notification
    const sender = await db.get(
      'SELECT username, friend_code FROM users WHERE id = ?',
      [req.userId]
    );

    // Notify both users to refresh their UIs
    notifyFriendUpdate([req.userId, friend.id]);

    res.json({
      success: true,
      message: `Friend request sent to ${friend.username}`,
      friend: {
        id: friend.id,
        username: friend.username,
        friendCode: friend.friend_code
      }
    });
  } catch (error) {
    console.error('Add friend error:', error);
    res.status(500).json({ success: false, message: 'Failed to add friend' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req: any, res) => {
  try {
    const user: User = await db.get(
      'SELECT id, username, friend_code, is_admin, created_at FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        friendCode: user.friend_code,
        isAdmin: !!user.is_admin,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// Get pending friend requests
router.get('/friend-requests', authenticateToken, async (req: any, res) => {
  try {
    const requests = await db.all(`
      SELECT u.id, u.username, u.friend_code, f.created_at
      FROM friendships f
      JOIN users u ON f.user_id = u.id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.userId]);

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Get friend requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to get friend requests' });
  }
});

// Accept friend request
router.post('/accept-friend', authenticateToken, async (req: any, res) => {
  try {
    const { requesterId } = req.body;

    if (!requesterId) {
      return res.status(400).json({
        success: false,
        message: 'Requester ID is required'
      });
    }

    // Check if friend request exists
    const request = await db.get(
      'SELECT * FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
      [requesterId, req.userId, 'pending']
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Friend request not found'
      });
    }

    // Update the request to accepted
    await db.run(
      'UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?',
      ['accepted', requesterId, req.userId]
    );

    // Get both users' info for notifications
    const requester = await db.get(
      'SELECT username, friend_code FROM users WHERE id = ?',
      [requesterId]
    );
    
    const accepter = await db.get(
      'SELECT username, friend_code FROM users WHERE id = ?',
      [req.userId]
    );

    // Notify both users to refresh their UIs
    notifyFriendUpdate([req.userId, requesterId]);

    res.json({
      success: true,
      message: `You are now friends with ${requester.username}`
    });
  } catch (error) {
    console.error('Accept friend error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept friend request' });
  }
});

// Reject friend request
router.post('/reject-friend', authenticateToken, async (req: any, res) => {
  try {
    const { requesterId } = req.body;

    if (!requesterId) {
      return res.status(400).json({
        success: false,
        message: 'Requester ID is required'
      });
    }

    // Get rejecter info for notification
    const rejecter = await db.get(
      'SELECT username FROM users WHERE id = ?',
      [req.userId]
    );

    // Delete the friend request
    await db.run(
      'DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
      [requesterId, req.userId, 'pending']
    );

    // Notify both users to refresh their UIs
    notifyFriendUpdate([req.userId, requesterId]);

    res.json({
      success: true,
      message: 'Friend request rejected'
    });
  } catch (error) {
    console.error('Reject friend error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject friend request' });
  }
});

// Unfriend a user
router.post('/unfriend', authenticateToken, async (req: any, res) => {
  try {
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: 'Friend ID is required'
      });
    }

    // Check if friendship exists
    const friendship = await db.get(`
      SELECT * FROM friendships 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) 
      AND status = 'accepted'
    `, [req.userId, friendId, friendId, req.userId]);

    if (!friendship) {
      return res.status(404).json({
        success: false,
        message: 'Friendship not found'
      });
    }

    // Get both users' info before deletion
    const unfriender = await db.get(
      'SELECT username FROM users WHERE id = ?',
      [req.userId]
    );
    
    const friend = await db.get(
      'SELECT username FROM users WHERE id = ?',
      [friendId]
    );

    // Delete both directions of the friendship
    await db.run(
      'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.userId, friendId, friendId, req.userId]
    );

    // Notify both users to refresh their UIs
    notifyFriendUpdate([req.userId, friendId]);

    res.json({
      success: true,
      message: `You are no longer friends with ${friend.username}`
    });
  } catch (error) {
    console.error('Unfriend error:', error);
    res.status(500).json({ success: false, message: 'Failed to unfriend user' });
  }
});

// Get all users (for testing/admin purposes)
router.get('/all', authenticateToken, async (req: any, res) => {
  try {
    const users = await db.all(`
      SELECT id, username, friend_code, is_admin, created_at 
      FROM users 
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        friendCode: user.friend_code,
        isAdmin: !!user.is_admin,
        createdAt: user.created_at
      }))
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Failed to get users' });
  }
});

// Helper function to notify users to refresh their friend lists
function notifyFriendUpdate(userIds: number[]) {
  userIds.forEach(userId => {
    io.to(`user-${userId}`).emit('refresh-friends');
  });
}

export default router;