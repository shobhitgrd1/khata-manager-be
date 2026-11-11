const User = require('../models/User');
const { sendTokenResponse } = require('../utils/tokenUtils');
const jwt = require('jsonwebtoken');

// Email regex pattern
const EMAIL_REGEX = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

const STANDARD_USER_PERMISSIONS = [
  'dashboard',
  // Orders
  'view_orders',
  'create_order',
  'edit_order',
  'delete_order',
  // Khata Book
  'view_khatabook',
  'create_khatabook',
  'edit_khatabook',
  'delete_khatabook',
  'khatabook',
  // Dealers
  'view_dealers',
  'create_dealer',
  'edit_dealer',
  'delete_dealer',
  // Profit & Loss
  'view_profit_loss',
  'profit_loss',
  // Credit Cards
  'view_credit_cards',
  'create_credit_card',
  'edit_credit_card',
  'delete_credit_card',
  // Accounts
  'view_accounts',
  'create_account',
  'edit_account',
  'delete_account',
  // Products
  'view_products',
  'create_product',
  'edit_product',
  'delete_product',
];

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = async (req, res) => {
  try {
    const { name, email, username, mobileNumber, password, confirmPassword, dateOfBirth } = req.body;

    // Validation
    if (!name || !email || !username || !password || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and Confirm Password must match',
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase();

    // Check duplicate email
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists',
      });
    }

    // Check duplicate username
    const existingUsername = await User.findOne({ username: cleanUsername });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: 'This username is already taken. Please choose another',
      });
    }

    // Standard User role receives all application permissions by default, excluding User Management
    const newUser = await User.create({
      name: name.trim(),
      email: cleanEmail,
      username: cleanUsername,
      mobileNumber: mobileNumber ? String(mobileNumber).trim() : '',
      password,
      dateOfBirth: new Date(dateOfBirth),
      role: 'user',
      permissions: STANDARD_USER_PERMISSIONS,
      status: 'active',
    });

    return sendTokenResponse(newUser, 201, res, 'User registered successfully');
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during registration',
    });
  }
};

/**
 * @desc    Login user with email or username
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email/username and password',
      });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const digitsOnly = identifier.trim().replace(/\D/g, '');

    const loginOr = [{ email: cleanIdentifier }, { username: cleanIdentifier }];
    if (digitsOnly.length >= 7) {
      const lastDigits = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
      loginOr.push({ mobileNumber: { $regex: new RegExp(lastDigits + '$') } });
    }

    // Find user by email, username, or mobile number, explicitly selecting password
    const user = await User.findOne({
      $or: loginOr,
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email/username or password',
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email/username or password',
      });
    }

    // Check status
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Your account is currently ${user.status}. Please contact support.`,
      });
    }

    return sendTokenResponse(user, 200, res, 'Login successful');
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
};

/**
 * @desc    Verify user identity for Forgot Password (Step 1)
 * @route   POST /api/auth/forgot-password/verify
 * @access  Public
 */
const forgotPasswordVerify = async (req, res) => {
  try {
    const { email, identifier } = req.body;
    const inputVal = (email || identifier || '').trim();

    if (!inputVal) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your registered email address',
      });
    }

    const cleanLower = inputVal.toLowerCase();

    // Find user by email (or username/mobile fallback if entered)
    const user = await User.findOne({
      $or: [
        { email: cleanLower },
        { username: cleanLower },
      ],
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'No account found with this email address.',
      });
    }

    // Issue a short-lived reset authorization token (valid for 15 minutes)
    const resetToken = jwt.sign(
      { id: user._id, type: 'pwd_reset' },
      process.env.JWT_SECRET || 'khata_manager_super_secure_jwt_secret_key_2026_xyz!',
      { expiresIn: '15m' }
    );

    // Save token on user record for single-use invalidation
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully. You may now reset your password.',
      resetToken,
    });
  } catch (error) {
    console.error('Forgot password verify error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset verification',
    });
  }
};

/**
 * @desc    Reset password with verified reset token (Step 2)
 * @route   POST /api/auth/forgot-password/reset
 * @access  Public
 */
const forgotPasswordReset = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token and new password are required',
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password must match',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(
        resetToken,
        process.env.JWT_SECRET || 'khata_manager_super_secure_jwt_secret_key_2026_xyz!'
      );
    } catch (jwtErr) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset session. Please verify again.',
      });
    }

    if (decoded.type !== 'pwd_reset') {
      return res.status(400).json({
        success: false,
        message: 'Invalid reset authorization token',
      });
    }

    const user = await User.findOne({
      _id: decoded.id,
      resetPasswordToken: resetToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Reset authorization has expired or has already been used. Please try again.',
      });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (error) {
    console.error('Forgot password reset error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset',
    });
  }
};

/**
 * @desc    Logout user / clear cookie
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = async (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

/**
 * @desc    Get currently logged in user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
};

module.exports = {
  register,
  login,
  forgotPasswordVerify,
  forgotPasswordReset,
  logout,
  getMe,
};

