const router = require('express').Router();
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const Notification = require('../models/Notification');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
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

// Configure multer for group profile photo uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadPath = 'uploads/groups/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
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
    fileSize: 5 * 1024 * 1024 // 5MB limit for profile photos
  },
  fileFilter: function(req, file, cb) {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
      return cb(new Error('Only image files are allowed!'));
    }
    cb(null, true);
  }
});

// Configure multer for message attachments
const messageStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    let uploadPath = 'uploads/';
    if (file.mimetype.startsWith('image/')) {
      uploadPath += 'images/';
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath += 'videos/';
    } else {
      uploadPath += 'documents/';
    }
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const messageUpload = multer({
  storage: messageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Create a new group
router.post('/', auth, upload.single('profilePhoto'), async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const group = new Group({
      name,
      description,
      creator: req.userId,
      profilePhoto: req.file ? `/uploads/groups/${req.file.filename}` : '/uploads/groups/default.svg',
      members: [{ user: req.userId, role: 'admin' }]
    });

    await group.save();
    
    // Populate creator info for response
    await group.populate('creator', 'username profilePhoto');
    await group.populate('members.user', 'username profilePhoto');
    
    res.status(201).json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get all groups where user is a member
router.get('/', auth, async (req, res) => {
  try {
    const groups = await Group.find({
      'members.user': req.userId
    })
    .populate('creator', 'username profilePhoto')
    .populate('members.user', 'username profilePhoto');
    
    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a specific group by ID
router.get('/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('creator', 'username profilePhoto')
      .populate('members.user', 'username profilePhoto');
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if user is a member of the group
    const isMember = group.members.some(member => member.user._id.toString() === req.userId);
    if (!isMember) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    
    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update group details
router.patch('/:groupId', auth, upload.single('profilePhoto'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if user is an admin
    const memberIndex = group.members.findIndex(
      member => member.user.toString() === req.userId && member.role === 'admin'
    );
    
    if (memberIndex === -1) {
      return res.status(403).json({ message: 'Only admins can update group details' });
    }
    
    // Update fields
    if (name) group.name = name;
    if (description) group.description = description;
    if (req.file) group.profilePhoto = `/uploads/groups/${req.file.filename}`;
    
    await group.save();
    await group.populate('creator', 'username profilePhoto');
    await group.populate('members.user', 'username profilePhoto');
    
    res.json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Add a member to the group
router.post('/:groupId/members', auth, async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if user is an admin
    const isAdmin = group.members.some(
      member => member.user.toString() === req.userId && member.role === 'admin'
    );
    
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can add members' });
    }
    
    // Check if the group has reached its member limit
    if (group.members.length >= group.maxMembers) {
      return res.status(400).json({ 
        message: `Group cannot have more than ${group.maxMembers} members` 
      });
    }
    
    // Check if user is already a member
    const isMember = group.members.some(member => member.user.toString() === userId);
    if (isMember) {
      return res.status(400).json({ message: 'User is already a member of this group' });
    }
    
    // Add the new member
    group.members.push({ user: userId, role: 'member' });
    await group.save();
    
    // Create a notification for the added user
    const notification = new Notification({
      recipient: userId,
      sender: req.userId,
      group: group._id,
      type: 'group_invitation',
      content: `You have been added to the group ${group.name}`
    });
    
    await notification.save();
    
    // Emit socket event if available
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(userId).emit('notification', notification);
    }
    
    await group.populate('members.user', 'username profilePhoto');
    res.json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Remove a member from the group
router.delete('/:groupId/members/:userId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if the requester is an admin or the user themselves
    const isAdmin = group.members.some(
      member => member.user.toString() === req.userId && member.role === 'admin'
    );
    
    const isSelf = req.userId === req.params.userId;
    
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ 
        message: 'Only admins can remove members or members can remove themselves' 
      });
    }
    
    // Cannot remove the creator if they're the only admin
    if (req.params.userId === group.creator.toString()) {
      const adminCount = group.members.filter(member => member.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ 
          message: 'Cannot remove the only admin. Transfer admin role to another member first.' 
        });
      }
    }
    
    // Remove the member
    group.members = group.members.filter(member => member.user.toString() !== req.params.userId);
    await group.save();
    
    await group.populate('members.user', 'username profilePhoto');
    res.json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Change member role (promote/demote)
router.patch('/:groupId/members/:userId/role', auth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if the requester is an admin
    const isAdmin = group.members.some(
      member => member.user.toString() === req.userId && member.role === 'admin'
    );
    
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can change member roles' });
    }
    
    // Find the member to update
    const memberIndex = group.members.findIndex(
      member => member.user.toString() === req.params.userId
    );
    
    if (memberIndex === -1) {
      return res.status(404).json({ message: 'Member not found in this group' });
    }
    
    // Cannot demote the creator
    if (req.params.userId === group.creator.toString() && role !== 'admin') {
      return res.status(400).json({ message: 'Cannot change the role of the group creator' });
    }
    
    // Update the role
    group.members[memberIndex].role = role;
    await group.save();
    
    await group.populate('members.user', 'username profilePhoto');
    res.json(group);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete a group
router.delete('/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Only the creator can delete the group
    if (group.creator.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the creator can delete the group' });
    }
    
    // Delete all group messages
    await GroupMessage.deleteMany({ group: req.params.groupId });
    
    // Delete all group-related notifications
    await Notification.deleteMany({ group: req.params.groupId });
    
    // Delete the group
    await Group.findByIdAndDelete(req.params.groupId);
    
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Send a message to the group
router.post('/:groupId/messages', auth, messageUpload.single('attachment'), async (req, res) => {
  try {
    const { content, messageType = 'text' } = req.body;
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if user is a member of the group
    const isMember = group.members.some(member => member.user.toString() === req.userId);
    if (!isMember) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    
    const message = new GroupMessage({
      group: req.params.groupId,
      sender: req.userId,
      content,
      messageType,
      attachmentUrl: req.file ? `/uploads/${req.file.filename}` : '',
      attachmentType: req.file ? req.file.mimetype : '',
      readBy: [{ user: req.userId }] // Mark as read by sender
    });
    
    await message.save();
    
    // Populate sender info for response
    await message.populate('sender', 'username profilePhoto');
    
    // Create notifications for all group members except the sender
    const notifications = [];
    for (const member of group.members) {
      if (member.user.toString() !== req.userId) {
        const notification = new Notification({
          recipient: member.user,
          sender: req.userId,
          group: group._id,
          type: 'group_message',
          groupMessage: message._id,
          content: `New message in ${group.name}`
        });
        
        notifications.push(notification);
      }
    }
    
    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
      
      // Emit socket events for notifications if available
      if (req.app.get('io')) {
        const io = req.app.get('io');
        for (const notification of notifications) {
          io.to(notification.recipient.toString()).emit('notification', notification);
        }
      }
    }
    
    // Emit socket event for the new group message
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`group:${req.params.groupId}`).emit('group message', {
        message,
        group: req.params.groupId
      });
    }
    
    // Invalidate cache for this group's messages
    await deleteCache(`group_messages:${req.params.groupId}:*`);
    
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get group messages with pagination and caching
router.get('/:groupId/messages', auth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 50;
    
    const group = await Group.findById(req.params.groupId);
    
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if user is a member of the group
    const isMember = group.members.some(member => member.user.toString() === req.userId);
    if (!isMember) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    
    // Only use cache middleware for pages > 0 (to keep recent messages fresh)
    if (page > 0) {
      // Use cache middleware with custom key generator
      const cacheKeyGenerator = (req) => {
        const page = parseInt(req.query.page) || 0;
        const limit = parseInt(req.query.limit) || 50;
        return `group_messages:${req.params.groupId}:${req.userId}:${page}:${limit}`;
      };
      
      // Apply cache middleware for this request only
      return cacheMiddleware(300, cacheKeyGenerator)(req, res, next);
    }
    
    // Skip cache for page 0 (most recent messages)
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 50;
    const skip = page * limit;
    
    // Query to exclude deleted messages
    const query = {
      group: req.params.groupId,
      deletedFor: { $not: { $elemMatch: { user: req.userId } } }
    };
    
    // Get total count for pagination info
    const total = await GroupMessage.countDocuments(query);
    
    // Get messages with pagination
    const messages = await GroupMessage.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .skip(skip)
      .limit(limit)
      .populate('sender', 'username profilePhoto')
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

// Mark group message as read
router.patch('/:groupId/messages/:messageId/read', auth, async (req, res) => {
  try {
    const message = await GroupMessage.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    
    // Check if user is a member of the group
    const group = await Group.findById(req.params.groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    const isMember = group.members.some(member => member.user.toString() === req.userId);
    if (!isMember) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    
    // Check if the message is already marked as read by this user
    const alreadyRead = message.readBy.some(read => read.user.toString() === req.userId);
    
    if (!alreadyRead) {
      message.readBy.push({ user: req.userId });
      await message.save();
      
      // Mark related notification as read
      await Notification.updateMany(
        { recipient: req.userId, groupMessage: message._id },
        { isRead: true }
      );
    }
    
    res.json(message);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete group message
router.delete('/:groupId/messages/:messageId', auth, async (req, res) => {
  try {
    const message = await GroupMessage.findById(req.params.messageId);
    
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }
    
    // Check if user is the sender or an admin
    const isSender = message.sender.toString() === req.userId;
    
    const group = await Group.findById(req.params.groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    
    const isAdmin = group.members.some(
      member => member.user.toString() === req.userId && member.role === 'admin'
    );
    
    if (!isSender && !isAdmin) {
      return res.status(403).json({ 
        message: 'Only the sender or group admins can delete messages' 
      });
    }
    
    // Mark as deleted for current user
    if (!message.deletedFor.some(df => df.user === req.userId)) {
      message.deletedFor.push({ user: req.userId });
    }
    
    await message.save();
    
    // Emit socket event for message deletion
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`group:${req.params.groupId}`).emit('group message deleted', {
        messageId: message._id,
        group: req.params.groupId
      });
    }
    
    // Invalidate cache for this group's messages
    await deleteCache(`group_messages:${req.params.groupId}:*`);
    
    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;