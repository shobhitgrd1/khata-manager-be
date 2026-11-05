const mongoose = require('mongoose');
const Order = require('../models/Order');
const Dealer = require('../models/Dealer');
const Product = require('../models/Product');
const Account = require('../models/Account');
const CreditCard = require('../models/CreditCard');
const KhataBook = require('../models/KhataBook');
const KhataTransaction = require('../models/KhataTransaction');
const { recalculateKhataBookBalance } = require('./khataBookController');

/**
 * Generate unique Order ID (e.g. ORD-20261104-A7X9)
 */
const generateOrderId = async () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let isUnique = false;
  let orderId = '';

  while (!isUnique) {
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    orderId = `ORD-${dateStr}-${randomSuffix}`;
    const existing = await Order.findOne({ orderId });
    if (!existing) {
      isUnique = true;
    }
  }

  return orderId;
};

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private (create_order or admin)
 */
const createOrder = async (req, res) => {
  try {
    const {
      dealerId,
      dealerAddressId,
      productId,
      variant,
      color,
      accountId,
      paymentMethod,
      creditCardId,
      paymentDetails = {},
      purchasePrice,
      status = 'Order In Process',
      deliveryPrice,
      deliveryDate,
      orderDate,
      cashbackApplied = false,
      cashbackAmount = 0,
    } = req.body || {};

    // 1. Validate Purchase Price
    const numericPurchasePrice = Number(purchasePrice);
    if (isNaN(numericPurchasePrice) || numericPurchasePrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive purchase price is required.',
      });
    }

    // 2. Validate Dealer and Address
    if (!dealerId || !mongoose.Types.ObjectId.isValid(dealerId)) {
      return res.status(400).json({ success: false, message: 'Valid dealer ID is required.' });
    }
    const dealer = await Dealer.findById(dealerId);
    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Selected dealer not found.' });
    }
    if (dealer.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied to selected dealer.' });
    }

    if (!Array.isArray(dealer.addresses) || dealer.addresses.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected dealer has no saved addresses. Please add an address to the dealer first.',
      });
    }

    // Match address
    let selectedAddress = null;
    if (dealerAddressId) {
      selectedAddress = dealer.addresses.find(
        (a) => (a._id ? a._id.toString() : '') === dealerAddressId.toString()
      );
    }
    // If dealer has only 1 address, auto-select it if not explicitly matched
    if (!selectedAddress && dealer.addresses.length === 1) {
      selectedAddress = dealer.addresses[0];
    }
    if (!selectedAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid address for the dealer.',
      });
    }

    // 3. Validate Product, Variant, and Color
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid product ID is required.' });
    }
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Selected product not found.' });
    }
    if (product.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied to selected product.' });
    }

    if (!variant || !variant.trim()) {
      return res.status(400).json({ success: false, message: 'Product variant is required.' });
    }
    const cleanVariant = variant.trim();
    const matchedVariant = product.variants.find(
      (v) => v.variantName.toLowerCase() === cleanVariant.toLowerCase()
    );
    if (!matchedVariant) {
      return res.status(400).json({
        success: false,
        message: `Variant "${cleanVariant}" does not belong to product "${product.productName}".`,
      });
    }

    const colorName = typeof color === 'string' ? color.trim() : color?.colorName?.trim();
    if (!colorName) {
      return res.status(400).json({ success: false, message: 'Product color is required.' });
    }
    const matchedColor = product.colors.find(
      (c) => c.colorName.toLowerCase() === colorName.toLowerCase()
    );
    if (!matchedColor) {
      return res.status(400).json({
        success: false,
        message: `Color "${colorName}" does not belong to product "${product.productName}".`,
      });
    }

    // 4. Validate Account
    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.status(400).json({ success: false, message: 'Valid account ID is required.' });
    }
    const account = await Account.findById(accountId);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Selected account not found.' });
    }
    if (account.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied to selected account.' });
    }

    // 5. Validate Payment Method & Details
    const validPaymentMethods = ['Credit Card', 'Debit Card', 'UPI', 'Other'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Choose from: ${validPaymentMethods.join(', ')}`,
      });
    }

    const finalPaymentDetails = {};
    let finalCreditCardId = null;

    if (paymentMethod === 'Credit Card') {
      if (!creditCardId || !mongoose.Types.ObjectId.isValid(creditCardId)) {
        return res.status(400).json({
          success: false,
          message: 'Please select a registered credit card.',
        });
      }
      const card = await CreditCard.findById(creditCardId);
      if (!card) {
        return res.status(404).json({ success: false, message: 'Selected credit card not found.' });
      }
      if (card.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied to selected credit card.' });
      }

      finalCreditCardId = card._id;
      finalPaymentDetails.bankName = card.bankName;
      finalPaymentDetails.cardName = card.cardName;
      finalPaymentDetails.cardType = card.cardType || 'Credit Card';
      finalPaymentDetails.lastFourDigits = card.lastFourDigits;
      finalPaymentDetails.cardHolderName = card.cardOwner || '';
    } else if (paymentMethod === 'Debit Card') {
      const { cardHolderName, lastFourDigits } = paymentDetails;
      if (!cardHolderName || !cardHolderName.trim()) {
        return res.status(400).json({ success: false, message: 'Debit cardholder name is required.' });
      }
      if (!lastFourDigits || !/^\d{4}$/.test(lastFourDigits.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide the last 4 digits of the debit card.',
        });
      }
      finalPaymentDetails.cardHolderName = cardHolderName.trim();
      finalPaymentDetails.lastFourDigits = lastFourDigits.trim();
    } else if (paymentMethod === 'UPI') {
      const { upiId, upiOwnerName } = paymentDetails;
      if (!upiId || !upiId.trim()) {
        return res.status(400).json({ success: false, message: 'UPI ID is required.' });
      }
      if (!upiOwnerName || !upiOwnerName.trim()) {
        return res.status(400).json({ success: false, message: 'UPI account owner name is required.' });
      }
      finalPaymentDetails.upiId = upiId.trim();
      finalPaymentDetails.upiOwnerName = upiOwnerName.trim();
    } else if (paymentMethod === 'Other') {
      const { otherMethodName, referenceNote } = paymentDetails;
      if (!otherMethodName || !otherMethodName.trim()) {
        return res.status(400).json({ success: false, message: 'Payment method name is required.' });
      }
      finalPaymentDetails.otherMethodName = otherMethodName.trim();
      finalPaymentDetails.referenceNote = referenceNote ? referenceNote.trim() : '';
    }

    // 6. Generate unique Order ID
    const orderId = await generateOrderId();

    // 7. Determine status, delivery price & profit
    let finalStatus = 'Order In Process';
    let finalDeliveryPrice = null;
    let finalDeliveryDate = null;
    let finalProfit = null;
    let finalCashbackApplied = false;
    let finalCashbackPercentage = 0;
    let finalCashbackAmount = 0;
    let finalNetProfit = null;

    if (status === 'Delivered') {
      const numDeliveryPrice = Number(deliveryPrice);
      if (deliveryPrice === undefined || deliveryPrice === null || isNaN(numDeliveryPrice) || numDeliveryPrice < 0) {
        return res.status(400).json({
          success: false,
          message: 'Delivery price is required and cannot be negative for delivered orders.',
        });
      }
      finalStatus = 'Delivered';
      finalDeliveryPrice = numDeliveryPrice;
      finalDeliveryDate = deliveryDate ? new Date(deliveryDate) : new Date();
      finalProfit = Math.round((numDeliveryPrice - numericPurchasePrice) * 100) / 100;

      let finalProfitPercent = numericPurchasePrice > 0
        ? Math.round(((finalProfit / numericPurchasePrice) * 100) * 100) / 100
        : 0;
      if (req.body.profitPercentage !== undefined && req.body.profitPercentage !== null && !isNaN(Number(req.body.profitPercentage))) {
        finalProfitPercent = Math.round(Number(req.body.profitPercentage) * 100) / 100;
      }

      const isCb = Boolean(cashbackApplied);
      if (isCb) {
        const numCb = Number(cashbackAmount);
        finalCashbackApplied = true;
        finalCashbackAmount = !isNaN(numCb) && numCb >= 0 ? Math.round(numCb * 100) / 100 : 0;
        finalNetProfit = Math.round((finalProfit + finalCashbackAmount) * 100) / 100;
      } else {
        finalCashbackApplied = false;
        finalCashbackAmount = 0;
        finalNetProfit = finalProfit;
      }
    }

    let finalOrderDate = new Date();
    if (orderDate) {
      const parsedOD = new Date(orderDate);
      if (!isNaN(parsedOD.getTime())) {
        finalOrderDate = parsedOD;
      }
    }

    // 8. Create Order with Snapshots
    const newOrder = await Order.create({
      userId: req.user._id,
      orderId,
      dealerId: dealer._id,
      dealerAddressId: selectedAddress._id ? selectedAddress._id.toString() : '',
      dealerNameSnapshot: dealer.dealerName,
      dealerMobileSnapshot: dealer.mobileNumber || '',
      dealerAddressSnapshot: {
        addressTitle: selectedAddress.addressTitle,
        completeAddress: selectedAddress.completeAddress,
        city: selectedAddress.city || '',
        state: selectedAddress.state || '',
        pinCode: selectedAddress.pinCode || '',
        country: selectedAddress.country || 'India',
      },
      productId: product._id,
      productNameSnapshot: product.productName,
      variant: matchedVariant.variantName,
      color: {
        colorName: matchedColor.colorName,
        colorCode: matchedColor.colorCode || '#36CFFF',
      },
      accountId: account._id,
      accountNameSnapshot: account.fullName,
      accountTypeSnapshot: account.accountType || '',
      accountMobileSnapshot: account.mobileNumber || '',
      accountEmailSnapshot: account.email || '',
      paymentMethod,
      creditCardId: finalCreditCardId,
      paymentDetails: finalPaymentDetails,
      purchasePrice: numericPurchasePrice,
      deliveryPrice: finalDeliveryPrice,
      profit: finalProfit,
      grossProfit: finalProfit,
      profitPercentage: typeof finalProfitPercent !== 'undefined' ? finalProfitPercent : null,
      cashbackApplied: finalCashbackApplied,
      cashbackPercentage: finalCashbackPercentage,
      cashbackAmount: finalCashbackAmount,
      netProfit: finalNetProfit,
      status: finalStatus,
      orderDate: finalOrderDate,
      deliveryDate: finalDeliveryDate,
    });

    return res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: newOrder,
    });
  } catch (error) {
    console.error('Create order error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while creating order.' });
  }
};

/**
 * @desc    Get all orders with search, filters, sorting, and pagination
 * @route   GET /api/orders
 * @access  Private (view_orders or admin)
 */
const getOrders = async (req, res) => {
  try {
    const {
      search,
      dealerId,
      productId,
      accountId,
      creditCardId,
      paymentMethod,
      paymentMethods,
      status,
      statuses,
      minPurchasePrice,
      maxPurchasePrice,
      minDeliveryPrice,
      maxDeliveryPrice,
      profitType,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      sort = '-createdAt',
    } = req.query;

    const query = {
      userId: req.user._id,
      deletedAt: null,
    };

    if (req.user.role === 'admin' && req.query.userId) {
      query.userId = req.query.userId;
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

    if (dealerId && mongoose.Types.ObjectId.isValid(dealerId)) {
      query.dealerId = dealerId;
    }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      query.productId = productId;
    }

    if (accountId && mongoose.Types.ObjectId.isValid(accountId)) {
      query.accountId = accountId;
    }

    if (creditCardId && mongoose.Types.ObjectId.isValid(creditCardId)) {
      query.creditCardId = creditCardId;
    }

    const pmFilter = paymentMethods || paymentMethod;
    if (pmFilter && pmFilter !== 'ALL') {
      const pmList = String(pmFilter)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (pmList.length === 1) {
        query.paymentMethod = pmList[0];
      } else if (pmList.length > 1) {
        query.paymentMethod = { $in: pmList };
      }
    }

    // Purchase price range
    if (minPurchasePrice !== undefined && minPurchasePrice !== '' && !isNaN(Number(minPurchasePrice))) {
      query.purchasePrice = query.purchasePrice || {};
      query.purchasePrice.$gte = Number(minPurchasePrice);
    }
    if (maxPurchasePrice !== undefined && maxPurchasePrice !== '' && !isNaN(Number(maxPurchasePrice))) {
      query.purchasePrice = query.purchasePrice || {};
      query.purchasePrice.$lte = Number(maxPurchasePrice);
    }

    // Delivery price range
    if (minDeliveryPrice !== undefined && minDeliveryPrice !== '' && !isNaN(Number(minDeliveryPrice))) {
      query.deliveryPrice = query.deliveryPrice || {};
      query.deliveryPrice.$gte = Number(minDeliveryPrice);
    }
    if (maxDeliveryPrice !== undefined && maxDeliveryPrice !== '' && !isNaN(Number(maxDeliveryPrice))) {
      query.deliveryPrice = query.deliveryPrice || {};
      query.deliveryPrice.$lte = Number(maxDeliveryPrice);
    }

    // Profit type filter
    if (profitType === 'profit') {
      query.profit = { $gt: 0 };
    } else if (profitType === 'loss') {
      query.profit = { $lt: 0 };
    } else if (profitType === 'break_even') {
      query.profit = 0;
    }

    // Date range
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.orderDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.orderDate.$lte = end;
      }
    }

    if (search && search.trim()) {
      const cleanSearch = search.trim();
      const regex = new RegExp(cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { orderId: regex },
        { dealerNameSnapshot: regex },
        { productNameSnapshot: regex },
        { accountNameSnapshot: regex },
        { variant: regex },
        { 'color.colorName': regex },
        { 'paymentDetails.cardName': regex },
        { 'paymentDetails.bankName': regex },
        { 'paymentDetails.lastFourDigits': regex },
        { 'paymentDetails.upiId': regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [orders, totalCount] = await Promise.all([
      Order.find(query)
        .populate('accountId', 'fullName email mobileNumber accountType')
        .populate('creditCardId', 'bankName cardName lastFourDigits cardType cardOwner')
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      count: orders.length,
      totalOrders: totalCount,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      currentPage: pageNum,
      orders,
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching orders.' });
  }
};

/**
 * @desc    Get order dashboard summary statistics
 * @route   GET /api/orders/summary
 * @access  Private (view_orders or admin)
 */
const getOrderSummary = async (req, res) => {
  try {
    const targetUserId =
      req.user.role === 'admin' && req.query.userId
        ? new mongoose.Types.ObjectId(req.query.userId)
        : req.user._id;

    const [summaryAgg] = await Order.aggregate([
      { $match: { userId: targetUserId, deletedAt: null } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          inProcessOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'Order In Process'] }, 1, 0] },
          },
          deliveredOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'Delivered'] }, 1, 0] },
          },
          totalPurchaseAmount: { $sum: { $ifNull: ['$purchasePrice', 0] } },
          totalDeliveryAmount: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'Delivered'] },
                { $ifNull: ['$deliveryPrice', 0] },
                0,
              ],
            },
          },
          totalProfit: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'Delivered'] },
                    { $gt: ['$profit', 0] },
                  ],
                },
                '$profit',
                0,
              ],
            },
          },
          totalLoss: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'Delivered'] },
                    { $lt: ['$profit', 0] },
                  ],
                },
                { $abs: '$profit' },
                0,
              ],
            },
          },
          netProfit: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Delivered'] }, { $ifNull: ['$profit', 0] }, 0],
            },
          },
          totalCashbackAmount: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'Delivered'] },
                { $ifNull: ['$cashbackAmount', 0] },
                0,
              ],
            },
          },
          totalCashbackOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'Delivered'] },
                    { $eq: ['$cashbackApplied', true] },
                    { $gt: ['$cashbackAmount', 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          netProfitAfterCashback: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'Delivered'] },
                {
                  $add: [
                    { $ifNull: ['$profit', 0] },
                    {
                      $cond: [
                        { $eq: ['$cashbackApplied', true] },
                        { $ifNull: ['$cashbackAmount', 0] },
                        0,
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ]);

    const summary = summaryAgg || {
      totalOrders: 0,
      inProcessOrders: 0,
      deliveredOrders: 0,
      totalPurchaseAmount: 0,
      totalDeliveryAmount: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfit: 0,
      totalCashbackAmount: 0,
      netProfitAfterCashback: 0,
    };

    return res.status(200).json({
      success: true,
      summary: {
        totalOrders: summary.totalOrders || 0,
        inProcessOrders: summary.inProcessOrders || 0,
        deliveredOrders: summary.deliveredOrders || 0,
        totalPurchaseAmount: summary.totalPurchaseAmount || 0,
        totalDeliveryAmount: summary.totalDeliveryAmount || 0,
        totalProfit: summary.totalProfit || 0,
        totalLoss: summary.totalLoss || 0,
        netProfit: summary.netProfit || 0,
        totalCashbackAmount: summary.totalCashbackAmount || 0,
        totalCashbackProfit: summary.totalCashbackAmount || 0,
        totalCashbackOrders: summary.totalCashbackOrders || 0,
        netProfitAfterCashback: summary.netProfitAfterCashback || 0,
      },
    });
  } catch (error) {
    console.error('Order summary error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching summary.' });
  }
};

/**
 * @desc    Get order performance & profit metrics within a delivery date range
 * @route   GET /api/orders/performance
 * @access  Private (view_orders or admin)
 */
const getOrderPerformance = async (req, res) => {
  try {
    const targetUserId =
      req.user.role === 'admin' && req.query.userId
        ? new mongoose.Types.ObjectId(req.query.userId)
        : req.user._id;

    // Date range parsing (default: last 15 days)
    let start;
    let end;

    if (req.query.endDate) {
      end = new Date(req.query.endDate);
      if (isNaN(end.getTime())) end = new Date();
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date();
      end.setHours(23, 59, 59, 999);
    }

    if (req.query.startDate) {
      start = new Date(req.query.startDate);
      if (isNaN(start.getTime())) {
        start = new Date(end.getTime() - 15 * 24 * 60 * 60 * 1000);
      }
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
    }

    // 1. Pending orders (always live count of all in-process orders, independent of date range)
    const pendingOrdersPromise = Order.countDocuments({
      userId: targetUserId,
      deletedAt: null,
      status: 'Order In Process',
    });

    // 2. Delivered orders aggregation for the selected delivery date range
    const deliveredAggPromise = Order.aggregate([
      {
        $match: {
          userId: targetUserId,
          deletedAt: null,
          status: 'Delivered',
          $or: [
            { deliveryDate: { $gte: start, $lte: end } },
            { deliveryDate: null, updatedAt: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          completedOrders: { $sum: 1 },
          totalPurchaseAmount: { $sum: { $ifNull: ['$purchasePrice', 0] } },
          totalDeliveryAmount: { $sum: { $ifNull: ['$deliveryPrice', 0] } },
          totalProfit: {
            $sum: {
              $cond: [{ $gt: ['$profit', 0] }, '$profit', 0],
            },
          },
          totalLoss: {
            $sum: {
              $cond: [{ $lt: ['$profit', 0] }, { $abs: '$profit' }, 0],
            },
          },
          netProfit: {
            $sum: { $ifNull: ['$profit', 0] },
          },
          totalCashbackProfit: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$cashbackApplied', true] },
                    { $gt: ['$cashbackAmount', 0] },
                  ],
                },
                '$cashbackAmount',
                0,
              ],
            },
          },
          totalCashbackOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$cashbackApplied', true] },
                    { $gt: ['$cashbackAmount', 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          netProfitAfterCashback: {
            $sum: {
              $add: [
                { $ifNull: ['$profit', 0] },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$cashbackApplied', true] },
                        { $gt: ['$cashbackAmount', 0] },
                      ],
                    },
                    '$cashbackAmount',
                    0,
                  ],
                },
              ],
            },
          },
        },
      },
    ]);

    const [pendingOrders, [perfAgg]] = await Promise.all([
      pendingOrdersPromise,
      deliveredAggPromise,
    ]);

    return res.status(200).json({
      success: true,
      performance: {
        pendingOrders: pendingOrders || 0,
        completedOrders: perfAgg?.completedOrders || 0,
        totalPurchaseAmount: perfAgg?.totalPurchaseAmount || 0,
        totalDeliveryAmount: perfAgg?.totalDeliveryAmount || 0,
        totalProfit: perfAgg?.totalProfit || 0,
        totalLoss: perfAgg?.totalLoss || 0,
        netProfit: perfAgg?.netProfit || 0,
        totalCashbackProfit: perfAgg?.totalCashbackProfit || 0,
        totalCashbackOrders: perfAgg?.totalCashbackOrders || 0,
        netProfitAfterCashback: perfAgg?.netProfitAfterCashback || 0,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get order performance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while calculating order performance.',
    });
  }
};

/**
 * @desc    Get order details by ID
 * @route   GET /api/orders/:id
 * @access  Private (view_orders or admin)
 */
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    let query = { deletedAt: null };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.orderId = id;
    }

    const order = await Order.findOne(query)
      .populate('dealerId', 'dealerName mobileNumber addresses')
      .populate('productId', 'productName variants colors')
      .populate('accountId', 'fullName email mobileNumber accountType')
      .populate('creditCardId', 'bankName cardName lastFourDigits cardType');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('Get order by ID error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching order.' });
  }
};

/**
 * @desc    Update order (supports both in-process and delivered orders)
 * @route   PUT /api/orders/:id
 * @access  Private (edit_order or admin)
 */
const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;

    let query = { deletedAt: null };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.orderId = id;
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only edit your own orders.',
      });
    }

    const {
      dealerId,
      dealerAddressId,
      productId,
      variant,
      color,
      accountId,
      paymentMethod,
      creditCardId,
      paymentDetails,
      purchasePrice,
      status,
      deliveryPrice,
      deliveryDate,
      orderDate,
      cashbackApplied,
      cashbackAmount,
      reason,
      statusChangeReason,
    } = req.body || {};

    const previousSnapshot = {
      orderDate: order.orderDate,
      purchasePrice: order.purchasePrice,
      deliveryPrice: order.deliveryPrice,
      profit: order.profit,
      profitPercentage: order.profitPercentage,
      status: order.status,
      deliveryDate: order.deliveryDate,
      dealerId: order.dealerId,
      productId: order.productId,
      variant: order.variant,
      color: order.color,
      accountId: order.accountId,
      paymentMethod: order.paymentMethod,
    };

    let priceChanged = false;

    if (purchasePrice !== undefined) {
      const num = Number(purchasePrice);
      if (isNaN(num) || num <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid positive purchase price is required.',
        });
      }
      if (order.purchasePrice !== num) {
        order.purchasePrice = num;
        priceChanged = true;
      }
    }

    // Status & Delivery Price handling
    if (status !== undefined) {
      if (status === 'Delivered') {
        const dPrice = deliveryPrice !== undefined ? Number(deliveryPrice) : order.deliveryPrice;
        if (dPrice === undefined || dPrice === null || isNaN(dPrice) || dPrice < 0) {
          return res.status(400).json({
            success: false,
            message: 'Delivery price is required and cannot be negative for delivered orders.',
          });
        }
        order.status = 'Delivered';
        order.deliveryPrice = dPrice;
        order.deliveryDate = deliveryDate ? new Date(deliveryDate) : order.deliveryDate || new Date();
        order.profit = Math.round((order.deliveryPrice - order.purchasePrice) * 100) / 100;
      } else if (status === 'Order In Process') {
        if (order.status === 'Delivered' && !statusChangeReason && !reason) {
          return res.status(400).json({
            success: false,
            message: 'A valid business reason is required when transitioning a delivered order back to Order In Process.',
          });
        }
        order.status = 'Order In Process';
        order.deliveryPrice = null;
        order.deliveryDate = null;
        order.profit = null;
        order.profitPercentage = null;
        order.cashbackApplied = false;
        order.cashbackPercentage = 0;
        order.cashbackAmount = 0;
        order.netProfit = null;
      }
    } else if (order.status === 'Delivered') {
      if (deliveryPrice !== undefined) {
        const dPrice = Number(deliveryPrice);
        if (isNaN(dPrice) || dPrice < 0) {
          return res.status(400).json({
            success: false,
            message: 'Delivery price cannot be negative.',
          });
        }
        if (order.deliveryPrice !== dPrice) {
          order.deliveryPrice = dPrice;
          priceChanged = true;
        }
      }
      if (deliveryDate !== undefined) {
        order.deliveryDate = deliveryDate ? new Date(deliveryDate) : order.deliveryDate;
      }
      if (priceChanged) {
        order.profit = Math.round((order.deliveryPrice - order.purchasePrice) * 100) / 100;
      }
    }

    if (orderDate !== undefined) {
      const parsedOD = new Date(orderDate);
      if (!isNaN(parsedOD.getTime())) {
        order.orderDate = parsedOD;
      }
    }

    if (order.status === 'Delivered') {
      if (order.profit !== null) {
        let finalPercent = order.purchasePrice > 0
          ? Math.round(((order.profit / order.purchasePrice) * 100) * 100) / 100
          : 0;
        if (req.body.profitPercentage !== undefined && req.body.profitPercentage !== null && !isNaN(Number(req.body.profitPercentage))) {
          finalPercent = Math.round(Number(req.body.profitPercentage) * 100) / 100;
        }
        order.profitPercentage = finalPercent;

        const isCashback = cashbackApplied !== undefined
          ? Boolean(cashbackApplied)
          : Boolean(order.cashbackApplied);

        if (isCashback) {
          let cbAmt = cashbackAmount !== undefined
            ? Number(cashbackAmount)
            : (order.cashbackAmount || 0);
          if (isNaN(cbAmt) || cbAmt < 0) {
            cbAmt = 0;
          }
          order.cashbackApplied = true;
          order.cashbackAmount = Math.round(cbAmt * 100) / 100;
          order.grossProfit = order.profit;
          order.netProfit = Math.round((order.profit + order.cashbackAmount) * 100) / 100;
        } else {
          order.cashbackApplied = false;
          order.cashbackAmount = 0;
          order.grossProfit = order.profit;
          order.netProfit = order.profit;
        }
      }
    } else if (order.status === 'Order In Process') {
      order.profit = null;
      order.grossProfit = null;
      order.profitPercentage = null;
      order.cashbackApplied = false;
      order.cashbackPercentage = 0;
      order.cashbackAmount = 0;
      order.netProfit = null;
    }

    // Update Dealer if provided
    if (dealerId && dealerId !== order.dealerId?.toString()) {
      if (!mongoose.Types.ObjectId.isValid(dealerId)) {
        return res.status(400).json({ success: false, message: 'Invalid dealer ID.' });
      }
      const dealer = await Dealer.findById(dealerId);
      if (!dealer || (dealer.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
        return res.status(400).json({ success: false, message: 'Invalid dealer selection.' });
      }
      order.dealerId = dealer._id;
      order.dealerNameSnapshot = dealer.dealerName;
      order.dealerMobileSnapshot = dealer.mobileNumber || '';

      let selAddr = null;
      if (dealerAddressId && Array.isArray(dealer.addresses)) {
        selAddr = dealer.addresses.find((a) => (a._id ? a._id.toString() : '') === dealerAddressId.toString());
      }
      if (!selAddr && dealer.addresses?.length === 1) {
        selAddr = dealer.addresses[0];
      }
      if (selAddr) {
        order.dealerAddressId = selAddr._id ? selAddr._id.toString() : '';
        order.dealerAddressSnapshot = {
          addressTitle: selAddr.addressTitle,
          completeAddress: selAddr.completeAddress,
          city: selAddr.city || '',
          state: selAddr.state || '',
          pinCode: selAddr.pinCode || '',
          country: selAddr.country || 'India',
        };
      }
    } else if (dealerAddressId && dealerAddressId !== order.dealerAddressId) {
      const dealer = await Dealer.findById(order.dealerId);
      if (dealer && Array.isArray(dealer.addresses)) {
        const selAddr = dealer.addresses.find((a) => (a._id ? a._id.toString() : '') === dealerAddressId.toString());
        if (selAddr) {
          order.dealerAddressId = selAddr._id ? selAddr._id.toString() : '';
          order.dealerAddressSnapshot = {
            addressTitle: selAddr.addressTitle,
            completeAddress: selAddr.completeAddress,
            city: selAddr.city || '',
            state: selAddr.state || '',
            pinCode: selAddr.pinCode || '',
            country: selAddr.country || 'India',
          };
        }
      }
    }

    // Update Product if provided
    if (productId && (productId !== order.productId?.toString() || variant || color)) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: 'Invalid product ID.' });
      }
      const product = await Product.findById(productId);
      if (!product || (product.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
        return res.status(400).json({ success: false, message: 'Invalid product selection.' });
      }
      order.productId = product._id;
      order.productNameSnapshot = product.productName;

      if (variant) {
        order.variant = variant.trim();
      }
      if (color) {
        const cName = typeof color === 'string' ? color.trim() : color?.colorName?.trim();
        const matchedC = product.colors.find((c) => c.colorName.toLowerCase() === cName.toLowerCase());
        order.color = {
          colorName: cName,
          colorCode: matchedC?.colorCode || color?.colorCode || '#36CFFF',
        };
      }
    }

    // Update Account if provided
    if (accountId && accountId !== order.accountId?.toString()) {
      if (!mongoose.Types.ObjectId.isValid(accountId)) {
        return res.status(400).json({ success: false, message: 'Invalid account ID.' });
      }
      const account = await Account.findById(accountId);
      if (!account || (account.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
        return res.status(400).json({ success: false, message: 'Invalid account selection.' });
      }
      order.accountId = account._id;
      order.accountNameSnapshot = account.fullName;
      order.accountTypeSnapshot = account.accountType || '';
      order.accountMobileSnapshot = account.mobileNumber || '';
      order.accountEmailSnapshot = account.email || '';
    }

    // Update Payment if provided
    if (paymentMethod) {
      order.paymentMethod = paymentMethod;
      if (paymentMethod === 'Credit Card' && creditCardId) {
        const card = await CreditCard.findById(creditCardId);
        if (card) {
          order.creditCardId = card._id;
          order.paymentDetails = {
            bankName: card.bankName,
            cardName: card.cardName,
            cardType: card.cardType || 'Credit Card',
            lastFourDigits: card.lastFourDigits,
            cardHolderName: card.cardOwner || '',
          };
        }
      } else if (paymentDetails) {
        order.creditCardId = null;
        order.paymentDetails = paymentDetails;
      }
    }

    // Record audit trail
    if (!order.editHistory) order.editHistory = [];
    order.editHistory.push({
      editedAt: new Date(),
      editedBy: req.user._id,
      previousValues: previousSnapshot,
      updatedValues: {
        orderDate: order.orderDate,
        purchasePrice: order.purchasePrice,
        deliveryPrice: order.deliveryPrice,
        profit: order.profit,
        profitPercentage: order.profitPercentage,
        status: order.status,
        deliveryDate: order.deliveryDate,
      },
      reason: reason || statusChangeReason || 'Order updated',
    });

    await order.save();

    // If order was already Delivered and delivery price was changed, sync to Khata Book
    if (previousSnapshot.status === 'Delivered' && order.status === 'Delivered') {
      const prevDPrice = previousSnapshot.deliveryPrice || 0;
      const newDPrice = order.deliveryPrice || 0;
      if (prevDPrice !== newDPrice) {
        try {
          await syncDeliveryPriceToKhataBook({
            order,
            prevPrice: prevDPrice,
            newPrice: newDPrice,
            userId: req.user._id,
            reason: reason || statusChangeReason || 'Order delivery price updated',
            deliveryDate: order.deliveryDate,
          });
        } catch (syncErr) {
          console.error('Failed to sync delivery price to KhataBook from updateOrder:', syncErr);
        }
      }
    }

    // If order delivery was reverted to Order In Process, reverse active Khata Book entries
    if (previousSnapshot.status === 'Delivered' && order.status === 'Order In Process') {
      try {
        const orderTxs = await KhataTransaction.find({
          userId: req.user._id,
          referenceType: 'Order',
          referenceId: order._id.toString(),
          deletedAt: null,
          isReversed: false,
        });
        for (const tx of orderTxs) {
          tx.isReversed = true;
          tx.reversalReason = reason || statusChangeReason || 'Order delivery reverted to in process';
          await tx.save();
          await recalculateKhataBookBalance(tx.khataBookId);
        }
      } catch (revErr) {
        console.error('Error reversing Khata transactions on delivery revert:', revErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Order updated successfully.',
      order,
    });
  } catch (error) {
    console.error('Update order error:', error);
    return res.status(500).json({ success: false, message: 'Server error while updating order.' });
  }
};

/**
 * @desc    Mark order as Delivered with final delivery price and auto-calculate profit
 * @route   PATCH /api/orders/:id/deliver
 * @access  Private (edit_order or admin)
 */
const deliverOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryPrice, deliveryDate, cashbackApplied = false, cashbackAmount = 0 } = req.body || {};

    const numericDeliveryPrice = Number(deliveryPrice);
    if (isNaN(numericDeliveryPrice) || numericDeliveryPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive delivery price / final dealer price is required.',
      });
    }

    let parsedDeliveryDate = new Date();
    if (deliveryDate) {
      const d = new Date(deliveryDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Valid delivery date is required.',
        });
      }
      parsedDeliveryDate = d;
    }

    let query = { deletedAt: null };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.orderId = id;
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    // Calculate Profit = Delivery Price - Purchase Price
    const profit = Math.round((numericDeliveryPrice - order.purchasePrice) * 100) / 100;
    const profitPercentage = order.purchasePrice > 0
      ? Math.round(((profit / order.purchasePrice) * 100) * 100) / 100
      : 0;

    const isCashback = Boolean(cashbackApplied);
    let finalCashbackAmount = 0;
    if (isCashback) {
      const numCb = Number(cashbackAmount);
      if (isNaN(numCb) || numCb < 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid non-negative cashback amount is required.',
        });
      }
      finalCashbackAmount = Math.round(numCb * 100) / 100;
    }
    const netProfit = Math.round((profit + finalCashbackAmount) * 100) / 100;

    order.deliveryPrice = numericDeliveryPrice;
    order.profit = profit;
    order.grossProfit = profit;
    order.profitPercentage = profitPercentage;
    order.cashbackApplied = isCashback;
    order.cashbackAmount = finalCashbackAmount;
    order.netProfit = netProfit;
    order.status = 'Delivered';
    order.deliveryDate = parsedDeliveryDate;

    await order.save();

    // If requested and dealer has a linked KhataBook account, add delivery price transaction
    let khataTransaction = null;
    if (req.body.addToKhataBook && order.dealerId) {
      try {
        const linkedKb = await KhataBook.findOne({
          userId: req.user._id,
          dealerId: order.dealerId,
          deletedAt: null,
        });

        if (linkedKb) {
          // Idempotency check: verify not already recorded for this order
          let existingTx = await KhataTransaction.findOne({
            userId: req.user._id,
            khataBookId: linkedKb._id,
            referenceType: 'Order',
            referenceId: order._id.toString(),
            deletedAt: null,
          });

          if (!existingTx) {
            const productParts = [];
            if (order.productNameSnapshot) productParts.push(order.productNameSnapshot);
            if (order.variant) productParts.push(order.variant);
            const colorName = typeof order.color === 'string' ? order.color : order.color?.colorName;
            if (colorName) productParts.push(colorName);
            const productDesc = productParts.length > 0 ? productParts.join(' - ') : 'Product';

            existingTx = new KhataTransaction({
              userId: req.user._id,
              khataBookId: linkedKb._id,
              transactionType: 'MONEY_GIVEN',
              amount: numericDeliveryPrice,
              transactionDate: parsedDeliveryDate,
              paymentMode: 'Online Order',
              description: `${productDesc} - Order #${order.orderId}`,
              referenceType: 'Order',
              referenceId: order._id.toString(),
            });
            await existingTx.save();
            await recalculateKhataBookBalance(linkedKb._id);
            khataTransaction = existingTx;
          }
        }
      } catch (kbErr) {
        console.error('Error adding order delivery to KhataBook:', kbErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Order marked as Delivered successfully.',
      order,
      khataTransaction,
    });
  } catch (error) {
    console.error('Deliver order error:', error);
    return res.status(500).json({ success: false, message: 'Server error while completing delivery.' });
  }
};

/**
 * Synchronize delivery price difference to linked Khata Book
 * Handles positive difference (+due / MONEY_GIVEN) and negative difference (adjustment / REVERSAL)
 */
const syncDeliveryPriceToKhataBook = async ({
  order,
  prevPrice,
  newPrice,
  userId,
  reason = 'Delivery price updated',
  deliveryDate = null,
}) => {
  const numericPrev = Number(prevPrice || 0);
  const numericNew = Number(newPrice || 0);
  const diff = Math.round((numericNew - numericPrev) * 100) / 100;

  // Prevent duplicate adjustments if the user saves the same updated price multiple times
  if (diff === 0) return null;

  // Rule 7 & 8: Check if original order has a linked Khata Book transaction
  const existingOrderTx = await KhataTransaction.findOne({
    userId,
    referenceType: 'Order',
    referenceId: order._id.toString(),
    deletedAt: null,
  });

  // If original order was created with Khata Book unchecked, do not start adding transactions automatically
  if (!existingOrderTx) {
    return null;
  }

  const khataBookId = existingOrderTx.khataBookId;
  const productParts = [];
  if (order.productNameSnapshot) productParts.push(order.productNameSnapshot);
  if (order.variant) productParts.push(order.variant);
  const colorName = typeof order.color === 'string' ? order.color : order.color?.colorName;
  if (colorName) productParts.push(colorName);
  const productDesc = productParts.length > 0 ? productParts.join(' - ') : 'Product';

  const txDate = deliveryDate || order.deliveryDate || new Date();

  let adjustmentTx = null;

  if (diff > 0) {
    // Delivery price increased -> Add positive difference as additional due
    adjustmentTx = new KhataTransaction({
      userId,
      khataBookId,
      transactionType: 'MONEY_GIVEN',
      amount: diff,
      transactionDate: txDate,
      paymentMode: 'Online Order',
      description: `${productDesc} - Order #${order.orderId}`,
      referenceType: 'Order',
      referenceId: order._id.toString(),
      auditHistory: [
        {
          editedAt: new Date(),
          editedBy: userId,
          previousValues: { deliveryPrice: numericPrev },
          updatedValues: { deliveryPrice: numericNew },
          reason: `Delivery price increased from ₹${numericPrev} to ₹${numericNew} (+₹${diff}): ${reason}`,
        },
      ],
    });
  } else {
    // Delivery price decreased -> Add adjustment reducing receivable
    const absDiff = Math.abs(diff);
    adjustmentTx = new KhataTransaction({
      userId,
      khataBookId,
      transactionType: 'REVERSAL',
      amount: absDiff,
      reversalDelta: diff, // negative delta e.g. -1000
      transactionDate: txDate,
      paymentMode: 'Online Order',
      description: `${productDesc} - Order #${order.orderId}`,
      referenceType: 'Order',
      referenceId: order._id.toString(),
      isReversed: false, // Active adjustment entry that reduces balance
      auditHistory: [
        {
          editedAt: new Date(),
          editedBy: userId,
          previousValues: { deliveryPrice: numericPrev },
          updatedValues: { deliveryPrice: numericNew },
          reason: `Delivery price decreased from ₹${numericPrev} to ₹${numericNew} (-₹${absDiff}): ${reason}`,
        },
      ],
    });
  }

  await adjustmentTx.save();
  await recalculateKhataBookBalance(khataBookId);
  return adjustmentTx;
};

/**
 * @desc    Correct delivery price for delivered order and maintain audit history
 * @route   PATCH /api/orders/:id/delivery-price
 * @access  Private (edit_order or admin)
 */
const correctDeliveryPrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDeliveryPrice, reason = 'Price correction' } = req.body || {};

    const numericNewPrice = Number(newDeliveryPrice);
    if (isNaN(numericNewPrice) || numericNewPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive delivery price is required.',
      });
    }

    let query = { deletedAt: null };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.orderId = id;
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this order.',
      });
    }

    if (order.status !== 'Delivered') {
      return res.status(400).json({
        success: false,
        message: 'Delivery price correction is only applicable for Delivered orders.',
      });
    }

    const prevPrice = order.deliveryPrice || 0;
    const prevProfit = order.profit || 0;
    const prevCashbackAmount = order.cashbackAmount || 0;
    const newProfit = Math.round((numericNewPrice - order.purchasePrice) * 100) / 100;
    let newProfitPercentage = order.purchasePrice > 0
      ? Math.round(((newProfit / order.purchasePrice) * 100) * 100) / 100
      : 0;
    if (req.body.profitPercentage !== undefined && req.body.profitPercentage !== null && !isNaN(Number(req.body.profitPercentage))) {
      newProfitPercentage = Math.round(Number(req.body.profitPercentage) * 100) / 100;
    }

    let newCashbackAmount = 0;
    let newCashbackPercentage = 0;
    let newNetProfit = newProfit;

    const isCashback = req.body.cashbackApplied !== undefined
      ? Boolean(req.body.cashbackApplied)
      : Boolean(order.cashbackApplied);

    if (isCashback) {
      let cbAmt = req.body.cashbackAmount !== undefined
        ? Number(req.body.cashbackAmount)
        : (order.cashbackAmount || 0);
      if (isNaN(cbAmt) || cbAmt < 0) {
        cbAmt = 0;
      }
      order.cashbackApplied = true;
      newCashbackAmount = Math.round(cbAmt * 100) / 100;
      newNetProfit = Math.round((newProfit + newCashbackAmount) * 100) / 100;
    } else {
      order.cashbackApplied = false;
      newCashbackAmount = 0;
      newNetProfit = newProfit;
    }

    // Push audit entry
    order.deliveryPriceHistory.push({
      previousPrice: prevPrice,
      newPrice: numericNewPrice,
      previousProfit: prevProfit,
      newProfit: newProfit,
      previousCashbackAmount: prevCashbackAmount,
      newCashbackAmount: newCashbackAmount,
      changedAt: new Date(),
      changedBy: req.user._id,
      reason: reason.trim() || 'Delivery price correction',
    });

    order.deliveryPrice = numericNewPrice;
    order.profit = newProfit;
    order.grossProfit = newProfit;
    order.profitPercentage = newProfitPercentage;
    order.cashbackPercentage = newCashbackPercentage;
    order.cashbackAmount = newCashbackAmount;
    order.netProfit = newNetProfit;

    await order.save();

    // Synchronize delivery price difference to linked Khata Book
    let khataAdjustmentTx = null;
    try {
      khataAdjustmentTx = await syncDeliveryPriceToKhataBook({
        order,
        prevPrice,
        newPrice: numericNewPrice,
        userId: req.user._id,
        reason: reason.trim() || 'Delivery price correction',
        deliveryDate: order.deliveryDate,
      });
    } catch (syncErr) {
      console.error('Failed to sync delivery price to KhataBook:', syncErr);
    }

    return res.status(200).json({
      success: true,
      message: 'Delivery price corrected and profit recalculated successfully.',
      order,
    });
  } catch (error) {
    console.error('Correct delivery price error:', error);
    return res.status(500).json({ success: false, message: 'Server error while correcting price.' });
  }
};

/**
 * @desc    Delete (soft-delete) an order
 * @route   DELETE /api/orders/:id
 * @access  Private (delete_order or admin)
 */
const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    let query = { deletedAt: null };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.orderId = id;
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own orders.',
      });
    }

    // Soft delete order to preserve historical and audit integrity
    order.deletedAt = new Date();
    await order.save();

    // If linked KhataBook transactions exist, reverse them properly
    try {
      const linkedTxs = await KhataTransaction.find({
        userId: req.user._id,
        referenceType: 'Order',
        referenceId: order._id.toString(),
        deletedAt: null,
        isReversed: false,
      });

      for (const linkedTx of linkedTxs) {
        linkedTx.isReversed = true;
        linkedTx.reversalReason = `Order #${order.orderId} deleted`;
        await linkedTx.save();
        await recalculateKhataBookBalance(linkedTx.khataBookId);
      }
    } catch (reversalErr) {
      console.error('Failed to reverse KhataBook transaction for deleted order:', reversalErr);
    }

    return res.status(200).json({
      success: true,
      message: 'Order deleted successfully.',
    });
  } catch (error) {
    console.error('Delete order error:', error);
    return res.status(500).json({ success: false, message: 'Server error while deleting order.' });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderSummary,
  getOrderPerformance,
  getOrderById,
  updateOrder,
  deliverOrder,
  correctDeliveryPrice,
  deleteOrder,
};

