const jwt = require('jsonwebtoken');

/**
 * Generate JWT token for user authentication
 */
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'khata_manager_super_secure_jwt_secret_key_2026_xyz!', {
    expiresIn: process.env.JWT_EXPIRE || '24h',
  });
};

/**
 * Set HTTP-only cookie and send JSON response
 */
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  const token = generateToken(user._id);

  const cookieExpireDays = parseInt(process.env.COOKIE_EXPIRES_DAYS, 10) || 1;
  const options = {
    expires: new Date(Date.now() + cookieExpireDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // Suitable for same-domain or localhost dev
    path: '/',
  };

  const userObj = user.toObject ? user.toObject() : { ...user };
  delete userObj.password;
  delete userObj.resetPasswordToken;
  delete userObj.resetPasswordExpires;
  delete userObj.__v;

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      message,
      token, // Also send token in response body for flexible client header auth or cookie auth
      user: userObj,
    });
};

module.exports = {
  generateToken,
  sendTokenResponse,
};

