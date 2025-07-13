import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { db } from './database';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import messageRoutes from './routes/messages';
import fileRoutes from './routes/files';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:*", // Allow any localhost port
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000',
    'file://', // Allow file:// protocol for Electron
    /^file:\/\//, // Allow any file:// URLs
    'null' // Allow null origin (common in Electron)
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create uploads directory
const fs = require('fs');
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/files', fileRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.IO for real-time messaging
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (userId: string) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined room`);
  });

  socket.on('send-message', async (data) => {
    const { recipientId, message, senderId, messageType = 'text' } = data;
    
    try {
      // Save message to database first
      const result = await db.run(
        'INSERT INTO messages (sender_id, recipient_id, message_text, message_type) VALUES (?, ?, ?, ?)',
        [senderId, recipientId, message, messageType]
      );

      // Get the full message data with sender info
      const newMessage = await db.get(`
        SELECT m.*, u.username as sender_username 
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `, [Number(result.lastInsertRowid)]);

      // Emit to both sender and recipient rooms
      io.to(`user-${recipientId}`).emit('new-message', newMessage);
      io.to(`user-${senderId}`).emit('new-message', newMessage);
      
    } catch (error) {
      console.error('Error saving/sending message:', error);
      socket.emit('message-error', { error: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Start server
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`ChuckAFile backend server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server accessible at:`);
  console.log(`  Local: http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    db.close().then(() => {
      process.exit(0);
    });
  });
});

export { io };