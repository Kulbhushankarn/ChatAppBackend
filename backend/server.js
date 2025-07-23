const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
// const { initRedis } = require('./utils/cache');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Use optimized compression middleware
const configureCompression = require('./middleware/compression');
app.use(configureCompression());

// Serve static files with cache control
app.use('/uploads', express.static('uploads', {
  maxAge: '1d', // Cache for 1 day
  etag: true, // Use ETags for cache validation
  lastModified: true // Use Last-Modified headers
}));

// MongoDB Connection
// Use environment variable for MongoDB connection string
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.log('MongoDB Connection Error:', err));

// Initialize Redis for caching
// initRedis().catch(err => console.log('Redis initialization skipped:', err));

// Make io available in routes
app.set('io', io);

// Track online users and their status
const onlineUsers = new Map();
const userLastActive = new Map();

// Create uploads directories if they don't exist
const createUploadDirs = () => {
  const dirs = [
    'uploads/profiles',
    'uploads/groups',
    'uploads/images',
    'uploads/videos',
    'uploads/documents'
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createUploadDirs();

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('join', async (userId) => {
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.set(userId.toString(), socket.id);
    userLastActive.set(userId.toString(), new Date());
    console.log(`User ${userId} joined`);
    
    // Update user's online status and last active time in database
    try {
      const User = require('./models/User');
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastActive: new Date()
      });
    } catch (err) {
      console.error('Error updating user status:', err);
    }
    
    // Broadcast to all users that this user is online
    io.emit('user_status_change', { 
      userId: userId.toString(), 
      status: 'online',
      lastActive: new Date()
    });
    
    // Send updated online users list to all clients
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });

  // Join a group chat room
  socket.on('join group', (groupId) => {
    socket.join(`group:${groupId}`);
    console.log(`User ${socket.userId} joined group ${groupId}`);
  });

  // Leave a group chat room
  socket.on('leave group', (groupId) => {
    socket.leave(`group:${groupId}`);
    console.log(`User ${socket.userId} left group ${groupId}`);
  });

  socket.on('private message', async ({ to, message, from }) => {
    // Check if recipient is online
    const isRecipientOnline = onlineUsers.has(to.toString());
    
    // Update message status based on recipient's online status
    try {
      const Message = require('./models/Message');
      const messageStatus = isRecipientOnline ? 'delivered' : 'sent';
      const updateData = { 
        status: messageStatus
      };
      
      if (messageStatus === 'delivered') {
        updateData.deliveredAt = new Date();
      }
      
      await Message.findByIdAndUpdate(message._id, updateData);
      
      // Add status to the message object before sending
      message.status = messageStatus;
      if (messageStatus === 'delivered') {
        message.deliveredAt = new Date();
      }
    } catch (err) {
      console.error('Error updating message status:', err);
    }
    
    io.to(to).emit('private message', { message, from, to });
    io.to(from).emit('private message', { message, from, to });
  });

  socket.on('group message', ({ groupId, message }) => {
    io.to(`group:${groupId}`).emit('group message', { message, group: groupId });
  });

  socket.on('message deleted', ({ messageId, to, from }) => {
    io.to(to).emit('message deleted', { messageId, from, to });
    io.to(from).emit('message deleted', { messageId, from, to });
  });

  socket.on('group message deleted', ({ messageId, groupId }) => {
    io.to(`group:${groupId}`).emit('group message deleted', { messageId, group: groupId });
  });

  socket.on('get_online_users', () => {
    console.log('Sending online users:', Array.from(onlineUsers.keys()));
    socket.emit('online_users', Array.from(onlineUsers.keys()));
    // Also broadcast to all users to ensure everyone has the latest list
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });

  // Handle message read receipts
  socket.on('message_read', async ({ messageId }) => {
    try {
      const Message = require('./models/Message');
      const message = await Message.findByIdAndUpdate(messageId, {
        status: 'read',
        read: true,
        readAt: new Date()
      }, { new: true });
      
      if (message) {
        // Notify the sender that their message was read
        io.to(message.sender.toString()).emit('message_status_update', {
          messageId: message._id,
          status: 'read',
          readAt: message.readAt
        });
      }
    } catch (err) {
      console.error('Error updating message read status:', err);
    }
  });
  
  // Handle notification deletion
  socket.on('notification_deleted', ({ notificationId, recipientId }) => {
    // Broadcast to the recipient that a notification was deleted
    io.to(recipientId).emit('notification_deleted', { notificationId });
  });
  
  // Handle all notifications deletion
  socket.on('all_notifications_deleted', ({ recipientId }) => {
    // Broadcast to the recipient that all notifications were deleted
    io.to(recipientId).emit('all_notifications_deleted');
  });
  
  socket.on('disconnect', async () => {
    if (socket.userId) {
      const userId = socket.userId.toString();
      const lastActiveTime = new Date();
      
      // Update last active time in memory
      userLastActive.set(userId, lastActiveTime);
      
      // Update user's online status and last active time in database
      try {
        const User = require('./models/User');
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastActive: lastActiveTime
        });
      } catch (err) {
        console.error('Error updating user status on disconnect:', err);
      }
      
      onlineUsers.delete(userId);
      
      // Broadcast to all users that this user is offline
      io.emit('user_status_change', { 
        userId: userId, 
        status: 'offline',
        lastActive: lastActiveTime
      });
      
      // Send updated online users list to all clients
      io.emit('online_users', Array.from(onlineUsers.keys()));
    }
    console.log('Client disconnected');
  });
});

// Endpoint to get online users
app.get('/api/users/online', (req, res) => {
  // Ensure all user IDs are strings for consistency
  const onlineUserIds = Array.from(onlineUsers.keys()).map(id => id.toString());
  console.log('API returning online users:', onlineUserIds);
  res.json(onlineUserIds);
});

// Endpoint to get user's last active time
app.get('/api/users/:userId/last-active', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // First check in-memory map for most up-to-date information
    if (userLastActive.has(userId)) {
      return res.json({ lastActive: userLastActive.get(userId) });
    }
    
    // If not in memory, get from database
    const User = require('./models/User');
    const user = await User.findById(userId).select('lastActive isOnline');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ 
      lastActive: user.lastActive,
      isOnline: user.isOnline
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/notifications', require('./routes/notifications'));
app.use(configureCompression());

//const PORT = process.env.PORT || 5000;
const apiBaseUrl = process.env.REACT_APP_API_BASE_URL;

server.listen(apiBaseUrl, () => {
  console.log(`Server running on port ${apiBaseUrl}`);
});
