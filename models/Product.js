const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema(
  {
    variantName: {
      type: String,
      required: [true, 'Variant name is required'],
      trim: true,
      maxlength: [100, 'Variant name cannot exceed 100 characters'],
    },
  },
  { _id: false }
);

const colorSchema = new mongoose.Schema(
  {
    colorName: {
      type: String,
      required: [true, 'Color name is required'],
      trim: true,
      maxlength: [50, 'Color name cannot exceed 50 characters'],
    },
    colorCode: {
      type: String,
      trim: true,
      default: '#36CFFF',
      maxlength: [20, 'Color code cannot exceed 20 characters'],
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [150, 'Product name cannot exceed 150 characters'],
    },
    variants: {
      type: [variantSchema],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'A product must have at least one variant.',
      },
    },
    colors: {
      type: [colorSchema],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'A product must have at least one color.',
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

// Virtuals for quick count references
productSchema.virtual('totalVariants').get(function () {
  return Array.isArray(this.variants) ? this.variants.length : 0;
});

productSchema.virtual('totalColors').get(function () {
  return Array.isArray(this.colors) ? this.colors.length : 0;
});

// Compound indexes for user-isolated queries and fast search
productSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });
productSchema.index({ userId: 1, deletedAt: 1, productName: 1 });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
