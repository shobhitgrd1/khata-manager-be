const mongoose = require('mongoose');
const Dealer = require('../models/Dealer');
const Order = require('../models/Order');
const KhataBook = require('../models/KhataBook');

const MOBILE_REGEX = /^[+]?[\d\s\-().]{7,20}$/;

/**
 * Validate dealer address objects
 */
const validateAddresses = (addresses) => {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return 'At least one address is required for a dealer.';
  }
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    if (!addr.addressTitle || !addr.addressTitle.trim()) {
      return `Address #${i + 1} title is required (e.g. Shop, Warehouse, Office).`;
    }
    if (!addr.completeAddress || !addr.completeAddress.trim()) {
      return `Address #${i + 1} complete address is required.`;
    }
  }
  return null;
};

/**
 * Validate multiple mobile numbers
 */
const validateMobileNumbers = (mobileNumbers) => {
  if (!Array.isArray(mobileNumbers) || mobileNumbers.length === 0) {
    return { error: 'At least one mobile number is required.' };
  }

  const cleaned = [];
  const seen = new Set();

  for (let i = 0; i < mobileNumbers.length; i++) {
    const num = mobileNumbers[i];
    if (typeof num !== 'string' || !num.trim()) {
      return { error: `Mobile number #${i + 1} cannot be empty.` };
    }
    const trimmed = num.trim();
    if (!MOBILE_REGEX.test(trimmed)) {
      return {
        error: `Mobile number "${trimmed}" is invalid. Please enter 7-20 digits with optional country code.`,
      };
    }
    const normalized = trimmed.replace(/\s+/g, '');
    if (seen.has(normalized)) {
      return { error: `Duplicate mobile number "${trimmed}" found. Please remove duplicates.` };
    }
    seen.add(normalized);
    cleaned.push(trimmed);
  }

  return { cleaned };
};

/**
 * Compute date boundaries for profit calculations
 */
const getProfitDateRange = (period = 'currentMonth', customStart, customEnd) => {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  switch (period) {
    case 'lastMonth': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    }
    case '7days': {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case '15days': {
      start = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case '30days': {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case '60days': {
      start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case '90days': {
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'custom': {
      if (customStart) {
        start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
      }
      if (customEnd) {
        end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
      }
      break;
    }
    case 'currentMonth':
    default: {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    }
  }

  return { start, end };
};

/**
 * @desc    Create a new dealer with multiple mobile numbers and addresses
 * @route   POST /api/dealers
 * @access  Private (create_dealer or admin)
 */
const createDealer = async (req, res) => {
  try {
    const { dealerName, mobileNumber, mobileNumbers, addresses } = req.body;

    if (!dealerName || !dealerName.trim()) {
      return res.status(400).json({ success: false, message: 'Dealer name is required.' });
    }

    // Prepare mobile numbers array (support both mobileNumbers array and legacy mobileNumber)
    let rawNumbers = [];
    if (Array.isArray(mobileNumbers) && mobileNumbers.length > 0) {
      rawNumbers = mobileNumbers;
    } else if (mobileNumber && typeof mobileNumber === 'string') {
      rawNumbers = [mobileNumber];
    }

    const { error: mobileError, cleaned: cleanedMobiles } = validateMobileNumbers(rawNumbers);
    if (mobileError) {
      return res.status(400).json({ success: false, message: mobileError });
    }

    const addrError = validateAddresses(addresses);
    if (addrError) {
      return res.status(400).json({ success: false, message: addrError });
    }

    // Clean address list
    const cleanAddresses = addresses.map((addr) => ({
      addressTitle: addr.addressTitle.trim(),
      completeAddress: addr.completeAddress.trim(),
      city: addr.city ? addr.city.trim() : '',
      state: addr.state ? addr.state.trim() : '',
      pinCode: addr.pinCode ? addr.pinCode.trim() : '',
      country: addr.country ? addr.country.trim() : 'India',
    }));

    // Server-side ownership derivation
    const dealer = await Dealer.create({
      userId: req.user._id,
      dealerName: dealerName.trim(),
      mobileNumber: cleanedMobiles[0],
      mobileNumbers: cleanedMobiles,
      addresses: cleanAddresses,
      deletedAt: null,
    });

    // Auto-create linked KhataBook account if requested
    let linkedKhataBook = null;
    if (req.body.addToKhataBook) {
      try {
        const existingKb = await KhataBook.findOne({
          userId: req.user._id,
          dealerId: dealer._id,
          deletedAt: null,
        });

        if (existingKb) {
          linkedKhataBook = existingKb;
        } else {
          linkedKhataBook = await KhataBook.create({
            userId: req.user._id,
            name: dealer.dealerName,
            mobileNumber: cleanedMobiles[0] || '',
            accountType: 'Dealer',
            dealerId: dealer._id,
            openingBalance: 0,
            openingBalanceDirection: 'NONE',
            currentBalance: 0,
          });
        }
      } catch (kbErr) {
        console.error('Failed to auto-create linked KhataBook for dealer:', kbErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Dealer added successfully.',
      dealer,
      linkedKhataBook,
    });
  } catch (error) {
    console.error('Create dealer error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while creating dealer.' });
  }
};

/**
 * @desc    Get all dealers for the authenticated user with dynamic profit calculation
 * @route   GET /api/dealers
 * @access  Private (view_dealers or admin)
 */
const getDealers = async (req, res) => {
  try {
    const {
      search,
      city,
      state,
      minAddresses,
      profitPeriod = 'currentMonth',
      profitStartDate,
      profitEndDate,
      profitMin,
      profitMax,
      profitPercentageMin,
      profitPercentageMax,
      page = 1,
      limit = 100,
      sort = '-createdAt',
    } = req.query;

    const query = {
      userId: req.user._id,
      deletedAt: null,
    };

    if (req.user.role === 'admin' && req.query.userId) {
      query.userId = req.query.userId;
    }

    if (city && city.trim()) {
      query['addresses.city'] = { $regex: city.trim(), $options: 'i' };
    }

    if (state && state.trim()) {
      query['addresses.state'] = { $regex: state.trim(), $options: 'i' };
    }

    if (minAddresses !== undefined && minAddresses !== '' && !isNaN(Number(minAddresses))) {
      query.$expr = { $gte: [{ $size: { $ifNull: ['$addresses', []] } }, Number(minAddresses)] };
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { dealerName: regex },
        { mobileNumber: regex },
        { mobileNumbers: regex },
        { 'addresses.addressTitle': regex },
        { 'addresses.completeAddress': regex },
        { 'addresses.city': regex },
        { 'addresses.state': regex },
        { 'addresses.pinCode': regex },
        { 'addresses.country': regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    let sortObj = {};
    if (sort) {
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
      const sortOrder = sort.startsWith('-') ? -1 : 1;
      sortObj[sortField] = sortOrder;
    } else {
      sortObj = { createdAt: -1 };
    }

    // Fetch matching dealers
    const [dealersList, totalCount] = await Promise.all([
      Dealer.find(query).sort(sortObj).lean(),
      Dealer.countDocuments(query),
    ]);

    // Calculate profit date range
    const { start: profitStart, end: profitEnd } = getProfitDateRange(
      profitPeriod,
      profitStartDate,
      profitEndDate
    );

    // Extract dealer ObjectIds
    const dealerIds = dealersList.map((d) => d._id);

    // Dynamic MongoDB aggregation for realized dealer profit from Delivered orders
    let profitByDealer = {};
    if (dealerIds.length > 0) {
      const orderAgg = await Order.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user._id),
            dealerId: { $in: dealerIds },
            status: 'Delivered', // Only delivered orders contribute to profit
            deletedAt: null,
            $or: [
              { deliveryDate: { $gte: profitStart, $lte: profitEnd } },
              { deliveryDate: null, updatedAt: { $gte: profitStart, $lte: profitEnd } },
            ],
          },
        },
        {
          $group: {
            _id: '$dealerId',
            deliveredOrderCount: { $sum: 1 },
            totalPurchaseAmount: { $sum: { $ifNull: ['$purchasePrice', 0] } },
            totalDeliveryAmount: { $sum: { $ifNull: ['$deliveryPrice', 0] } },
            totalProfit: {
              $sum: {
                $subtract: [
                  { $ifNull: ['$deliveryPrice', 0] },
                  { $ifNull: ['$purchasePrice', 0] },
                ],
              },
            },
            totalCashbackAmount: { $sum: { $ifNull: ['$cashbackAmount', 0] } },
          },
        },
      ]);

      orderAgg.forEach((agg) => {
        const grossProfit = Math.round((agg.totalProfit || 0) * 100) / 100;
        const totalCashback = Math.round((agg.totalCashbackAmount || 0) * 100) / 100;
        const netProfit = Math.round((grossProfit + totalCashback) * 100) / 100;
        profitByDealer[agg._id.toString()] = {
          deliveredOrderCount: agg.deliveredOrderCount,
          totalPurchaseAmount: agg.totalPurchaseAmount,
          totalDeliveryAmount: agg.totalDeliveryAmount,
          totalProfit: grossProfit,
          totalCashbackAmount: totalCashback,
          totalNetProfit: netProfit,
          profitPercentage:
            agg.totalPurchaseAmount > 0
              ? Math.round((grossProfit / agg.totalPurchaseAmount) * 10000) / 100
              : 0,
        };
      });
    }

    // Attach profit statistics and ensure mobileNumbers array is always populated
    let enrichedDealers = dealersList.map((dealer) => {
      const stats = profitByDealer[dealer._id.toString()] || {
        deliveredOrderCount: 0,
        totalPurchaseAmount: 0,
        totalDeliveryAmount: 0,
        totalProfit: 0,
        totalCashbackAmount: 0,
        totalNetProfit: 0,
        profitPercentage: 0,
      };

      const numbers =
        Array.isArray(dealer.mobileNumbers) && dealer.mobileNumbers.length > 0
          ? dealer.mobileNumbers
          : dealer.mobileNumber
          ? [dealer.mobileNumber]
          : [];

      return {
        ...dealer,
        mobileNumbers: numbers,
        profitStats: stats,
        totalProfit: stats.totalProfit,
        totalCashbackAmount: stats.totalCashbackAmount,
        totalNetProfit: stats.totalNetProfit,
        profitPercentage: stats.profitPercentage,
        totalPurchaseAmount: stats.totalPurchaseAmount,
        totalDeliveryAmount: stats.totalDeliveryAmount,
        deliveredOrderCount: stats.deliveredOrderCount,
      };
    });

    // Apply profit-range filters if provided
    if (profitMin !== undefined && profitMin !== '' && !isNaN(Number(profitMin))) {
      enrichedDealers = enrichedDealers.filter((d) => d.totalProfit >= Number(profitMin));
    }
    if (profitMax !== undefined && profitMax !== '' && !isNaN(Number(profitMax))) {
      enrichedDealers = enrichedDealers.filter((d) => d.totalProfit <= Number(profitMax));
    }
    if (profitPercentageMin !== undefined && profitPercentageMin !== '' && !isNaN(Number(profitPercentageMin))) {
      enrichedDealers = enrichedDealers.filter((d) => d.profitPercentage >= Number(profitPercentageMin));
    }
    if (profitPercentageMax !== undefined && profitPercentageMax !== '' && !isNaN(Number(profitPercentageMax))) {
      enrichedDealers = enrichedDealers.filter((d) => d.profitPercentage <= Number(profitPercentageMax));
    }

    // Handle pagination on enriched results
    const total = enrichedDealers.length;
    const paginated = enrichedDealers.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      dealers: paginated,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      profitPeriodInfo: {
        period: profitPeriod,
        startDate: profitStart,
        endDate: profitEnd,
      },
    });
  } catch (error) {
    console.error('Get dealers error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching dealers.' });
  }
};

/**
 * @desc    Get summary statistics for dealer module (Total Dealers, Total Addresses)
 * @route   GET /api/dealers/summary
 * @access  Private (view_dealers or admin)
 */
const getDealerSummary = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const [totalDealers, addressAgg] = await Promise.all([
      Dealer.countDocuments({ userId, deletedAt: null }),
      Dealer.aggregate([
        { $match: { userId, deletedAt: null } },
        { $project: { addressCount: { $size: { $ifNull: ['$addresses', []] } } } },
        { $group: { _id: null, totalAddresses: { $sum: '$addressCount' } } },
      ]),
    ]);

    const totalAddresses = addressAgg.length > 0 ? addressAgg[0].totalAddresses : 0;

    return res.status(200).json({
      success: true,
      summary: {
        totalDealers,
        totalAddresses,
      },
    });
  } catch (error) {
    console.error('Get dealer summary error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching summary.' });
  }
};

/**
 * @desc    Get single dealer by ID
 * @route   GET /api/dealers/:id
 * @access  Private (view_dealers or admin)
 */
const getDealerById = async (req, res) => {
  try {
    const dealer = await Dealer.findOne({ _id: req.params.id, deletedAt: null });

    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }

    // Ownership verification
    if (req.user.role !== 'admin' && dealer.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view this dealer.',
      });
    }

    const dealerObj = dealer.toObject();
    if (!dealerObj.mobileNumbers || dealerObj.mobileNumbers.length === 0) {
      dealerObj.mobileNumbers = [dealerObj.mobileNumber];
    }

    return res.status(200).json({ success: true, dealer: dealerObj });
  } catch (error) {
    console.error('Get dealer by ID error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }
    return res.status(500).json({ success: false, message: 'Server error while retrieving dealer.' });
  }
};

/**
 * @desc    Update dealer info, mobile numbers, and addresses
 * @route   PUT /api/dealers/:id
 * @access  Private (edit_dealer or admin)
 */
const updateDealer = async (req, res) => {
  try {
    const dealer = await Dealer.findOne({ _id: req.params.id, deletedAt: null });

    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }

    // Ownership verification
    if (req.user.role !== 'admin' && dealer.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to edit this dealer.',
      });
    }

    const { dealerName, mobileNumber, mobileNumbers, addresses } = req.body;

    if (dealerName !== undefined) {
      if (!dealerName.trim()) {
        return res.status(400).json({ success: false, message: 'Dealer name cannot be empty.' });
      }
      dealer.dealerName = dealerName.trim();
    }

    // Handle mobile numbers
    if (mobileNumbers !== undefined || mobileNumber !== undefined) {
      let rawNumbers = [];
      if (Array.isArray(mobileNumbers) && mobileNumbers.length > 0) {
        rawNumbers = mobileNumbers;
      } else if (mobileNumber && typeof mobileNumber === 'string') {
        rawNumbers = [mobileNumber];
      }

      const { error: mobileError, cleaned: cleanedMobiles } = validateMobileNumbers(rawNumbers);
      if (mobileError) {
        return res.status(400).json({ success: false, message: mobileError });
      }

      dealer.mobileNumbers = cleanedMobiles;
      dealer.mobileNumber = cleanedMobiles[0];
    }

    if (addresses !== undefined) {
      const addrError = validateAddresses(addresses);
      if (addrError) {
        return res.status(400).json({ success: false, message: addrError });
      }

      dealer.addresses = addresses.map((addr) => ({
        addressTitle: addr.addressTitle.trim(),
        completeAddress: addr.completeAddress.trim(),
        city: addr.city ? addr.city.trim() : '',
        state: addr.state ? addr.state.trim() : '',
        pinCode: addr.pinCode ? addr.pinCode.trim() : '',
        country: addr.country ? addr.country.trim() : 'India',
      }));
    }

    await dealer.save();

    return res.status(200).json({
      success: true,
      message: 'Dealer updated successfully.',
      dealer,
    });
  } catch (error) {
    console.error('Update dealer error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while updating dealer.' });
  }
};

/**
 * @desc    Delete a dealer (soft delete)
 * @route   DELETE /api/dealers/:id
 * @access  Private (delete_dealer or admin)
 */
const deleteDealer = async (req, res) => {
  try {
    const dealer = await Dealer.findOne({ _id: req.params.id, deletedAt: null });

    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }

    // Ownership verification
    if (req.user.role !== 'admin' && dealer.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to delete this dealer.',
      });
    }

    dealer.deletedAt = new Date();
    await dealer.save();

    return res.status(200).json({
      success: true,
      message: 'Dealer deleted successfully.',
    });
  } catch (error) {
    console.error('Delete dealer error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Dealer not found.' });
    }
    return res.status(500).json({ success: false, message: 'Server error while deleting dealer.' });
  }
};

module.exports = {
  createDealer,
  getDealers,
  getDealerSummary,
  getDealerById,
  updateDealer,
  deleteDealer,
};
