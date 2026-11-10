const mongoose = require('mongoose');

const transactionAuditSchema = new mongoose.Schema(
  {
    editedAt: { type: Date, default: Date.now },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    previousValues: { type: mongoose.Schema.Types.Mixed },
    updatedValues: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String, default: 'Transaction edited' },
  },
  { _id: false }
);

const khataTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    khataBookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KhataBook',
      required: [true, 'Khata Book ID is required'],
      index: true,
    },
    transactionType: {
      type: String,
      enum: [
        'MONEY_GIVEN',      // +balance (user lent/gave -> receivable increases)
        'MONEY_TAKEN',      // -balance (user borrowed/took -> payable increases)
        'PAYMENT_RECEIVED', // -balance (settlement received -> receivable decreases)
        'PAYMENT_MADE',     // +balance (settlement paid -> payable decreases towards 0)
        'OPENING_BALANCE',  // initial balance
        'REVERSAL',         // reversal of an invalid/canceled transaction
      ],
      required: [true, 'Transaction type is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Amount must be greater than 0'],
    },
    transactionDate: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other', 'System/Auto', 'Online Order'],
      default: 'Cash',
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    referenceType: {
      type: String,
      enum: ['Order', 'Dealer', 'Manual', 'Reversal', 'Opening'],
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
    runningBalance: {
      type: Number,
      default: 0,
    },
    reversalOfTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KhataTransaction',
      default: null,
    },
    reversalDelta: {
      type: Number,
      default: null,
    },
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversalReason: {
      type: String,
      default: '',
    },
    auditHistory: [transactionAuditSchema],
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

khataTransactionSchema.index({ khataBookId: 1, deletedAt: 1, transactionDate: 1, createdAt: 1 });
khataTransactionSchema.index({ referenceType: 1, referenceId: 1 }, { sparse: true });

module.exports = mongoose.model('KhataTransaction', khataTransactionSchema);

