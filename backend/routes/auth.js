const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to handle file uploads
const multer = require('multer');
const path = require('path');

// Ensure uploads directory exists
const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'uploads', 'profiles');
if (!fs.existsSync(uploadsDir)) {
  console.log(`Creating uploads directory: ${uploadsDir}`);
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    console.log(`Setting upload destination to: ${uploadsDir}`);
    cb(null, uploadsDir);
  },
  filename: function(req, file, cb) {
    const filename = Date.now() + '-' + file.originalname;
    console.log(`Setting upload filename to: ${filename}`);
    cb(null, filename);
  }
});
const upload = multer({ storage: storage });

// Register
router.post('/register', upload.single('profilePhoto'), async (req, res) => {
  console.log('Register request received:', req.body);
  console.log('File received:', req.file);
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const profilePhotoPath = req.file ? `/uploads/profiles/${req.file.filename}` : '';
    console.log('Setting profile photo path:', profilePhotoPath);
    
    user = new User({
      username,
      email,
      password: hashedPassword,
      profilePhoto: profilePhotoPath
    });
    
    console.log('Created new user object:', {
      username: user.username,
      email: user.email,
      hasProfilePhoto: !!user.profilePhoto
    });

    await user.save();

    // Create JWT token
    console.log('Checking JWT_SECRET environment variable');
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET not set in environment variables');
      return res.status(500).json({ message: 'Server configuration error: JWT_SECRET not set' });
    }
    console.log('JWT_SECRET is set, generating token');
    
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('JWT token generated successfully');

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  console.log('Login request received:', req.body);
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Validate password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    console.log('Checking JWT_SECRET environment variable for login');
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET not set in environment variables');
      return res.status(500).json({ message: 'Server configuration error: JWT_SECRET not set' });
    }
    console.log('JWT_SECRET is set, generating token for login');
    
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('JWT token generated successfully for login');

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;