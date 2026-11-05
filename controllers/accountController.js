const Account = require('../models/Account');
const { ACCOUNT_TYPES } = require('../models/Account');
const Order = require('../models/Order');

/**
 * @desc    Create a new account
 * @route   POST /api/accounts
 * @access  Private (create_account or admin)
 */
const createAccount = async (req, res) => {
  try {
    let {
      accountType,
      customAccountType,
      fullName,
      mobileNumber,
      email,
    } = req.body;

    // accountType required
    if (!accountType || !accountType.trim()) {
      return res.status(400).json({ success: false, message: 'Account type is required.' });
    }

    // Validate accountType is in enum
    if (!ACCOUNT_TYPES.includes(accountType.trim())) {
      return res.status(400).json({ success: false, message: `${accountType} is not a supported account type.` });
    }

    // fullName required
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    // At least one contact required
    if (!mobileNumber && !email) {
      return res.status(400).json({ success: false, message: 'Please enter at least a mobile number or an email address.' });
    }

    // Custom type required when Other
    if (accountType === 'Other' && !customAccountType?.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter a custom account name when selecting Other.' });
    }

    // Clear customAccountType if not Other
    if (accountType !== 'Other') customAccountType = null;

    const account = await Account.create({
      userId: req.user._id,
      accountType: accountType.trim(),
      customAccountType: customAccountType ? customAccountType.trim() : null,
      fullName: fullName.trim(),
      mobileNumber: mobileNumber ? mobileNumber.trim() : null,
      email: email ? email.trim().toLowerCase() : null,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      account,
    });
  } catch (error) {
    console.error('Create account error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while creating account.' });
  }
};

/**
 * @desc    Get all accounts for logged-in user (paginated, filtered, searched)
 * @route   GET /api/accounts
 * @access  Private (view_accounts or admin)
 */
const getAccounts = async (req, res) => {
  try {
    const {
      search,
      accountType,
      accountTypes,
      mobileNumber,
      email,
      startDate,
      endDate,
      page = 1,
      limit = 25,
      sort = '-createdAt',
    } = req.query;

    const query = { userId: req.user._id, deletedAt: null };

    // Admin can pass ?userId=xxx to view another user's accounts
    if (req.user.role === 'admin' && req.query.userId) {
      query.userId = req.query.userId;
    }

    const typeFilter = accountTypes || accountType;
    if (typeFilter && typeFilter !== 'ALL') {
      const types = String(typeFilter)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length === 1) {
        query.accountType = types[0];
      } else if (types.length > 1) {
        query.accountType = { $in: types };
      }
    }

    if (mobileNumber && mobileNumber.trim()) {
      query.mobileNumber = { $regex: mobileNumber.trim(), $options: 'i' };
    }

    if (email && email.trim()) {
      query.email = { $regex: email.trim(), $options: 'i' };
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

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { fullName: regex },
        { email: regex },
        { mobileNumber: regex },
        { accountType: regex },
        { customAccountType: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    let sortObj = {};
    if (sort) {
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
      const sortOrder = sort.startsWith('-') ? -1 : 1;
      sortObj[sortField] = sortOrder;
    }

    const [rawAccounts, total] = await Promise.all([
      Account.find(query).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Account.countDocuments(query),
    ]);

    // Calculate dynamic live order counts for these accounts
    const accountIds = rawAccounts.map((a) => a._id);
    let countMap = {};
    if (accountIds.length > 0) {
      const orderCounts = await Order.aggregate([
        {
          $match: {
            accountId: { $in: accountIds },
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$accountId',
            count: { $sum: 1 },
          },
        },
      ]);

      orderCounts.forEach((item) => {
        countMap[item._id.toString()] = item.count;
      });
    }

    const accounts = rawAccounts.map((acc) => ({
      ...acc,
      id: acc._id.toString(),
      orderCount: countMap[acc._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      accounts,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Get accounts error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching accounts.' });
  }
};

/**
 * @desc    Get account summary for the logged-in user
 * @route   GET /api/accounts/summary
 * @access  Private (view_accounts or admin)
 */
const getAccountSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const [totalAccounts, distinctResult] = await Promise.all([
      Account.countDocuments({ userId, deletedAt: null }),
      Account.distinct('accountType', { userId, deletedAt: null }),
    ]);

    return res.status(200).json({
      success: true,
      summary: {
        totalAccounts,
        distinctAccountTypes: distinctResult.length,
      },
    });
  } catch (error) {
    console.error('Get account summary error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching summary.' });
  }
};

/**
 * @desc    Get single account by ID
 * @route   GET /api/accounts/:id
 * @access  Private (view_accounts or admin)
 */
const getAccountById = async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, deletedAt: null }).lean();

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Enforce ownership for non-admin users
    if (req.user.role !== 'admin' && account.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view this account.' });
    }

    const orderCount = await Order.countDocuments({
      accountId: account._id,
      deletedAt: null,
    });
    account.orderCount = orderCount;

    return res.status(200).json({ success: true, account });
  } catch (error) {
    console.error('Get account by ID error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    return res.status(500).json({ success: false, message: 'Server error while fetching account.' });
  }
};

/**
 * @desc    Update an account
 * @route   PUT /api/accounts/:id
 * @access  Private (edit_account or admin)
 */
const updateAccount = async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Enforce ownership for non-admin users
    if (req.user.role !== 'admin' && account.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit this account.' });
    }

    let {
      accountType,
      customAccountType,
      fullName,
      mobileNumber,
      email,
    } = req.body;

    // accountType required
    if (!accountType || !accountType.trim()) {
      return res.status(400).json({ success: false, message: 'Account type is required.' });
    }

    // Validate accountType is in enum
    if (!ACCOUNT_TYPES.includes(accountType.trim())) {
      return res.status(400).json({ success: false, message: `${accountType} is not a supported account type.` });
    }

    // fullName required
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    // At least one contact required
    if (!mobileNumber && !email) {
      return res.status(400).json({ success: false, message: 'Please enter at least a mobile number or an email address.' });
    }

    // Custom type required when Other
    if (accountType === 'Other' && !customAccountType?.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter a custom account name when selecting Other.' });
    }

    // Clear customAccountType if not Other
    if (accountType !== 'Other') customAccountType = null;

    account.accountType = accountType.trim();
    account.customAccountType = customAccountType ? customAccountType.trim() : null;
    account.fullName = fullName.trim();
    account.mobileNumber = mobileNumber ? mobileNumber.trim() : null;
    account.email = email ? email.trim().toLowerCase() : null;

    await account.save();

    return res.status(200).json({
      success: true,
      message: 'Account updated successfully.',
      account,
    });
  } catch (error) {
    console.error('Update account error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while updating account.' });
  }
};

/**
 * @desc    Delete an account
 * @route   DELETE /api/accounts/:id
 * @access  Private (delete_account or admin)
 */
const deleteAccount = async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, deletedAt: null });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Enforce ownership for non-admin users
    if (req.user.role !== 'admin' && account.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete this account.' });
    }

    // Soft delete to preserve historical order integrity and references
    account.deletedAt = new Date();
    await account.save();

    return res.status(200).json({
      success: true,
      message: 'Account deleted successfully.',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    return res.status(500).json({ success: false, message: 'Server error while deleting account.' });
  }
};

module.exports = {
  createAccount,
  getAccounts,
  getAccountSummary,
  getAccountById,
  updateAccount,
  deleteAccount,
};
