const router = require('express').Router();
const Message = require('../models/Message');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getCache, setCache, deleteCache } = require('../utils/cache');
const cacheMiddleware = require('../middleware/cache');

// Middleware to verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Please authenticate' });
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    let uploadPath = 'uploads/';
    if (file.mimetype.startsWith('image/')) {
      uploadPath += 'images/';
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath += 'videos/';
    } else {
      uploadPath += 'documents/';
    }
    cb(null, uploadPath);
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Send message
router.post('/:receiverId', auth, upload.single('attachment'), async (req, res) => {
  try {
    const { content, messageType = 'text' } = req.body;
    
    // Check if receiver is online
    let status = 'sent';
    let deliveredAt = null;
    
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const onlineUsers = io.sockets.adapter.rooms;
      
      // If receiver is online, mark as delivered
      if (onlineUsers.has(req.params.receiverId)) {
        status = 'delivered';
        deliveredAt = new Date();
      }
    }
    
    const message = new Message({
      sender: req.userId,
      receiver: req.params.receiverId,
      content,
      messageType,
      attachmentUrl: req.file ? `/uploads/${req.file.filename}` : '',
      attachmentType: req.file ? req.file.mimetype : '',
      status,
      deliveredAt
    });

    await message.save();
    
    // Create a notification for the receiver
    const Notification = require('../models/Notification');
    const notification = new Notification({
      recipient: req.params.receiverId,
      sender: req.userId,
      type: 'message',
      message: message._id,
      content: messageType === 'text' ? 
        content.length > 30 ? content.substring(0, 30) + '...' : content :
        `New ${messageType} message`
    });
    
    await notification.save();
    
    // Emit socket event for notification if available
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(req.params.receiverId).emit('notification', notification);
    }
    
    // Invalidate cache for this conversation
    // Use pattern to delete all cached pages for this conversation
    await deleteCache(`messages:${req.userId}:${req.params.receiverId}:*`);
    await deleteCache(`messages:${req.params.receiverId}:${req.userId}:*`);
    
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get conversation history with pagination
router.get('/:userId', auth, (req, res, next) => {
  // Only cache pages > 0 to keep recent messages fresh
  const page = parseInt(req.query.page) || 0;
  
  if (page > 0) {
    // Use cache middleware with custom key generator
    const cacheKeyGenerator = (req) => {
      const page = parseInt(req.query.page) || 0;
      const limit = parseInt(req.query.limit) || 50;
      return `messages:${req.userId}:${req.params.userId}:${page}:${limit}`;
    };
    
    // Apply cache middleware for this request only
    return cacheMiddleware(300, cacheKeyGenerator)(req, res, next);
  }
  
  // Skip cache for page 0 (most recent messages)
  next();
}, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 50;
    const skip = page * limit;
    
    // Query to exclude deleted messages
    const query = {
      $or: [
        { sender: req.userId, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.userId }
      ],
      // Exclude messages that are deleted for the current user or deleted for everyone
      $nor: [
        { deletedFor: { $elemMatch: { user: req.userId, deletedForEveryone: false } } },
        { deletedFor: { $elemMatch: { deletedForEveryone: true } } }
      ]
    };
    
    // Get total count for pagination info
    const total = await Message.countDocuments(query);
    
    // Get messages with pagination
    const messages = await Message.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .skip(skip)
      .limit(limit)
      .populate('sender', 'username profilePhoto')
      .populate('receiver', 'username profilePhoto')
      .lean(); // Convert to plain JS objects for better performance

    const result = {
      messages: messages.reverse(), // Reverse to get chronological order
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mark message as read
router.patch('/:messageId/read', auth, async (req, res) => {
  try {
    const now = new Date();
    const message = await Message.findOneAndUpdate(
      { _id: req.params.messageId, receiver: req.userId },
      { 
        read: true,
        status: 'read',
        readAt: now
      },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    
    // Mark related notification as read
    const Notification = require('../models/Notification');
    await Notification.updateMany(
      { recipient: req.userId, message: message._id },
      { isRead: true }
    );

    // Emit socket event to notify sender that message was read
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(message.sender.toString()).emit('message_status_update', {
        messageId: message._id,
        status: 'read',
        readAt: now
      });
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete message
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const { deleteForEveryone } = req.query;
    const message = await Message.findOne({ _id: req.params.messageId });

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Only sender can delete for everyone
    if (deleteForEveryone === 'true' && message.sender.toString() !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to delete for everyone' });
    }

    if (deleteForEveryone === 'true') {
      // Mark as deleted for everyone
      message.deletedFor = [
        { user: message.sender.toString(), deletedForEveryone: true },
        { user: message.receiver.toString(), deletedForEveryone: true }
      ];
    } else {
      // Mark as deleted for current user only
      if (!message.deletedFor.some(df => df.user === req.userId && !df.deletedForEveryone)) {
        message.deletedFor.push({ user: req.userId, deletedForEveryone: false });
      }
    }

    await message.save();

    // Emit socket event for real-time update
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const toUser = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
      io.to(toUser).emit('message deleted', {
        messageId: message._id,
        from: req.userId,
        to: toUser
      });
    }
    
    // Invalidate cache for this conversation
    const receiverId = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
    await deleteCache(`messages:${req.userId}:${receiverId}:*`);
    await deleteCache(`messages:${receiverId}:${req.userId}:*`);

    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add reaction to message
router.post('/:messageId/reactions', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    
    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }
    
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    
    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
      reaction => reaction.user.toString() === req.userId && reaction.emoji === emoji
    );
    
    if (existingReaction) {
      // Remove the reaction if it already exists (toggle behavior)
      message.reactions = message.reactions.filter(
        reaction => !(reaction.user.toString() === req.userId && reaction.emoji === emoji)
      );
    } else {
      // Remove any existing reaction from this user (only one reaction per user)
      message.reactions = message.reactions.filter(
        reaction => reaction.user.toString() !== req.userId
      );
      
      // Add the new reaction
      message.reactions.push({
        user: req.userId,
        emoji,
        createdAt: new Date()
      });
    }
    
    await message.save();
    
    // Emit socket event for real-time update
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const toUser = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
      io.to(toUser).emit('message_reaction', {
        messageId: message._id,
        reactions: message.reactions,
        from: req.userId,
        to: toUser
      });
    }
    
    // Invalidate cache for this conversation
    const receiverId = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
    await deleteCache(`messages:${req.userId}:${receiverId}:*`);
    await deleteCache(`messages:${receiverId}:${req.userId}:*`);
    
    res.json(message.reactions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove reaction from message
router.delete('/:messageId/reactions/:emoji', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    
    // Remove the reaction
    message.reactions = message.reactions.filter(
      reaction => !(reaction.user.toString() === req.userId && reaction.emoji === req.params.emoji)
    );
    
    await message.save();
    
    // Emit socket event for real-time update
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const toUser = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
      io.to(toUser).emit('message_reaction', {
        messageId: message._id,
        reactions: message.reactions,
        from: req.userId,
        to: toUser
      });
    }
    
    // Invalidate cache for this conversation
    const receiverId = message.sender.toString() === req.userId ? message.receiver.toString() : message.sender.toString();
    await deleteCache(`messages:${req.userId}:${receiverId}:*`);
    await deleteCache(`messages:${receiverId}:${req.userId}:*`);
    
    res.json(message.reactions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get conversation history (updated to handle deleted messages)
router.get('/:userId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.userId, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.userId }
      ],
      'deletedFor': {
        $not: {
          $elemMatch: {
            $or: [
              { user: req.userId, deletedForEveryone: false },
              { deletedForEveryone: true }
            ]
          }
        }
      }
    })
    .sort({ createdAt: 1 })
    .populate('sender', 'username profilePhoto')
    .populate('receiver', 'username profilePhoto');

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;