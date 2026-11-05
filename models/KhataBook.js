const mongoose = require('mongoose');

const khataBookSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },
    mobileNumber: {
      type: String,
      trim: true,
      default: '',
    },
    accountType: {
      type: String,
      enum: ['Dealer', 'Other'],
      default: 'Other',
      index: true,
    },
    dealerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dealer',
      default: null,
      index: true,
    },
    openingBalance: {
      type: Number,
      default: 0,
      min: [0, 'Opening balance cannot be negative'],
    },
    openingBalanceDirection: {
      type: String,
      enum: ['RECEIVE', 'PAY', 'NONE'],
      default: 'NONE',
    },
    currentBalance: {
      type: Number,
      default: 0,
    },
    totalGiven: {
      type: Number,
      default: 0,
    },
    totalTaken: {
      type: Number,
      default: 0,
    },
    totalPaymentsReceived: {
      type: Number,
      default: 0,
    },
    totalPaymentsMade: {
      type: Number,
      default: 0,
    },
    lastTransactionDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
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

khataBookSchema.index({ userId: 1, deletedAt: 1, status: 1 });
khataBookSchema.index({ userId: 1, dealerId: 1 }, { sparse: true });
khataBookSchema.index({ userId: 1, name: 'text', mobileNumber: 'text' });

module.exports = mongoose.model('KhataBook', khataBookSchema);

