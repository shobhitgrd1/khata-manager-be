const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    addressTitle: {
      type: String,
      required: [true, 'Address title is required (e.g., Shop, Warehouse, Office)'],
      trim: true,
      maxlength: [100, 'Address title cannot exceed 100 characters'],
    },
    completeAddress: {
      type: String,
      required: [true, 'Complete address is required'],
      trim: true,
      maxlength: [300, 'Complete address cannot exceed 300 characters'],
    },
    city: {
      type: String,
      trim: true,
      maxlength: [100, 'City cannot exceed 100 characters'],
      default: '',
    },
    state: {
      type: String,
      trim: true,
      maxlength: [100, 'State cannot exceed 100 characters'],
      default: '',
    },
    pinCode: {
      type: String,
      trim: true,
      maxlength: [20, 'PIN code cannot exceed 20 characters'],
      default: '',
    },
    country: {
      type: String,
      trim: true,
      maxlength: [100, 'Country cannot exceed 100 characters'],
      default: 'India',
    },
  },
  { _id: true }
);

const dealerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    dealerName: {
      type: String,
      required: [true, 'Dealer name is required'],
      trim: true,
      maxlength: [120, 'Dealer name cannot exceed 120 characters'],
    },
    // Primary mobile number (maintained for 100% backward compatibility)
    mobileNumber: {
      type: String,
      required: [true, 'Primary mobile number is required'],
      trim: true,
      match: [/^[+]?[\d\s\-().]{7,20}$/, 'Please provide a valid mobile number'],
    },
    // Multiple mobile numbers support
    mobileNumbers: {
      type: [String],
      default: [],
    },
    addresses: {
      type: [addressSchema],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'A dealer must have at least one address.',
      },
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: total address count
dealerSchema.virtual('totalAddresses').get(function () {
  return Array.isArray(this.addresses) ? this.addresses.length : 0;
});

// Pre-save hook: ensure mobileNumber and mobileNumbers array stay perfectly synchronized
dealerSchema.pre('save', function (next) {
  if (Array.isArray(this.mobileNumbers) && this.mobileNumbers.length > 0) {
    // Clean and deduplicate mobile numbers
    const cleaned = [];
    const seen = new Set();
    for (const num of this.mobileNumbers) {
      if (typeof num === 'string') {
        const trimmed = num.trim();
        const normalized = trimmed.replace(/\s+/g, '');
        if (trimmed && !seen.has(normalized)) {
          seen.add(normalized);
          cleaned.push(trimmed);
        }
      }
    }
    this.mobileNumbers = cleaned;
    if (this.mobileNumbers.length > 0) {
      this.mobileNumber = this.mobileNumbers[0];
    }
  } else if (this.mobileNumber) {
    this.mobileNumbers = [this.mobileNumber.trim()];
  }
  if (typeof next === 'function') {
    next();
  }
});

// Indexes for search and query performance
dealerSchema.index({ userId: 1, deletedAt: 1, dealerName: 1 });
dealerSchema.index({ userId: 1, deletedAt: 1, mobileNumber: 1 });
dealerSchema.index({ userId: 1, deletedAt: 1, mobileNumbers: 1 });

module.exports = mongoose.model('Dealer', dealerSchema);
