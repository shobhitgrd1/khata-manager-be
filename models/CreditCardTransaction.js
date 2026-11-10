const mongoose = require('mongoose');

const creditCardTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    creditCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditCard',
      required: [true, 'Credit Card ID is required'],
      index: true,
    },
    transactionType: {
      type: String,
      enum: ['USE_CARD', 'PAY_CARD'],
      required: [true, 'Transaction type is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Amount must be greater than zero'],
    },
    transactionDate: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
      index: true,
    },
    paymentMode: {
      type: String,
      default: 'Card Swipe',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    referenceType: {
      type: String,
      enum: ['Order', 'Manual', 'Payment', 'Usage', 'Reversal'],
      default: 'Manual',
    },
    referenceId: {
      type: String,
      default: null,
      index: true,
    },
    orderId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    runningUsedLimit: {
      type: Number,
      default: 0,
    },
    runningAvailableLimit: {
      type: Number,
      default: 0,
    },
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversalReason: {
      type: String,
      default: '',
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

creditCardTransactionSchema.index({ creditCardId: 1, transactionDate: -1 });

const CreditCardTransaction = mongoose.model(
  'CreditCardTransaction',
  creditCardTransactionSchema
);

module.exports = CreditCardTransaction;

