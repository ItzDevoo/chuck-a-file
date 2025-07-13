"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../database");
const server_1 = require("../server");
const router = express_1.default.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};
// Get user's friends list
router.get('/friends', authenticateToken, async (req, res) => {
    try {
        const friends = await database_1.db.all(`
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
    }
    catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ success: false, message: 'Failed to get friends' });
    }
});
// Add friend by friend code
router.post('/add-friend', authenticateToken, async (req, res) => {
    try {
        const { friendCode } = req.body;
        if (!friendCode) {
            return res.status(400).json({
                success: false,
                message: 'Friend code is required'
            });
        }
        // Find user by friend code
        const friend = await database_1.db.get('SELECT id, username, friend_code FROM users WHERE friend_code = ?', [friendCode.toUpperCase()]);
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
        const existingFriendship = await database_1.db.get(`
      SELECT * FROM friendships 
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `, [req.userId, friend.id, friend.id, req.userId]);
        if (existingFriendship) {
            if (existingFriendship.status === 'accepted') {
                return res.status(409).json({
                    success: false,
                    message: 'Already friends with this user'
                });
            }
            else {
                return res.status(409).json({
                    success: false,
                    message: 'Friend request already pending'
                });
            }
        }
        // Create friend request (pending status)
        await database_1.db.run('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)', [req.userId, friend.id, 'pending']);
        // Get sender info for notification
        const sender = await database_1.db.get('SELECT username, friend_code FROM users WHERE id = ?', [req.userId]);
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
    }
    catch (error) {
        console.error('Add friend error:', error);
        res.status(500).json({ success: false, message: 'Failed to add friend' });
    }
});
// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await database_1.db.get('SELECT id, username, friend_code, is_admin, created_at FROM users WHERE id = ?', [req.userId]);
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
    }
    catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'Failed to get profile' });
    }
});
// Get pending friend requests
router.get('/friend-requests', authenticateToken, async (req, res) => {
    try {
        const requests = await database_1.db.all(`
      SELECT u.id, u.username, u.friend_code, f.created_at
      FROM friendships f
      JOIN users u ON f.user_id = u.id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.userId]);
        res.json({ success: true, requests });
    }
    catch (error) {
        console.error('Get friend requests error:', error);
        res.status(500).json({ success: false, message: 'Failed to get friend requests' });
    }
});
// Accept friend request
router.post('/accept-friend', authenticateToken, async (req, res) => {
    try {
        const { requesterId } = req.body;
        if (!requesterId) {
            return res.status(400).json({
                success: false,
                message: 'Requester ID is required'
            });
        }
        // Check if friend request exists
        const request = await database_1.db.get('SELECT * FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?', [requesterId, req.userId, 'pending']);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Friend request not found'
            });
        }
        // Update the request to accepted
        await database_1.db.run('UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?', ['accepted', requesterId, req.userId]);
        // Get both users' info for notifications
        const requester = await database_1.db.get('SELECT username, friend_code FROM users WHERE id = ?', [requesterId]);
        const accepter = await database_1.db.get('SELECT username, friend_code FROM users WHERE id = ?', [req.userId]);
        // Notify both users to refresh their UIs
        notifyFriendUpdate([req.userId, requesterId]);
        res.json({
            success: true,
            message: `You are now friends with ${requester.username}`
        });
    }
    catch (error) {
        console.error('Accept friend error:', error);
        res.status(500).json({ success: false, message: 'Failed to accept friend request' });
    }
});
// Reject friend request
router.post('/reject-friend', authenticateToken, async (req, res) => {
    try {
        const { requesterId } = req.body;
        if (!requesterId) {
            return res.status(400).json({
                success: false,
                message: 'Requester ID is required'
            });
        }
        // Get rejecter info for notification
        const rejecter = await database_1.db.get('SELECT username FROM users WHERE id = ?', [req.userId]);
        // Delete the friend request
        await database_1.db.run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?', [requesterId, req.userId, 'pending']);
        // Notify both users to refresh their UIs
        notifyFriendUpdate([req.userId, requesterId]);
        res.json({
            success: true,
            message: 'Friend request rejected'
        });
    }
    catch (error) {
        console.error('Reject friend error:', error);
        res.status(500).json({ success: false, message: 'Failed to reject friend request' });
    }
});
// Unfriend a user
router.post('/unfriend', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        if (!friendId) {
            return res.status(400).json({
                success: false,
                message: 'Friend ID is required'
            });
        }
        // Check if friendship exists
        const friendship = await database_1.db.get(`
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
        const unfriender = await database_1.db.get('SELECT username FROM users WHERE id = ?', [req.userId]);
        const friend = await database_1.db.get('SELECT username FROM users WHERE id = ?', [friendId]);
        // Delete both directions of the friendship
        await database_1.db.run('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [req.userId, friendId, friendId, req.userId]);
        // Notify both users to refresh their UIs
        notifyFriendUpdate([req.userId, friendId]);
        res.json({
            success: true,
            message: `You are no longer friends with ${friend.username}`
        });
    }
    catch (error) {
        console.error('Unfriend error:', error);
        res.status(500).json({ success: false, message: 'Failed to unfriend user' });
    }
});
// Get all users (for testing/admin purposes)
router.get('/all', authenticateToken, async (req, res) => {
    try {
        const users = await database_1.db.all(`
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
    }
    catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ success: false, message: 'Failed to get users' });
    }
});
// Helper function to notify users to refresh their friend lists
function notifyFriendUpdate(userIds) {
    userIds.forEach(userId => {
        server_1.io.to(`user-${userId}`).emit('refresh-friends');
    });
}
exports.default = router;
//# sourceMappingURL=users.js.map