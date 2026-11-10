const mongoose = require('mongoose');
const KhataBook = require('../models/KhataBook');
const KhataTransaction = require('../models/KhataTransaction');
const Dealer = require('../models/Dealer');
const Order = require('../models/Order');

/**
 * Helper to recalculate running balances and totals for a KhataBook account
 */
const recalculateKhataBookBalance = async (khataBookId, session = null) => {
  const khataBook = await KhataBook.findById(khataBookId).session(session);
  if (!khataBook) return null;

  const query = {
    khataBookId,
    deletedAt: null,
  };

  const transactions = await KhataTransaction.find(query)
    .sort({ transactionDate: 1, createdAt: 1 })
    .session(session);

  let running = 0;
  let totalGiven = 0;
  let totalTaken = 0;
  let totalPaymentsReceived = 0;
  let totalPaymentsMade = 0;
  let lastDate = null;

  for (const tx of transactions) {
    let delta = 0;

    if (tx.isReversed) {
      // Reversed transactions do not impact running balance
      delta = 0;
    } else {
      switch (tx.transactionType) {
        case 'MONEY_GIVEN':
          delta = tx.amount;
          totalGiven += tx.amount;
          break;
        case 'MONEY_TAKEN':
          delta = -tx.amount;
          totalTaken += tx.amount;
          break;
        case 'PAYMENT_RECEIVED':
          delta = -tx.amount;
          totalPaymentsReceived += tx.amount;
          break;
        case 'PAYMENT_MADE':
          delta = tx.amount;
          totalPaymentsMade += tx.amount;
          break;
        case 'OPENING_BALANCE':
          if (khataBook.openingBalanceDirection === 'RECEIVE') {
            delta = tx.amount;
            totalGiven += tx.amount;
          } else if (khataBook.openingBalanceDirection === 'PAY') {
            delta = -tx.amount;
            totalTaken += tx.amount;
          }
          break;
        case 'REVERSAL':
          if (tx.reversalDelta !== null && tx.reversalDelta !== undefined) {
            delta = tx.reversalDelta;
            totalGiven = Math.max(0, Math.round((totalGiven + tx.reversalDelta) * 100) / 100);
          } else {
            delta = -tx.amount;
            totalGiven = Math.max(0, Math.round((totalGiven - tx.amount) * 100) / 100);
          }
          break;
        default:
          delta = 0;
      }
    }

    running = Math.round((running + delta) * 100) / 100;
    if (tx.runningBalance !== running) {
      tx.runningBalance = running;
      await tx.save({ session });
    }

    if (!tx.isReversed) {
      lastDate = tx.transactionDate;
    }
  }

  const finalBalance = Math.round((totalGiven - totalTaken - totalPaymentsReceived + totalPaymentsMade) * 100) / 100;

  khataBook.currentBalance = finalBalance;
  khataBook.totalGiven = Math.round(totalGiven * 100) / 100;
  khataBook.totalTaken = Math.round(totalTaken * 100) / 100;
  khataBook.totalPaymentsReceived = Math.round(totalPaymentsReceived * 100) / 100;
  khataBook.totalPaymentsMade = Math.round(totalPaymentsMade * 100) / 100;
  khataBook.lastTransactionDate = lastDate;

  await khataBook.save({ session });
  return khataBook;
};

/**
 * @desc Get all KhataBook accounts for user with search, filters, pagination and top summaries
 * @route GET /api/khatabook
 */
exports.getKhataBooks = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      search,
      accountType,
      balanceFilter,
      minBalance,
      maxBalance,
      status = 'active',
      sort = '-updatedAt',
      page = 1,
      limit = 20,
    } = req.query;

    const query = {
      userId,
      deletedAt: null,
      status: status || 'active',
    };

    if (accountType && ['Dealer', 'Other'].includes(accountType)) {
      query.accountType = accountType;
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [{ name: regex }, { mobileNumber: regex }];
    }

    if (minBalance !== undefined && minBalance !== '' && !isNaN(Number(minBalance))) {
      query.currentBalance = { ...(query.currentBalance || {}), $gte: Number(minBalance) };
    }
    if (maxBalance !== undefined && maxBalance !== '' && !isNaN(Number(maxBalance))) {
      query.currentBalance = { ...(query.currentBalance || {}), $lte: Number(maxBalance) };
    }

    if (balanceFilter === 'toReceive') {
      query.currentBalance = { ...(query.currentBalance || {}), $gt: 0 };
    } else if (balanceFilter === 'toPay') {
      query.currentBalance = { ...(query.currentBalance || {}), $lt: 0 };
    } else if (balanceFilter === 'settled') {
      query.currentBalance = 0;
    }

    // Top Summary calculation for this user - grouped by accountType
    const summaryAgg = await KhataBook.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          deletedAt: null,
          status: 'active',
        },
      },
      {
        $group: {
          _id: '$accountType',
          totalAccounts: { $sum: 1 },
          totalToReceive: {
            $sum: {
              $cond: [{ $gt: ['$currentBalance', 0] }, '$currentBalance', 0],
            },
          },
          totalToPay: {
            $sum: {
              $cond: [{ $lt: ['$currentBalance', 0] }, { $abs: '$currentBalance' }, 0],
            },
          },
        },
      },
    ]);

    const buildSummary = (row) => {
      const receive = Math.round((row?.totalToReceive || 0) * 100) / 100;
      const pay = Math.round((row?.totalToPay || 0) * 100) / 100;
      return {
        totalAccounts: row?.totalAccounts || 0,
        totalToReceive: receive,
        totalToPay: pay,
        netBalance: Math.round((receive - pay) * 100) / 100,
      };
    };

    const dealerRow = summaryAgg.find((s) => s._id === 'Dealer');
    const otherRow = summaryAgg.find((s) => s._id === 'Other');

    const dealerSummary = buildSummary(dealerRow);
    const otherSummary = buildSummary(otherRow);
    const overallSummary = {
      totalAccounts: (dealerSummary.totalAccounts || 0) + (otherSummary.totalAccounts || 0),
      totalToReceive: Math.round(((dealerSummary.totalToReceive || 0) + (otherSummary.totalToReceive || 0)) * 100) / 100,
      totalToPay: Math.round(((dealerSummary.totalToPay || 0) + (otherSummary.totalToPay || 0)) * 100) / 100,
      netBalance: Math.round((((dealerSummary.totalToReceive || 0) + (otherSummary.totalToReceive || 0)) - ((dealerSummary.totalToPay || 0) + (otherSummary.totalToPay || 0))) * 100) / 100,
    };

    const activeSummary = accountType === 'Dealer'
      ? dealerSummary
      : accountType === 'Other'
      ? otherSummary
      : overallSummary;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    let sortObj = {};
    if (sort) {
      const field = sort.startsWith('-') ? sort.slice(1) : sort;
      const direction = sort.startsWith('-') ? -1 : 1;
      sortObj[field] = direction;
    } else {
      sortObj = { updatedAt: -1 };
    }

    const [accounts, total] = await Promise.all([
      KhataBook.find(query)
        .populate('dealerId', 'dealerName mobileNumbers mobileNumber addresses')
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      KhataBook.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      summary: activeSummary,
      dealerSummary,
      otherSummary,
      overallSummary,
      accounts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error('getKhataBooks error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve Khata Book accounts.',
      error: error.message,
    });
  }
};

/**
 * @desc Create new KhataBook account
 * @route POST /api/khatabook
 */
exports.createKhataBook = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      mobileNumber,
      accountType = 'Other',
      dealerId,
      openingBalance = 0,
      openingBalanceDirection = 'NONE',
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required.',
      });
    }

    const parsedOpeningBalance = Number(openingBalance) || 0;
    if (parsedOpeningBalance < 0) {
      return res.status(400).json({
        success: false,
        message: 'Opening balance cannot be negative.',
      });
    }

    let finalDirection = 'NONE';
    if (parsedOpeningBalance > 0) {
      if (!['RECEIVE', 'PAY'].includes(openingBalanceDirection)) {
        return res.status(400).json({
          success: false,
          message: 'Please specify whether you will Receive or Pay the opening balance.',
        });
      }
      finalDirection = openingBalanceDirection;
    }

    // Check if linked dealer already has a KhataBook account
    if (dealerId) {
      const existing = await KhataBook.findOne({
        userId,
        dealerId,
        deletedAt: null,
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `A Khata Book account already exists for this dealer ("${existing.name}").`,
          existingId: existing._id,
        });
      }
    }

    const initialBalance = parsedOpeningBalance > 0
      ? (finalDirection === 'RECEIVE' ? parsedOpeningBalance : -parsedOpeningBalance)
      : 0;

    const khataBook = new KhataBook({
      userId,
      name: name.trim(),
      mobileNumber: mobileNumber ? mobileNumber.trim() : '',
      accountType: accountType === 'Dealer' ? 'Dealer' : 'Other',
      dealerId: dealerId || null,
      openingBalance: parsedOpeningBalance,
      openingBalanceDirection: finalDirection,
      currentBalance: initialBalance,
      totalGiven: finalDirection === 'RECEIVE' ? parsedOpeningBalance : 0,
      totalTaken: finalDirection === 'PAY' ? parsedOpeningBalance : 0,
      lastTransactionDate: parsedOpeningBalance > 0 ? new Date() : null,
    });

    await khataBook.save();

    // If opening balance > 0, create OPENING_BALANCE ledger entry
    if (parsedOpeningBalance > 0) {
      const openingTx = new KhataTransaction({
        userId,
        khataBookId: khataBook._id,
        transactionType: 'OPENING_BALANCE',
        amount: parsedOpeningBalance,
        transactionDate: new Date(),
        paymentMode: 'System/Auto',
        description: `Opening Balance (${finalDirection === 'RECEIVE' ? 'To Receive' : 'To Pay'})`,
        referenceType: 'Opening',
        runningBalance: initialBalance,
      });
      await openingTx.save();
    }

    return res.status(201).json({
      success: true,
      message: 'Khata Book account created successfully.',
      khataBook,
    });
  } catch (error) {
    console.error('createKhataBook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create Khata Book account.',
      error: error.message,
    });
  }
};

/**
 * @desc Get KhataBook account details by ID
 * @route GET /api/khatabook/:id
 */
exports.getKhataBookById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Khata Book ID.',
      });
    }

    // Recalculate to ensure absolute fresh running balance & stats
    await recalculateKhataBookBalance(id);

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    }).populate('dealerId', 'dealerName mobileNumbers mobileNumber addresses');

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      khataBook,
    });
  } catch (error) {
    console.error('getKhataBookById error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve Khata Book details.',
      error: error.message,
    });
  }
};

/**
 * @desc Update KhataBook account details
 * @route PUT /api/khatabook/:id
 */
exports.updateKhataBook = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { name, mobileNumber, accountType } = req.body;

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    if (name && name.trim()) {
      khataBook.name = name.trim();
    }
    if (mobileNumber !== undefined) {
      khataBook.mobileNumber = mobileNumber ? mobileNumber.trim() : '';
    }
    if (accountType && ['Dealer', 'Other'].includes(accountType)) {
      khataBook.accountType = accountType;
    }

    await khataBook.save();

    return res.status(200).json({
      success: true,
      message: 'Account details updated successfully.',
      khataBook,
    });
  } catch (error) {
    console.error('updateKhataBook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update Khata Book account.',
      error: error.message,
    });
  }
};

/**
 * @desc Archive KhataBook account
 * @route DELETE /api/khatabook/:id
 */
exports.archiveKhataBook = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    khataBook.status = 'archived';
    khataBook.deletedAt = new Date();
    await khataBook.save();

    return res.status(200).json({
      success: true,
      message: 'Khata Book account archived successfully.',
    });
  } catch (error) {
    console.error('archiveKhataBook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to archive Khata Book account.',
      error: error.message,
    });
  }
};

/**
 * @desc Get transaction history for a KhataBook account
 * @route GET /api/khatabook/:id/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const {
      search,
      transactionType,
      startDate,
      endDate,
      sort = '-transactionDate -createdAt',
      page = 1,
      limit = 50,
    } = req.query;

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    const query = {
      khataBookId: id,
      deletedAt: null,
    };

    if (transactionType) {
      query.transactionType = transactionType;
    }

    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      query.$or = [{ description: regex }, { paymentMode: regex }];
    }

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) {
        query.transactionDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.transactionDate.$lte = end;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    let sortObj = {};
    if (sort) {
      const parts = sort.split(' ');
      parts.forEach((p) => {
        const field = p.startsWith('-') ? p.slice(1) : p;
        const dir = p.startsWith('-') ? -1 : 1;
        sortObj[field] = dir;
      });
    } else {
      sortObj = { transactionDate: -1, createdAt: -1 };
    }

    const [transactions, total] = await Promise.all([
      KhataTransaction.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      KhataTransaction.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error('getTransactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve transactions.',
      error: error.message,
    });
  }
};

/**
 * @desc Add a Money Given or Money Taken transaction
 * @route POST /api/khatabook/:id/transactions
 */
exports.addTransaction = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const {
      transactionType,
      amount,
      transactionDate = new Date(),
      paymentMode = 'Cash',
      description = '',
    } = req.body;

    if (!['MONEY_GIVEN', 'MONEY_TAKEN'].includes(transactionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction type. Must be MONEY_GIVEN or MONEY_TAKEN.',
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive number greater than 0.',
      });
    }

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    const transaction = new KhataTransaction({
      userId,
      khataBookId: khataBook._id,
      transactionType,
      amount: Math.round(numericAmount * 100) / 100,
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      paymentMode: paymentMode || 'Cash',
      description: description ? description.trim() : '',
      referenceType: 'Manual',
    });

    await transaction.save();

    // Recalculate running balance and totals
    const updatedAccount = await recalculateKhataBookBalance(khataBook._id);

    return res.status(201).json({
      success: true,
      message: `${transactionType === 'MONEY_GIVEN' ? 'Money Given' : 'Money Taken'} recorded successfully.`,
      transaction,
      account: updatedAccount,
    });
  } catch (error) {
    console.error('addTransaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record transaction.',
      error: error.message,
    });
  }
};

/**
 * @desc Record a Payment Received or Payment Made
 * @route POST /api/khatabook/:id/payments
 */
exports.recordPayment = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const {
      paymentType, // 'PAYMENT_RECEIVED' or 'PAYMENT_MADE'
      amount,
      transactionDate = new Date(),
      paymentMode = 'Cash',
      description = '',
      reference = '',
    } = req.body;

    if (!['PAYMENT_RECEIVED', 'PAYMENT_MADE'].includes(paymentType)) {
      return res.status(400).json({
        success: false,
        message: 'Payment type must be PAYMENT_RECEIVED or PAYMENT_MADE.',
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0.',
      });
    }

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    });

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    const currentBalance = khataBook.currentBalance;

    // Strict accounting validation
    if (paymentType === 'PAYMENT_RECEIVED') {
      if (currentBalance <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot receive payment: there is no outstanding receivable balance on this account.',
        });
      }
      if (numericAmount > currentBalance + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Payment amount (₹${numericAmount.toLocaleString('en-IN')}) cannot exceed the outstanding balance of ₹${currentBalance.toLocaleString('en-IN')}.`,
        });
      }
    } else if (paymentType === 'PAYMENT_MADE') {
      if (currentBalance >= 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot make payment: there is no outstanding payable balance on this account.',
        });
      }
      const payableAmount = Math.abs(currentBalance);
      if (numericAmount > payableAmount + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Payment amount (₹${numericAmount.toLocaleString('en-IN')}) cannot exceed the outstanding payable amount of ₹${payableAmount.toLocaleString('en-IN')}.`,
        });
      }
    }

    const fullDesc = [description?.trim(), reference ? `Ref: ${reference.trim()}` : '']
      .filter(Boolean)
      .join(' - ');

    const transaction = new KhataTransaction({
      userId,
      khataBookId: khataBook._id,
      transactionType: paymentType,
      amount: Math.round(numericAmount * 100) / 100,
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      paymentMode: paymentMode || 'Cash',
      description: fullDesc || (paymentType === 'PAYMENT_RECEIVED' ? 'Payment Received' : 'Payment Made'),
      referenceType: 'Manual',
    });

    await transaction.save();

    // Recalculate
    const updatedAccount = await recalculateKhataBookBalance(khataBook._id);

    return res.status(201).json({
      success: true,
      message: `${paymentType === 'PAYMENT_RECEIVED' ? 'Payment Received' : 'Payment Made'} recorded successfully.`,
      transaction,
      account: updatedAccount,
    });
  } catch (error) {
    console.error('recordPayment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record payment.',
      error: error.message,
    });
  }
};

/**
 * @desc Edit an existing transaction with audit history
 * @route PUT /api/khatabook/:id/transactions/:transactionId
 */
exports.updateTransaction = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, transactionId } = req.params;
    const { amount, transactionDate, paymentMode, description, reason = 'Corrected details' } = req.body;

    const transaction = await KhataTransaction.findOne({
      _id: transactionId,
      khataBookId: id,
      userId,
      deletedAt: null,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found.',
      });
    }

    if (transaction.isReversed) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a reversed transaction.',
      });
    }

    if (transaction.referenceType === 'Order') {
      return res.status(400).json({
        success: false,
        message: 'This transaction was automatically linked to an Order delivery. Please correct the Order delivery price directly.',
      });
    }

    const previousValues = {
      amount: transaction.amount,
      transactionDate: transaction.transactionDate,
      paymentMode: transaction.paymentMode,
      description: transaction.description,
    };

    if (amount !== undefined) {
      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than 0.',
        });
      }
      transaction.amount = Math.round(numericAmount * 100) / 100;
    }

    if (transactionDate) {
      transaction.transactionDate = new Date(transactionDate);
    }
    if (paymentMode) {
      transaction.paymentMode = paymentMode;
    }
    if (description !== undefined) {
      transaction.description = description.trim();
    }

    transaction.auditHistory.push({
      editedAt: new Date(),
      editedBy: userId,
      previousValues,
      updatedValues: {
        amount: transaction.amount,
        transactionDate: transaction.transactionDate,
        paymentMode: transaction.paymentMode,
        description: transaction.description,
      },
      reason: reason || 'Transaction updated',
    });

    await transaction.save();

    // Recalculate
    const updatedAccount = await recalculateKhataBookBalance(id);

    return res.status(200).json({
      success: true,
      message: 'Transaction updated successfully.',
      transaction,
      account: updatedAccount,
    });
  } catch (error) {
    console.error('updateTransaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update transaction.',
      error: error.message,
    });
  }
};

/**
 * @desc Reverse an incorrect transaction
 * @route POST /api/khatabook/:id/transactions/:transactionId/reverse
 */
exports.reverseTransaction = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, transactionId } = req.params;
    const { reason = 'Transaction reversed' } = req.body;

    const transaction = await KhataTransaction.findOne({
      _id: transactionId,
      khataBookId: id,
      userId,
      deletedAt: null,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found.',
      });
    }

    if (transaction.isReversed) {
      return res.status(400).json({
        success: false,
        message: 'This transaction has already been reversed.',
      });
    }

    transaction.isReversed = true;
    transaction.reversalReason = reason || 'Reversed by user';
    await transaction.save();

    // Create an explicit audit REVERSAL entry
    const reversalTx = new KhataTransaction({
      userId,
      khataBookId: id,
      transactionType: 'REVERSAL',
      amount: transaction.amount,
      transactionDate: new Date(),
      paymentMode: 'System/Auto',
      description: `Reversal of ${transaction.transactionType} (₹${transaction.amount}): ${reason}`,
      referenceType: 'Reversal',
      reversalOfTransactionId: transaction._id,
      isReversed: true, // Note: reversal entry is purely an audit marker
    });
    await reversalTx.save();

    // Recalculate balances
    const updatedAccount = await recalculateKhataBookBalance(id);

    return res.status(200).json({
      success: true,
      message: 'Transaction reversed successfully.',
      account: updatedAccount,
    });
  } catch (error) {
    console.error('reverseTransaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reverse transaction.',
      error: error.message,
    });
  }
};

/**
 * @desc Find linked KhataBook account by Dealer ID
 * @route GET /api/khatabook/by-dealer/:dealerId
 */
exports.getKhataBookByDealerId = async (req, res) => {
  try {
    const userId = req.user._id;
    const { dealerId } = req.params;

    const khataBook = await KhataBook.findOne({
      userId,
      dealerId,
      deletedAt: null,
    }).lean();

    return res.status(200).json({
      success: true,
      exists: Boolean(khataBook),
      khataBook: khataBook || null,
    });
  } catch (error) {
    console.error('getKhataBookByDealerId error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check linked Khata Book account.',
      error: error.message,
    });
  }
};

/**
 * @desc Get complete statement for an account
 * @route GET /api/khatabook/:id/statement
 */
exports.getStatement = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const khataBook = await KhataBook.findOne({
      _id: id,
      userId,
      deletedAt: null,
    }).populate('dealerId', 'dealerName mobileNumbers mobileNumber addresses');

    if (!khataBook) {
      return res.status(404).json({
        success: false,
        message: 'Khata Book account not found.',
      });
    }

    const txQuery = {
      khataBookId: id,
      deletedAt: null,
    };

    if (startDate || endDate) {
      txQuery.transactionDate = {};
      if (startDate) txQuery.transactionDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txQuery.transactionDate.$lte = end;
      }
    }

    const transactions = await KhataTransaction.find(txQuery)
      .sort({ transactionDate: 1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      account: khataBook,
      statement: {
        accountName: khataBook.name,
        mobileNumber: khataBook.mobileNumber,
        accountType: khataBook.accountType,
        openingBalance: khataBook.openingBalance,
        openingBalanceDirection: khataBook.openingBalanceDirection,
        currentBalance: khataBook.currentBalance,
        totalGiven: khataBook.totalGiven,
        totalTaken: khataBook.totalTaken,
        totalPaymentsReceived: khataBook.totalPaymentsReceived,
        totalPaymentsMade: khataBook.totalPaymentsMade,
        statementDate: new Date(),
        filterRange: { startDate: startDate || null, endDate: endDate || null },
      },
      transactions,
    });
  } catch (error) {
    console.error('getStatement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate account statement.',
      error: error.message,
    });
  }
};

// Export recalculate function for use in order delivery integration
exports.recalculateKhataBookBalance = recalculateKhataBookBalance;

