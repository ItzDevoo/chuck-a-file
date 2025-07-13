"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const database_1 = require("../database");
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
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads');
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${(0, uuid_1.v4)()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        // Basic security: reject executable files
        const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.msi'];
        const fileExt = path_1.default.extname(file.originalname).toLowerCase();
        if (dangerousExtensions.includes(fileExt)) {
            return cb(new Error('File type not allowed for security reasons'));
        }
        cb(null, true);
    }
});
// Upload file
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        const { recipientId, message } = req.body;
        if (!recipientId) {
            return res.status(400).json({
                success: false,
                message: 'Recipient ID is required'
            });
        }
        // Verify friendship
        const friendship = await database_1.db.get(`
      SELECT * FROM friendships 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) 
      AND status = 'accepted'
    `, [req.userId, recipientId, recipientId, req.userId]);
        if (!friendship) {
            return res.status(403).json({
                success: false,
                message: 'You can only send files to friends'
            });
        }
        // Create message first if there's accompanying text
        let messageId = null;
        if (message) {
            const messageResult = await database_1.db.run('INSERT INTO messages (sender_id, recipient_id, message_text, message_type) VALUES (?, ?, ?, ?)', [req.userId, recipientId, message, 'file']);
            messageId = Number(messageResult.lastInsertRowid);
        }
        // Save file record to database
        const fileResult = await database_1.db.run(`
      INSERT INTO files (
        filename, original_filename, file_path, file_size, file_type,
        sender_id, recipient_id, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            req.file.filename,
            req.file.originalname,
            req.file.path,
            req.file.size,
            req.file.mimetype,
            req.userId,
            recipientId,
            messageId
        ]);
        res.status(201).json({
            success: true,
            message: 'File uploaded successfully',
            file: {
                id: Number(fileResult.lastInsertRowid),
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype
            }
        });
    }
    catch (error) {
        console.error('File upload error:', error);
        // Clean up uploaded file if database operation failed
        if (req.file && fs_1.default.existsSync(req.file.path)) {
            fs_1.default.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, message: 'Failed to upload file' });
    }
});
// Download file
router.get('/download/:fileId', authenticateToken, async (req, res) => {
    try {
        const fileId = parseInt(req.params.fileId);
        if (!fileId) {
            return res.status(400).json({
                success: false,
                message: 'File ID is required'
            });
        }
        // Get file record
        const fileRecord = await database_1.db.get('SELECT * FROM files WHERE id = ?', [fileId]);
        if (!fileRecord) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        // Check if user is authorized (sender or recipient)
        if (fileRecord.sender_id !== req.userId && fileRecord.recipient_id !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        // Check if file exists on disk
        if (!fs_1.default.existsSync(fileRecord.file_path)) {
            return res.status(404).json({
                success: false,
                message: 'File no longer exists on server'
            });
        }
        // Update download timestamp if recipient is downloading
        if (fileRecord.recipient_id === req.userId && !fileRecord.downloaded_at) {
            await database_1.db.run('UPDATE files SET downloaded_at = CURRENT_TIMESTAMP WHERE id = ?', [fileId]);
        }
        // Send file
        res.download(fileRecord.file_path, fileRecord.original_filename, (err) => {
            if (err) {
                console.error('File download error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ success: false, message: 'Failed to download file' });
                }
            }
        });
    }
    catch (error) {
        console.error('Download file error:', error);
        res.status(500).json({ success: false, message: 'Failed to download file' });
    }
});
// Get files for a conversation
router.get('/conversation/:friendId', authenticateToken, async (req, res) => {
    try {
        const friendId = parseInt(req.params.friendId);
        if (!friendId) {
            return res.status(400).json({
                success: false,
                message: 'Friend ID is required'
            });
        }
        // Verify friendship
        const friendship = await database_1.db.get(`
      SELECT * FROM friendships 
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) 
      AND status = 'accepted'
    `, [req.userId, friendId, friendId, req.userId]);
        if (!friendship) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        // Get files
        const files = await database_1.db.all(`
      SELECT f.*, u.username as sender_username
      FROM files f
      JOIN users u ON f.sender_id = u.id
      WHERE (f.sender_id = ? AND f.recipient_id = ?) 
         OR (f.sender_id = ? AND f.recipient_id = ?)
      ORDER BY f.uploaded_at DESC
    `, [req.userId, friendId, friendId, req.userId]);
        res.json({
            success: true,
            files
        });
    }
    catch (error) {
        console.error('Get conversation files error:', error);
        res.status(500).json({ success: false, message: 'Failed to get files' });
    }
});
exports.default = router;
//# sourceMappingURL=files.js.map