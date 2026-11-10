const User = require('../models/User');

const ADMIN_PERMISSIONS = [
  'dashboard',
  'view_credit_cards',
  'create_credit_card',
  'edit_credit_card',
  'delete_credit_card',
  'view_accounts',
  'create_account',
  'edit_account',
  'delete_account',
  'view_dealers',
  'create_dealer',
  'edit_dealer',
  'delete_dealer',
  'view_products',
  'create_product',
  'edit_product',
  'delete_product',
  'view_orders',
  'create_order',
  'edit_order',
  'delete_order',
  'user',
  'view_user',
  'create_user',
  'edit_user',
  'delete_user',
];

const USER_PERMISSIONS = [
  'dashboard',
  'view_credit_cards',
  'create_credit_card',
  'edit_credit_card',
  'delete_credit_card',
  'view_accounts',
  'create_account',
  'edit_account',
  'delete_account',
  'view_dealers',
  'create_dealer',
  'edit_dealer',
  'delete_dealer',
  'view_products',
  'create_product',
  'edit_product',
  'delete_product',
  'view_orders',
  'create_order',
  'edit_order',
  'delete_order',
];

/**
 * @desc    Get all users with server-side pagination, search, and sorting
 * @route   GET /api/users
 * @access  Private (Admin with 'user' or 'view_user' permission)
 */
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 0; // 0-based for MUI Data Grid
    const pageSize = parseInt(req.query.pageSize, 10) || 10;
    const search = req.query.search ? req.query.search.trim() : '';
    const sortField = req.query.sortField || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const { role, roles, status, statuses, permission, startDate, endDate } = req.query;

    // Build filter
    let query = {};

    const roleFilter = roles || role;
    if (roleFilter && roleFilter !== 'ALL') {
      const roleList = String(roleFilter)
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      if (roleList.length === 1) {
        query.role = roleList[0];
      } else if (roleList.length > 1) {
        query.role = { $in: roleList };
      }
    }

    const statusFilter = statuses || status;
    if (statusFilter && statusFilter !== 'ALL') {
      const statusList = String(statusFilter)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statusList.length === 1) {
        query.status = statusList[0];
      } else if (statusList.length > 1) {
        query.status = { $in: statusList };
      }
    }

    if (permission && permission.trim()) {
      query.permissions = permission.trim();
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ [sortField]: sortOrder })
      .skip(page * pageSize)
      .limit(pageSize);

    return res.status(200).json({
      success: true,
      total,
      page,
      pageSize,
      users,
    });
  } catch (error) {
    console.error('getUsers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving users',
    });
  }
};

/**
 * @desc    Get dashboard metrics (total users count, active count, etc.)
 * @route   GET /api/users/stats
 * @access  Private
 */
const getUserStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const adminCount = await User.countDocuments({ role: 'admin' });

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        adminCount,
      },
    });
  } catch (error) {
    console.error('getUserStats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving stats',
    });
  }
};

/**
 * @desc    Get single user by ID
 * @route   GET /api/users/:id
 * @access  Private (Admin with 'view_user' permission or own profile)
 */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('getUserById error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user details',
    });
  }
};

/**
 * @desc    Update user details
 * @route   PUT /api/users/:id
 * @access  Private (Admin with 'edit_user' permission or own profile for permitted fields)
 */
const updateUser = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const user = await User.findById(targetUserId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isSelf = req.user._id.toString() === targetUserId;
    const isAdmin = req.user.role === 'admin';
    const hasEditPermission = Array.isArray(req.user.permissions) && req.user.permissions.includes('edit_user');

    if (!isSelf && !(isAdmin && hasEditPermission)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to edit this user',
      });
    }

    const { name, email, username, mobileNumber, phone, dateOfBirth, status, role, permissions } = req.body;

    // Check duplicate email if changed
    if (email && email.toLowerCase() !== user.email) {
      const emailExists = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: targetUserId },
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email address is already in use by another user',
        });
      }
      user.email = email.toLowerCase().trim();
    }

    // Check duplicate username if changed
    if (username && username.toLowerCase() !== user.username) {
      const usernameExists = await User.findOne({
        username: username.toLowerCase(),
        _id: { $ne: targetUserId },
      });
      if (usernameExists) {
        return res.status(400).json({
          success: false,
          message: 'Username is already in use by another user',
        });
      }
      user.username = username.toLowerCase().trim();
    }

    if (name) user.name = name.trim();
    if (mobileNumber !== undefined || phone !== undefined) {
      user.mobileNumber = String(mobileNumber || phone || '').trim();
    }
    if (dateOfBirth) user.dateOfBirth = new Date(dateOfBirth);

    // CRITICAL SECURITY REQUIREMENT:
    // Regular users MUST NOT be able to modify their own roles or permissions through profile editing.
    // Role and permission changes require administrative authorization.
    if (isAdmin && hasEditPermission) {
      if (status) user.status = status;
      if (role && ['admin', 'user'].includes(role)) user.role = role;
      if (permissions && Array.isArray(permissions)) user.permissions = permissions;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    console.error('updateUser error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error updating user',
    });
  }
};

/**
 * @desc    Delete user
 * @route   DELETE /api/users/:id
 * @access  Private (Admin with 'delete_user' permission)
 */
const deleteUser = async (req, res) => {
  try {
    const targetUserId = req.params.id;

    // Prevent self-deletion
    if (req.user._id.toString() === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own active administrator account',
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await User.findByIdAndDelete(targetUserId);

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('deleteUser error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error deleting user',
    });
  }
};

/**
 * @desc    Create a new user with Admin or User role
 * @route   POST /api/users
 * @access  Private (Admin only)
 */
const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      username,
      mobileNumber,
      dateOfBirth,
      password,
      role = 'user',
      status = 'active',
    } = req.body;

    if (!name || !email || !username || !password || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: Full Name, Email, Username, Password, and Date of Birth.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    // Check duplicate email
    const emailExists = await User.findOne({ email: normalizedEmail });
    if (emailExists) {
      return res.status(400).json({
        success: false,
        message: 'Email address is already in use by another user.',
      });
    }

    // Check duplicate username
    const usernameExists = await User.findOne({ username: normalizedUsername });
    if (usernameExists) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken. Please choose another username.',
      });
    }

    const chosenRole = role === 'admin' ? 'admin' : 'user';
    const permissions = chosenRole === 'admin' ? ADMIN_PERMISSIONS : USER_PERMISSIONS;

    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      username: normalizedUsername,
      mobileNumber: mobileNumber ? String(mobileNumber).trim() : '',
      dateOfBirth: new Date(dateOfBirth),
      password,
      role: chosenRole,
      permissions,
      status: ['active', 'inactive', 'suspended'].includes(status) ? status : 'active',
    });

    await newUser.save();

    const userObj = newUser.toObject();
    delete userObj.password;

    return res.status(201).json({
      success: true,
      message: `User created successfully as ${chosenRole === 'admin' ? 'Administrator' : 'Standard User'}.`,
      user: userObj,
    });
  } catch (error) {
    console.error('createUser error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error creating user.',
    });
  }
};

module.exports = {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};

