"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const database_1 = require("./database");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const messages_1 = __importDefault(require("./routes/messages"));
const files_1 = __importDefault(require("./routes/files"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "http://localhost:*",
        methods: ["GET", "POST"]
    }
});
exports.io = io;
const PORT = process.env.PORT || 3001;
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: [
        'http://localhost:5173',
        'http://localhost:3000',
        'file://',
        /^file:\/\//,
        'null' // Allow null origin (common in Electron)
    ],
    credentials: true
}));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Create uploads directory
const fs = require('fs');
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
// Serve uploaded files
app.use('/uploads', express_1.default.static(uploadsDir));
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/messages', messages_1.default);
app.use('/api/files', files_1.default);
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
// Socket.IO for real-time messaging
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.on('join-room', (userId) => {
        socket.join(`user-${userId}`);
        console.log(`User ${userId} joined room`);
    });
    socket.on('send-message', async (data) => {
        const { recipientId, message, senderId, messageType = 'text' } = data;
        try {
            // Save message to database first
            const result = await database_1.db.run('INSERT INTO messages (sender_id, recipient_id, message_text, message_type) VALUES (?, ?, ?, ?)', [senderId, recipientId, message, messageType]);
            // Get the full message data with sender info
            const newMessage = await database_1.db.get(`
        SELECT m.*, u.username as sender_username 
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `, [Number(result.lastInsertRowid)]);
            // Emit to both sender and recipient rooms
            io.to(`user-${recipientId}`).emit('new-message', newMessage);
            io.to(`user-${senderId}`).emit('new-message', newMessage);
        }
        catch (error) {
            console.error('Error saving/sending message:', error);
            socket.emit('message-error', { error: 'Failed to send message' });
        }
    });
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
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
        database_1.db.close().then(() => {
            process.exit(0);
        });
    });
});
//# sourceMappingURL=server.js.map