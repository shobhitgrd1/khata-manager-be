const CreditCard = require('../models/CreditCard');

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
      cardOwner,
    } = req.body;

    // Field presence validation
    if (!bankName || !cardName || !lastFourDigits || totalLimit === undefined || availableLimit === undefined) {
      return res.status(400).json({
        success: false,
        message: 'All fields (bankName, cardName, lastFourDigits, totalLimit, availableLimit) are required',
      });
    }

    // Number conversions
    const numTotal = Number(totalLimit);
    const numAvailable = Number(availableLimit);

    if (isNaN(numTotal) || numTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Total credit limit must be a positive number greater than zero',
      });
    }

    if (isNaN(numAvailable) || numAvailable < 0) {
      return res.status(400).json({
        success: false,
        message: 'Available credit limit cannot be negative',
      });
    }

    if (numAvailable > numTotal) {
      return res.status(400).json({
        success: false,
        message: 'Available credit limit cannot exceed total credit limit',
      });
    }

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
    let availableCreditLimit = 0;

    for (const card of cards) {
      totalCreditLimit += card.totalLimit || 0;
      availableCreditLimit += card.availableLimit || 0;
    }

    const usedCreditAmount = Math.max(0, totalCreditLimit - availableCreditLimit);
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

    if (availableLimit !== undefined) {
      const numAvailable = Number(availableLimit);
      if (isNaN(numAvailable) || numAvailable < 0) {
        return res.status(400).json({
          success: false,
          message: 'Available credit limit cannot be negative',
        });
      }
      card.availableLimit = numAvailable;
    }

    // Validate that available does not exceed total
    if (card.availableLimit > card.totalLimit) {
      return res.status(400).json({
        success: false,
        message: 'Available credit limit cannot exceed total credit limit',
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

module.exports = {
  createCreditCard,
  getCreditCards,
  getCreditCardSummary,
  getCreditCardById,
  updateCreditCard,
  deleteCreditCard,
};

