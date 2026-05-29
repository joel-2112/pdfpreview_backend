const express = require('express');
const { body } = require('express-validator');
const { register, login, getMe, updateProfileData } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

router.post(
  '/register',
  validate([
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Please enter a valid email address.').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.')
  ]),
  register
);

router.post(
  '/login',
  validate([
    body('email').isEmail().withMessage('Please enter a valid email address.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.')
  ]),
  login
);

router.get('/me', protect, getMe);

router.put(
  '/profile-data',
  protect,
  validate([
    body('profileData').isObject().withMessage('profileData must be a key-value object map.')
  ]),
  updateProfileData
);

module.exports = router;
