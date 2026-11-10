const mongoose = require('mongoose');

const creditCardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    cardOwner: {
      type: String,
      trim: true,
      maxlength: [80, 'Card owner name cannot exceed 80 characters'],
      default: '',
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
      enum: {
        values: [
          'ICICI Bank',
          'Axis Bank',
          'Kotak Mahindra Bank',
          'RBL Bank',
          'AU Bank',
          'AU Small Finance Bank',
          'HSBC Bank',
          'State Bank of India (SBI)',
          'Yes Bank',
          'HDFC Bank',
          'Bank of Baroda',
        ],
        message: '{VALUE} is not a supported bank',
      },
    },
    cardName: {
      type: String,
      required: [true, 'Credit card name is required'],
      trim: true,
      maxlength: [80, 'Card name cannot exceed 80 characters'],
    },
    cardType: {
      type: String,
      trim: true,
      default: 'Credit Card',
      maxlength: [50, 'Card type cannot exceed 50 characters'],
    },
    lastFourDigits: {
      type: String,
      required: [true, 'Last four digits are required'],
      trim: true,
      minlength: [4, 'Last four digits must be exactly 4 digits'],
      maxlength: [4, 'Last four digits must be exactly 4 digits'],
      match: [/^\d{4}$/, 'Last four digits must contain only numbers'],
    },
    totalLimit: {
      type: Number,
      required: [true, 'Total credit limit is required'],
      min: [1, 'Total credit limit must be greater than zero'],
    },
    usedLimit: {
      type: Number,
      default: 0,
      min: [0, 'Used credit limit cannot be negative'],
    },
    availableLimit: {
      type: Number,
      default: function () {
        return Math.max(0, (this.totalLimit || 0) - (this.usedLimit || 0));
      },
      min: [0, 'Available credit limit cannot be negative'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for remaining credit limit: Remaining = Total Limit - Used Limit
creditCardSchema.virtual('remainingLimit').get(function () {
  return Math.max(0, (this.totalLimit || 0) - (this.usedLimit || 0));
});

// Virtual for utilization percentage: (Used Credit / Total Limit) * 100
creditCardSchema.virtual('utilizationPercentage').get(function () {
  if (!this.totalLimit || this.totalLimit <= 0) return 0;
  const used = this.usedLimit || 0;
  return Math.min(100, Math.round((used / this.totalLimit) * 100));
});

// Pre-save validation: Keep usedLimit and availableLimit synchronized
creditCardSchema.pre('validate', function () {
  if (this.totalLimit !== undefined) {
    if (this.usedLimit === undefined && this.availableLimit !== undefined) {
      this.usedLimit = Math.max(0, this.totalLimit - this.availableLimit);
    } else if (this.usedLimit !== undefined) {
      this.availableLimit = Math.max(0, this.totalLimit - this.usedLimit);
    }
  }
});

const CreditCard = mongoose.model('CreditCard', creditCardSchema);

module.exports = CreditCard;

