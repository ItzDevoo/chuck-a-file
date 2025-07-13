import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database';
import { FileRecord } from '../types';

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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Basic security: reject executable files
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.msi'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (dangerousExtensions.includes(fileExt)) {
      return cb(new Error('File type not allowed for security reasons'));
    }
    
    cb(null, true);
  }
});

// Upload file
router.post('/upload', authenticateToken, upload.single('file'), async (req: any, res) => {
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
    const friendship = await db.get(`
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
      const messageResult = await db.run(
        'INSERT INTO messages (sender_id, recipient_id, message_text, message_type) VALUES (?, ?, ?, ?)',
        [req.userId, recipientId, message, 'file']
      );
      messageId = Number(messageResult.lastInsertRowid);
    }

    // Save file record to database
    const fileResult = await db.run(`
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
  } catch (error) {
    console.error('File upload error:', error);
    
    // Clean up uploaded file if database operation failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ success: false, message: 'Failed to upload file' });
  }
});

// Download file
router.get('/download/:fileId', authenticateToken, async (req: any, res) => {
  try {
    const fileId = parseInt(req.params.fileId);

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: 'File ID is required'
      });
    }

    // Get file record
    const fileRecord: FileRecord = await db.get(
      'SELECT * FROM files WHERE id = ?',
      [fileId]
    );

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
    if (!fs.existsSync(fileRecord.file_path)) {
      return res.status(404).json({
        success: false,
        message: 'File no longer exists on server'
      });
    }

    // Update download timestamp if recipient is downloading
    if (fileRecord.recipient_id === req.userId && !fileRecord.downloaded_at) {
      await db.run(
        'UPDATE files SET downloaded_at = CURRENT_TIMESTAMP WHERE id = ?',
        [fileId]
      );
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
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ success: false, message: 'Failed to download file' });
  }
});

// Get files for a conversation
router.get('/conversation/:friendId', authenticateToken, async (req: any, res) => {
  try {
    const friendId = parseInt(req.params.friendId);

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
        message: 'Access denied'
      });
    }

    // Get files
    const files = await db.all(`
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
  } catch (error) {
    console.error('Get conversation files error:', error);
    res.status(500).json({ success: false, message: 'Failed to get files' });
  }
});

export default router;