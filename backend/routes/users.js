const router = require('express').Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const upload = require('../middleware/upload');
const fs = require('fs');
const path = require('path');

// Middleware to verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'Server configuration error: JWT_SECRET not set' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Please authenticate' });
  }
};

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password')
      .populate('friends', 'username email profilePhoto')
      .populate('friendRequests.from', 'username email profilePhoto');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user details by ID
router.get('/details/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password -friendRequests')
      .populate('friends', 'username email profilePhoto');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's last active time
router.get('/:userId/last-active', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('lastActive isOnline');
    
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

// Delete profile photo
router.delete('/profile/photo', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    // Don't delete if it's the default photo
    if (user.profilePhoto === '/uploads/profiles/default.svg') {
      return res.status(400).json({ message: 'Cannot delete default profile photo' });
    }

    // Delete the old photo file
    const oldPhotoPath = path.join(__dirname, '..', user.profilePhoto);
    if (fs.existsSync(oldPhotoPath)) {
      fs.unlinkSync(oldPhotoPath);
    }

    // Reset to default photo
    user.profilePhoto = '/uploads/profiles/default.svg';
    await user.save();

    res.json({ profilePhoto: user.profilePhoto });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload profile photo
router.post('/profile/photo', auth, upload.single('profilePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a file' });
    }

    const user = await User.findById(req.userId);
    
    // Delete old profile photo if it exists and is not the default
    if (user.profilePhoto && user.profilePhoto !== '/uploads/profiles/default.png') {
      const oldPhotoPath = path.join(__dirname, '..', user.profilePhoto);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }

    // Update user's profile photo path
    user.profilePhoto = '/uploads/profiles/' + req.file.filename;
    await user.save();

    res.json({ profilePhoto: user.profilePhoto });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update profile
router.patch('/profile', auth, async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const allowedUpdates = [
      'username', 
      'email',
      'personalInfo',
      'professionalInfo',
      'interests'
    ];
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) {
      return res.status(400).json({ error: 'Invalid updates!' });
    }

    const user = await User.findById(req.user.id);
    updates.forEach(update => {
      if (update === 'personalInfo' || update === 'professionalInfo' || update === 'interests') {
        user[update] = { ...user[update], ...req.body[update] };
      } else {
        user[update] = req.body[update];
      }
    });
    await user.save();

    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Search users
router.get('/search', auth, async (req, res) => {
  try {
    const searchQuery = req.query.q;
    const currentUser = await User.findById(req.userId);
    
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get users matching the search query
    const users = await User.find({
      $and: [
        { _id: { $ne: req.userId } },
        {
          $or: [
            { username: { $regex: searchQuery, $options: 'i' } },
            { email: { $regex: searchQuery, $options: 'i' } }
          ]
        }
      ]
    }).select('username email profilePhoto');
    
    // Check for each user if there's a pending friend request
    const usersWithRequestStatus = await Promise.all(users.map(async (user) => {
      // Check if the current user has already sent a request to this user
      const targetUser = await User.findById(user._id);
      const hasReceivedRequest = targetUser.friendRequests.some(
        request => request.from.toString() === req.userId && request.status === 'pending'
      );
      
      // Check if they are already friends
      const isFriend = currentUser.friends.some(
        friendId => friendId.toString() === user._id.toString()
      );
      
      return {
        ...user.toObject(),
        requestSent: hasReceivedRequest || isFriend
      };
    }));
    
    res.json(usersWithRequestStatus);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ message: err.message });
  }
});

// Send friend request
router.post('/friend-request/:userId', auth, async (req, res) => {
  try {
    const receiver = await User.findById(req.params.userId);
    if (!receiver) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if request already exists
    const existingRequest = receiver.friendRequests.find(
      request => request.from.toString() === req.userId
    );

    if (existingRequest) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }
    
    // Check if they are already friends
    if (receiver.friends.includes(req.userId)) {
      return res.status(400).json({ message: 'You are already friends with this user' });
    }

    // Get sender information for notification
    const sender = await User.findById(req.userId);
    if (!sender) {
      return res.status(404).json({ message: 'Sender not found' });
    }
    
    // Check if receiver has already sent a friend request to sender
    const senderHasReceiverRequest = sender.friendRequests.find(
      request => request.from.toString() === receiver._id.toString()
    );
    
    if (senderHasReceiverRequest) {
      return res.status(400).json({ message: 'This user has already sent you a friend request. Please check your friend requests.' });
    }

    receiver.friendRequests.push({
      from: req.userId,
      status: 'pending'
    });

    await receiver.save();

    // Create notification for friend request
    const Notification = require('../models/Notification');
    const notification = new Notification({
      recipient: receiver._id,
      sender: sender._id,
      type: 'friend_request',
      content: `${sender.username} sent you a friend request`,
      metadata: {
        requestId: receiver.friendRequests[receiver.friendRequests.length - 1]._id
      }
    });

    await notification.save();

    // Emit socket event for real-time notification
    const io = req.app.get('io');
    if (io) {
      await notification.populate('sender', 'username profilePhoto');
      io.emit('new notification', notification);
    }

    res.json({ message: 'Friend request sent successfully' });
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ message: err.message });
  }
});

// Accept/Reject friend request
router.patch('/friend-request/:requestId', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findById(req.userId);
    const request = user.friendRequests.id(req.params.requestId);

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (status === 'accepted') {
      // Check if they are already friends before adding
      if (!user.friends.includes(request.from)) {
        user.friends.push(request.from);
      }
      
      const sender = await User.findById(request.from);
      if (!sender.friends.includes(user._id)) {
        sender.friends.push(user._id);
      }
      await sender.save();
      
      // Create notification for the sender that their request was accepted
      const Notification = require('../models/Notification');
      const notification = new Notification({
        recipient: request.from,
        sender: user._id,
        type: 'friend_request', // Changed from 'friend_accepted' to match enum values
        content: `${user.username} accepted your friend request`
      });
      
      await notification.save();
      
      // Emit socket event for real-time notification
      const io = req.app.get('io');
      if (io) {
        await notification.populate('sender', 'username profilePhoto');
        io.emit('new notification', notification);
      }
    }

    // Remove the request from the user's friendRequests array
    user.friendRequests.pull(request._id);
    await user.save();

    res.json({ message: `Friend request ${status}` });
  } catch (err) {
    console.error('Error handling friend request:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get friend list
router.get('/friends', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('friends', 'username email profilePhoto');
    
    // Ensure unique friends by ID
    const uniqueFriends = [];
    const friendIds = new Set();
    
    user.friends.forEach(friend => {
      if (!friendIds.has(friend._id.toString())) {
        friendIds.add(friend._id.toString());
        uniqueFriends.push(friend);
      }
    });
    
    res.json(uniqueFriends);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;