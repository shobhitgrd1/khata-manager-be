const mongoose = require('mongoose');

const ACCOUNT_TYPES = [
  'Flipkart', 'Amazon', 'Meesho', 'Myntra', 'OnePlus Store', 'Oppo Store',
  'Realme Store', 'Samsung Store', 'Vivo Store', 'Instamart', 'Blinkit',
  'Zepto', 'Croma', 'Croma Store', 'Nio', 'Other'
];

const accountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    accountType: {
      type: String,
      required: [true, 'Account type is required'],
      trim: true,
      enum: { values: ACCOUNT_TYPES, message: '{VALUE} is not a supported account type' },
    },
    customAccountType: {
      type: String,
      trim: true,
      maxlength: [80, 'Custom account name cannot exceed 80 characters'],
      default: null,
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters'],
    },
    mobileNumber: {
      type: String,
      trim: true,
      default: null,
      match: [/^[+]?[\d\s\-().]{7,15}$/, 'Please provide a valid mobile number'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address'],
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual: effective display name (custom overrides preset when type is Other)
accountSchema.virtual('displayType').get(function () {
  return this.accountType === 'Other' && this.customAccountType
    ? this.customAccountType
    : this.accountType;
});

// Index for searching
accountSchema.index({ userId: 1, accountType: 1 });
accountSchema.index({ userId: 1, fullName: 'text', email: 'text', mobileNumber: 'text' });

module.exports = mongoose.model('Account', accountSchema);
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES;
