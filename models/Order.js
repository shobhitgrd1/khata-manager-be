const mongoose = require('mongoose');

const addressSnapshotSchema = new mongoose.Schema(
  {
    addressTitle: { type: String, default: '' },
    completeAddress: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pinCode: { type: String, default: '' },
    country: { type: String, default: 'India' },
  },
  { _id: false }
);

const colorSnapshotSchema = new mongoose.Schema(
  {
    colorName: { type: String, required: true },
    colorCode: { type: String, default: '#36CFFF' },
  },
  { _id: false }
);

const paymentDetailsSchema = new mongoose.Schema(
  {
    bankName: { type: String, default: '' },
    cardName: { type: String, default: '' },
    cardType: { type: String, default: 'Credit Card' },
    lastFourDigits: { type: String, default: '' },
    cardHolderName: { type: String, default: '' },
    upiId: { type: String, default: '' },
    upiOwnerName: { type: String, default: '' },
    otherMethodName: { type: String, default: '' },
    referenceNote: { type: String, default: '' },
  },
  { _id: false }
);

const deliveryPriceAuditSchema = new mongoose.Schema(
  {
    previousPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    previousProfit: { type: Number, required: true },
    newProfit: { type: Number, required: true },
    previousCashbackAmount: { type: Number, default: 0 },
    newCashbackAmount: { type: Number, default: 0 },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: 'Delivery price correction' },
  },
  { _id: false }
);

const orderEditAuditSchema = new mongoose.Schema(
  {
    editedAt: { type: Date, default: Date.now },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    previousValues: { type: mongoose.Schema.Types.Mixed },
    updatedValues: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String, default: 'Order details updated' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalOrderId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    // Dealer
    dealerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dealer',
      required: [true, 'Dealer is required'],
      index: true,
    },
    dealerAddressId: {
      type: String,
      default: '',
    },
    dealerNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    dealerMobileSnapshot: {
      type: String,
      default: '',
    },
    dealerAddressSnapshot: {
      type: addressSnapshotSchema,
      required: true,
    },

    // Product
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product is required'],
      index: true,
    },
    productNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    variant: {
      type: String,
      required: [true, 'Variant is required'],
      trim: true,
    },
    color: {
      type: colorSnapshotSchema,
      required: [true, 'Color is required'],
    },

    // Account
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account is required'],
      index: true,
    },
    accountNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    accountTypeSnapshot: {
      type: String,
      default: '',
    },
    accountMobileSnapshot: {
      type: String,
      default: '',
    },
    accountEmailSnapshot: {
      type: String,
      default: '',
    },

    // Payment
    paymentMethod: {
      type: String,
      enum: ['Credit Card', 'Debit Card', 'UPI', 'Other'],
      required: [true, 'Payment method is required'],
    },
    creditCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditCard',
      default: null,
    },
    payUsingCreditCard: {
      type: Boolean,
      default: false,
    },
    creditCardTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditCardTransaction',
      default: null,
    },
    paymentDetails: {
      type: paymentDetailsSchema,
      default: () => ({}),
    },

    // Pricing & Financials
    purchasePrice: {
      type: Number,
      required: [true, 'Purchase price is required'],
      min: [0, 'Purchase price cannot be negative'],
    },
    deliveryPrice: {
      type: Number,
      default: null,
      min: [0, 'Delivery price cannot be negative'],
    },
    profit: {
      type: Number,
      default: null,
    },
    grossProfit: {
      type: Number,
      default: null,
    },
    profitPercentage: {
      type: Number,
      default: null,
    },
    cashbackApplied: {
      type: Boolean,
      default: false,
    },
    cashbackPercentage: {
      type: Number,
      default: 0,
      min: 0,
    },
    cashbackAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    netProfit: {
      type: Number,
      default: null,
    },

    // Status & Dates
    status: {
      type: String,
      enum: ['Order In Process', 'Delivered', 'Cancelled'],
      default: 'Order In Process',
      index: true,
    },
    orderDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    deliveryDate: {
      type: Date,
      default: null,
    },

    // Audit History
    deliveryPriceHistory: {
      type: [deliveryPriceAuditSchema],
      default: [],
    },
    editHistory: {
      type: [orderEditAuditSchema],
      default: [],
    },

    // Soft deletion support
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

// Virtual for formatted profit/loss display status
orderSchema.virtual('isProfit').get(function () {
  if (this.profit === null || this.profit === undefined) return null;
  return this.profit >= 0;
});

// Indexes for fast querying, filtering, and sorting
orderSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });
orderSchema.index({ userId: 1, status: 1, deletedAt: 1 });
orderSchema.index({ userId: 1, dealerId: 1, deletedAt: 1 });
orderSchema.index({ userId: 1, productId: 1, deletedAt: 1 });
orderSchema.index({ userId: 1, accountId: 1, deletedAt: 1 });

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
