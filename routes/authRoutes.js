const express = require('express');
const router = express.Router();
const {
  register,
  login,
  forgotPasswordVerify,
  forgotPasswordReset,
  logout,
  getMe,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');

// Public routes with rate limiters
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot-password/verify', forgotPasswordLimiter, forgotPasswordVerify);
router.post('/forgot-password/reset', forgotPasswordLimiter, forgotPasswordReset);

// Private routes
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

module.exports = router;

