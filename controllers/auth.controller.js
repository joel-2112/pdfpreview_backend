const User = require('../models/User.model');
const jwt = require('jsonwebtoken');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};
//register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
    let user = await User.findOne({ email });
    if (user) {
      return errorResponse(res, 'Email is already registered.', 400);
    }
    
    user = await User.create({ name, email, password });
    const token = generateToken(user._id);
    
    // Set cookie instead of returning token in body
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    
    return successResponse(
      res,
      {
        user: { id: user._id, name: user.name, email: user.email }
      },
      'User registered successfully.',
      201
    );
  } catch (error) {
    next(error);
  }
};
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Explicitly select password to compare
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }
    
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }
    
    const token = generateToken(user._id);
    
    // Set cookie instead of returning token in body
    res.cookie('token', token, {
      httpOnly: true,           // Cannot be accessed by JavaScript
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax',          // CSRF protection
      maxAge: 24 * 60 * 60 * 1000 // 24 hours (matches JWT_EXPIRE)
    });
    
    // Return user data WITHOUT token
    return successResponse(
      res,
      {
        user: { id: user._id, name: user.name, email: user.email }
      },
      'User logged in successfully.'
    );
  } catch (error) {
    next(error);
  }
};
const logout = async (req, res, next) => {
  try {
    // Clear the token cookie
    res.cookie('token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: new Date(0) // Expire immediately
    });
    
    return successResponse(res, null, 'User logged out successfully.');
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    return successResponse(res, user, 'User profile retrieved successfully.');
  } catch (error) {
    next(error);
  }
};
//the update profile
const updateProfileData = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return errorResponse(res, 'User record not found.', 404);
    }
    
    const { profileData } = req.body;
    if (profileData && typeof profileData === 'object') {
      Object.entries(profileData).forEach(([key, value]) => {
        user.profileData.set(key, String(value));
      });
    }
    
    await user.save();
    return successResponse(res, user, 'Profile metadata updated successfully.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfileData
};
