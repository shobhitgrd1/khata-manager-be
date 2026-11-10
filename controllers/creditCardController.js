const CreditCard = require('../models/CreditCard');
const CreditCardTransaction = require('../models/CreditCardTransaction');
const Order = require('../models/Order');
const KhataTransaction = require('../models/KhataTransaction');

/**
 * @desc    Create a new credit card
 * @route   POST /api/credit-cards
 * @access  Private (create_credit_card or admin)
 */
const createCreditCard = async (req, res) => {
  try {
    const {
      bankName,
      cardName,
      lastFourDigits,
      totalLimit,
      availableLimit,
      usedLimit,
      cardOwner,
    } = req.body;

    // Field presence validation
    if (!bankName || !cardName || !lastFourDigits || totalLimit === undefined) {
      return res.status(400).json({
        success: false,
        message: 'bankName, cardName, lastFourDigits, and totalLimit are required',
      });
    }

    // Number conversions
    const numTotal = Number(totalLimit);
    let numUsed = 0;
    if (usedLimit !== undefined) {
      numUsed = Number(usedLimit);
    } else if (availableLimit !== undefined) {
      numUsed = Math.max(0, numTotal - Number(availableLimit));
    }

    if (isNaN(numTotal) || numTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Total credit limit must be a positive number greater than zero',
      });
    }

    if (isNaN(numUsed) || numUsed < 0) {
      return res.status(400).json({
        success: false,
        message: 'Used credit limit cannot be negative',
      });
    }

    const numAvailable = Math.max(0, numTotal - numUsed);

    // Format last 4 digits
    const cleanDigits = String(lastFourDigits).trim();
    if (!/^\d{4}$/.test(cleanDigits)) {
      return res.status(400).json({
        success: false,
        message: 'Last four digits must contain exactly 4 numeric digits',
      });
    }

    const resolvedOwner = (cardOwner && String(cardOwner).trim()) || req.user.name || 'Cardholder';

    // Server-side ownership derivation: never trust user-supplied userId
    const creditCard = await CreditCard.create({
      userId: req.user._id,
      cardOwner: resolvedOwner,
      bankName: bankName.trim(),
      cardName: cardName.trim(),
      lastFourDigits: cleanDigits,
      totalLimit: numTotal,
      usedLimit: numUsed,
      availableLimit: numAvailable,
    });

    return res.status(201).json({
      success: true,
      message: 'Credit card added successfully',
      creditCard,
    });
  } catch (error) {
    console.error('Create credit card error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to create credit card',
    });
  }
};

/**
 * @desc    Get credit cards belonging to authenticated user
 * @route   GET /api/credit-cards
 * @access  Private (view_credit_cards or admin)
 */
const getCreditCards = async (req, res) => {
  try {
    const {
      search,
      bank,
      banks,
      minLimit,
      maxLimit,
      minAvailable,
      maxAvailable,
      startDate,
      endDate,
      cardOwner,
      sort = '-createdAt',
    } = req.query;

    // By default, query cards belonging to current user
    // Admins can pass ?all=true to inspect all cards if needed
    const query = {};
    if (req.user.role === 'admin' && req.query.all === 'true') {
      // allow admin to view all
    } else {
      query.userId = req.user._id;
    }

    const bankFilterValue = banks || bank;
    if (bankFilterValue && bankFilterValue !== 'ALL') {
      const bankList = String(bankFilterValue)
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
      if (bankList.length === 1) {
        query.bankName = bankList[0];
      } else if (bankList.length > 1) {
        query.bankName = { $in: bankList };
      }
    }

    if (cardOwner && cardOwner.trim()) {
      query.cardOwner = { $regex: cardOwner.trim(), $options: 'i' };
    }

    // Total limit range
    if (minLimit !== undefined && minLimit !== '' && !isNaN(Number(minLimit))) {
      query.totalLimit = query.totalLimit || {};
      query.totalLimit.$gte = Number(minLimit);
    }
    if (maxLimit !== undefined && maxLimit !== '' && !isNaN(Number(maxLimit))) {
      query.totalLimit = query.totalLimit || {};
      query.totalLimit.$lte = Number(maxLimit);
    }

    // Available limit range
    if (minAvailable !== undefined && minAvailable !== '' && !isNaN(Number(minAvailable))) {
      query.availableLimit = query.availableLimit || {};
      query.availableLimit.$gte = Number(minAvailable);
    }
    if (maxAvailable !== undefined && maxAvailable !== '' && !isNaN(Number(maxAvailable))) {
      query.availableLimit = query.availableLimit || {};
      query.availableLimit.$lte = Number(maxAvailable);
    }

    // Date range
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
      const cleanSearch = search.trim();
      query.$or = [
        { cardName: { $regex: cleanSearch, $options: 'i' } },
        { bankName: { $regex: cleanSearch, $options: 'i' } },
        { cardOwner: { $regex: cleanSearch, $options: 'i' } },
        { lastFourDigits: { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    let sortObj = { createdAt: -1 };
    if (sort) {
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
      const sortOrder = sort.startsWith('-') ? -1 : 1;
      sortObj = { [sortField]: sortOrder };
    }

    const creditCards = await CreditCard.find(query)
      .sort(sortObj)
      .populate('userId', 'name email username');

    return res.status(200).json({
      success: true,
      count: creditCards.length,
      creditCards,
    });
  } catch (error) {
    console.error('Get credit cards error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve credit cards',
    });
  }
};

/**
 * @desc    Get summary statistics for dashboard and card overview
 * @route   GET /api/credit-cards/summary
 * @access  Private (view_credit_cards or admin)
 */
const getCreditCardSummary = async (req, res) => {
  try {
    const query = { userId: req.user._id };

    const cards = await CreditCard.find(query);

    const totalCards = cards.length;
    let totalCreditLimit = 0;
    let usedCreditAmount = 0;

    for (const card of cards) {
      totalCreditLimit += card.totalLimit || 0;
      const used = card.usedLimit !== undefined ? card.usedLimit : Math.max(0, (card.totalLimit || 0) - (card.availableLimit || 0));
      usedCreditAmount += used;
    }

    const availableCreditLimit = Math.max(0, totalCreditLimit - usedCreditAmount);
    const overallUtilization =
      totalCreditLimit > 0
        ? Math.min(100, Math.round((usedCreditAmount / totalCreditLimit) * 100))
        : 0;

    return res.status(200).json({
      success: true,
      summary: {
        totalCards,
        totalCreditLimit,
        availableCreditLimit,
        usedCreditAmount,
        overallUtilization,
      },
    });
  } catch (error) {
    console.error('Credit card summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate credit card summary',
    });
  }
};

/**
 * @desc    Get details of a specific credit card
 * @route   GET /api/credit-cards/:id
 * @access  Private (view_credit_cards or admin)
 */
const getCreditCardById = async (req, res) => {
  try {
    const card = await CreditCard.findById(req.params.id).populate('userId', 'name email username');

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Credit card not found',
      });
    }

    // Ownership verification: user can only view their own card unless admin
    if (card.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view this credit card',
      });
    }

    return res.status(200).json({
      success: true,
      creditCard: card,
    });
  } catch (error) {
    console.error('Get credit card by id error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve credit card details',
    });
  }
};

/**
 * @desc    Update a credit card (limits, name, bank, digits)
 * @route   PUT /api/credit-cards/:id
 * @access  Private (edit_credit_card or admin)
 */
const updateCreditCard = async (req, res) => {
  try {
    const card = await CreditCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Credit card not found',
      });
    }

    // Ownership verification: user can only update their own card unless admin
    if (card.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to edit this credit card',
      });
    }

    const {
      bankName,
      cardName,
      lastFourDigits,
      totalLimit,
      availableLimit,
      cardOwner,
    } = req.body;

    if (bankName) card.bankName = bankName.trim();
    if (cardName) card.cardName = cardName.trim();
    if (cardOwner !== undefined) card.cardOwner = String(cardOwner).trim();

    if (lastFourDigits !== undefined) {
      const cleanDigits = String(lastFourDigits).trim();
      if (!/^\d{4}$/.test(cleanDigits)) {
        return res.status(400).json({
          success: false,
          message: 'Last four digits must contain exactly 4 numeric digits',
        });
      }
      card.lastFourDigits = cleanDigits;
    }

    if (totalLimit !== undefined) {
      const numTotal = Number(totalLimit);
      if (isNaN(numTotal) || numTotal <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Total credit limit must be greater than zero',
        });
      }
      card.totalLimit = numTotal;
    }

    if (req.body.usedLimit !== undefined) {
      const numUsed = Number(req.body.usedLimit);
      if (isNaN(numUsed) || numUsed < 0) {
        return res.status(400).json({
          success: false,
          message: 'Used credit limit cannot be negative',
        });
      }
      card.usedLimit = numUsed;
      card.availableLimit = Math.max(0, card.totalLimit - numUsed);
    } else if (availableLimit !== undefined) {
      const numAvailable = Number(availableLimit);
      if (isNaN(numAvailable) || numAvailable < 0) {
        return res.status(400).json({
          success: false,
          message: 'Available credit limit cannot be negative',
        });
      }
      card.availableLimit = numAvailable;
      card.usedLimit = Math.max(0, card.totalLimit - numAvailable);
    }

    // Validate that used does not exceed total
    if (card.usedLimit > card.totalLimit) {
      return res.status(400).json({
        success: false,
        message: 'Used credit limit cannot exceed total credit limit',
      });
    }

    await card.save();

    return res.status(200).json({
      success: true,
      message: 'Credit card updated successfully',
      creditCard: card,
    });
  } catch (error) {
    console.error('Update credit card error:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to update credit card',
    });
  }
};

/**
 * @desc    Delete a credit card
 * @route   DELETE /api/credit-cards/:id
 * @access  Private (delete_credit_card or admin)
 */
const deleteCreditCard = async (req, res) => {
  try {
    const card = await CreditCard.findById(req.params.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Credit card not found',
      });
    }

    // Ownership verification
    if (card.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to delete this credit card',
      });
    }

    await CreditCard.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: `Credit card ${card.cardName} (${card.lastFourDigits}) deleted successfully`,
    });
  } catch (error) {
    console.error('Delete credit card error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete credit card',
    });
  }
};

/**
 * @desc    Get transaction history for a specific credit card
 * @route   GET /api/credit-cards/:id/transactions
 * @access  Private (view_credit_cards or admin)
 */
const getCreditCardTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await CreditCard.findById(id).populate('userId', 'name email username');

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Credit card not found',
      });
    }

    if (card.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view transactions for this credit card',
      });
    }

    const { search, transactionType, startDate, endDate } = req.query;
    const query = { creditCardId: id, deletedAt: null };

    if (transactionType && ['USE_CARD', 'PAY_CARD'].includes(transactionType)) {
      query.transactionType = transactionType;
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [{ description: regex }, { paymentMode: regex }];
    }

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    const transactions = await CreditCardTransaction.find(query).sort({
      transactionDate: -1,
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      creditCard: card,
      transactions,
      total: transactions.length,
    });
  } catch (error) {
    console.error('getCreditCardTransactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve card transactions',
      error: error.message,
    });
  }
};

/**
 * @desc    Add a manual transaction (Pay Credit Card or Use Credit Card)
 * @route   POST /api/credit-cards/:id/transactions
 * @access  Private (edit_credit_card or admin)
 */
const addCreditCardTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await CreditCard.findById(id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Credit card not found',
      });
    }

    if (card.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to record transactions for this credit card',
      });
    }

    const {
      transactionType,
      amount,
      transactionDate,
      paymentMode,
      description,
      orderId,
    } = req.body;

    if (!transactionType || !['USE_CARD', 'PAY_CARD'].includes(transactionType)) {
      return res.status(400).json({
        success: false,
        message: 'transactionType must be either USE_CARD or PAY_CARD',
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Transaction amount must be a number greater than zero',
      });
    }

    const currentUsed =
      card.usedLimit !== undefined
        ? card.usedLimit
        : Math.max(0, (card.totalLimit || 0) - (card.availableLimit || 0));

    if (transactionType === 'PAY_CARD') {
      // Paying an amount towards the credit card reduces the Used Credit Limit
      card.usedLimit = Math.max(0, currentUsed - numericAmount);
      card.availableLimit = Math.max(0, card.totalLimit - card.usedLimit);
    } else {
      // Using credit card increases Used Credit Limit
      card.usedLimit = currentUsed + numericAmount;
      card.availableLimit = Math.max(0, card.totalLimit - card.usedLimit);
    }

    await card.save();

    const cleanOrderId = orderId && typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null;

    let linkedOrder = null;
    if (cleanOrderId) {
      linkedOrder = await Order.findOne({ orderId: cleanOrderId, userId: req.user._id });
    }

    let baseDesc = description && description.trim()
      ? description.trim()
      : (transactionType === 'PAY_CARD' ? 'Credit card payment' : 'Credit card usage');

    let finalDesc = baseDesc;
    if (cleanOrderId) {
      if (!baseDesc.toLowerCase().includes(cleanOrderId.toLowerCase())) {
        finalDesc = `Order #${cleanOrderId} - ${baseDesc}`;
      }
    }

    if (linkedOrder && cleanOrderId) {
      try {
        const linkedKhataTxs = await KhataTransaction.find({
          referenceType: 'Order',
          referenceId: linkedOrder._id.toString(),
          userId: req.user._id,
        });
        for (const ktx of linkedKhataTxs) {
          let updated = false;
          if (!ktx.orderId) {
            ktx.orderId = cleanOrderId;
            updated = true;
          }
          if (ktx.description && !ktx.description.toLowerCase().includes(cleanOrderId.toLowerCase())) {
            ktx.description = `${ktx.description} - Order #${cleanOrderId}`;
            updated = true;
          }
          if (updated) {
            await ktx.save();
          }
        }
      } catch (kErr) {
        console.error('Failed to sync orderId to KhataTransaction:', kErr);
      }
    }

    const transaction = new CreditCardTransaction({
      userId: req.user._id,
      creditCardId: card._id,
      transactionType,
      amount: numericAmount,
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      paymentMode: paymentMode || (transactionType === 'PAY_CARD' ? 'UPI' : 'Card Swipe'),
      description: finalDesc,
      referenceType: linkedOrder ? 'Order' : 'Manual',
      referenceId: linkedOrder ? linkedOrder._id.toString() : null,
      orderId: cleanOrderId || null,
      runningUsedLimit: card.usedLimit,
      runningAvailableLimit: card.availableLimit,
    });

    await transaction.save();

    return res.status(201).json({
      success: true,
      message: `${transactionType === 'PAY_CARD' ? 'Payment to credit card' : 'Credit card usage'} recorded successfully.`,
      transaction,
      creditCard: card,
    });
  } catch (error) {
    console.error('addCreditCardTransaction error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record card transaction',
    });
  }
};

/**
 * @desc    Reverse an incorrect credit card transaction
 * @route   POST /api/credit-cards/:id/transactions/:transactionId/reverse
 * @access  Private (edit_credit_card or admin)
 */
const reverseCreditCardTransaction = async (req, res) => {
  try {
    const { id, transactionId } = req.params;
    const { reason = 'Transaction reversed by user' } = req.body;

    const card = await CreditCard.findById(id);
    if (!card) {
      return res.status(404).json({ success: false, message: 'Credit card not found' });
    }
    if (card.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const tx = await CreditCardTransaction.findOne({
      _id: transactionId,
      creditCardId: id,
      deletedAt: null,
    });

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (tx.isReversed) {
      return res.status(400).json({ success: false, message: 'Transaction is already reversed' });
    }

    const currentUsed =
      card.usedLimit !== undefined
        ? card.usedLimit
        : Math.max(0, (card.totalLimit || 0) - (card.availableLimit || 0));

    // Reversal logic:
    // If was USE_CARD, subtract from used limit.
    // If was PAY_CARD, re-add to used limit.
    if (tx.transactionType === 'USE_CARD') {
      card.usedLimit = Math.max(0, currentUsed - tx.amount);
    } else {
      card.usedLimit = currentUsed + tx.amount;
    }
    card.availableLimit = Math.max(0, card.totalLimit - card.usedLimit);
    await card.save();

    tx.isReversed = true;
    tx.reversalReason = reason;
    await tx.save();

    return res.status(200).json({
      success: true,
      message: 'Transaction reversed successfully.',
      creditCard: card,
      transaction: tx,
    });
  } catch (error) {
    console.error('reverseCreditCardTransaction error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reverse transaction' });
  }
};

module.exports = {
  createCreditCard,
  getCreditCards,
  getCreditCardSummary,
  getCreditCardById,
  updateCreditCard,
  deleteCreditCard,
  getCreditCardTransactions,
  addCreditCardTransaction,
  reverseCreditCardTransaction,
};

