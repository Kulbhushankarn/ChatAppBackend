const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  profilePhoto: {
    type: String,
    default: '/uploads/profiles/default.svg'
  },
  personalInfo: {
    firstName: String,
    lastName: String,
    dateOfBirth: Date,
    phoneNumber: String,
    address: {
      street: String,
      city: String,
      state: String,
      pinCode: String,
      country: String
    }
  },
  professionalInfo: {
    designation: String,
    company: String,
    education: [{
      institution: String,
      degree: String,
      field: String,
      startYear: String,
      endYear: String,
      type: String
    }]
  },
  interests: {
    hobbies: [String],
    skills: [String],
    languages: [String]
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  friendRequests: [{
    from: {
      
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastActive: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);