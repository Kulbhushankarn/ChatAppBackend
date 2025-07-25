const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'document'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  attachmentUrl: {
    type: String,
    default: ''
  },
  attachmentType: {
    type: String,
    default: ''
  },
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  deletedFor: [{
    user: { 
      type: String, 
      required: true 
    }
  }]
}, {
  timestamps: true
});

// Indexes for faster querying of group messages
groupMessageSchema.index({ group: 1 });
groupMessageSchema.index({ group: 1, createdAt: -1 });
groupMessageSchema.index({ sender: 1 });
groupMessageSchema.index({ 'readBy.user': 1 });
groupMessageSchema.index({ 'deletedFor.user': 1 });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);