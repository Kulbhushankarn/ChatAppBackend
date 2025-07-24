const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  profilePhoto: {
    type: String,
    default: '/uploads/groups/default.svg'
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  maxMembers: {
    type: Number,
    default: 50 // As per requirement, limit group to 50 members
  }
}, {
  timestamps: true
});

// Ensure the group doesn't exceed the maximum member limit
groupSchema.pre('save', function(next) {
  if (this.members.length > this.maxMembers) {
    const error = new Error(`Group cannot have more than ${this.maxMembers} members`);
    return next(error);
  }
  next();
});

module.exports = mongoose.model('Group', groupSchema);