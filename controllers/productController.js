const mongoose = require('mongoose');
const Product = require('../models/Product');

/**
 * Validate and clean variants array
 */
const validateAndCleanVariants = (variants) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { error: 'At least one product variant is required.' };
  }

  const cleaned = [];
  const seen = new Set();

  for (let i = 0; i < variants.length; i++) {
    const raw = typeof variants[i] === 'string' ? variants[i] : variants[i]?.variantName;
    if (!raw || !raw.trim()) {
      return { error: `Variant #${i + 1} cannot be empty.` };
    }
    const trimmed = raw.trim();
    const lowerKey = trimmed.toLowerCase();
    if (seen.has(lowerKey)) {
      return { error: `Duplicate variant "${trimmed}" detected. Each variant must be unique.` };
    }
    seen.add(lowerKey);
    cleaned.push({ variantName: trimmed });
  }

  return { variants: cleaned };
};

/**
 * Validate and clean colors array
 */
const validateAndCleanColors = (colors) => {
  if (!Array.isArray(colors) || colors.length === 0) {
    return { error: 'At least one product color is required.' };
  }

  const cleaned = [];
  const seen = new Set();

  for (let i = 0; i < colors.length; i++) {
    const item = colors[i];
    const name = typeof item === 'string' ? item : item?.colorName;
    const code = typeof item === 'object' && item?.colorCode ? item.colorCode.trim() : '#36CFFF';

    if (!name || !name.trim()) {
      return { error: `Color #${i + 1} name cannot be empty.` };
    }
    const trimmedName = name.trim();
    const lowerKey = trimmedName.toLowerCase();
    if (seen.has(lowerKey)) {
      return { error: `Duplicate color "${trimmedName}" detected. Each color must be unique.` };
    }
    seen.add(lowerKey);
    cleaned.push({
      colorName: trimmedName,
      colorCode: code || '#36CFFF',
    });
  }

  return { colors: cleaned };
};

/**
 * @desc    Create a new product with variants and colors
 * @route   POST /api/products
 * @access  Private (create_product or admin)
 */
const createProduct = async (req, res) => {
  try {
    const { productName, variants, colors } = req.body || {};

    if (!productName || !productName.trim()) {
      return res.status(400).json({ success: false, message: 'Product name is required.' });
    }

    const trimmedName = productName.trim();

    const variantRes = validateAndCleanVariants(variants);
    if (variantRes.error) {
      return res.status(400).json({ success: false, message: variantRes.error });
    }

    const colorRes = validateAndCleanColors(colors);
    if (colorRes.error) {
      return res.status(400).json({ success: false, message: colorRes.error });
    }

    const product = await Product.create({
      userId: req.user._id,
      productName: trimmedName,
      variants: variantRes.variants,
      colors: colorRes.colors,
      deletedAt: null,
    });

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product,
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while creating product.' });
  }
};

/**
 * @desc    Get all products for the authenticated user (supports search, sort, pagination)
 * @route   GET /api/products
 * @access  Private (view_products or admin)
 */
const getProducts = async (req, res) => {
  try {
    const {
      search,
      color,
      minVariants,
      startDate,
      endDate,
      page = 1,
      limit = 100,
      sort = '-createdAt',
    } = req.query;

    const query = {
      userId: req.user._id,
      deletedAt: null,
    };

    if (req.user.role === 'admin' && req.query.userId) {
      query.userId = req.query.userId;
    }

    if (color && color.trim()) {
      query['colors.colorName'] = { $regex: color.trim(), $options: 'i' };
    }

    if (minVariants !== undefined && minVariants !== '' && !isNaN(Number(minVariants))) {
      query.$expr = { $gte: [{ $size: { $ifNull: ['$variants', []] } }, Number(minVariants)] };
    }

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
      const regex = new RegExp(cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { productName: regex },
        { 'variants.variantName': regex },
        { 'colors.colorName': regex },
        { 'colors.colorCode': regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [products, totalCount] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(limitNum).lean(),
      Product.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      count: products.length,
      totalProducts: totalCount,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
      currentPage: pageNum,
      products,
    });
  } catch (error) {
    console.error('Get products error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching products.' });
  }
};

/**
 * @desc    Get product summary metrics (Total Products, Total Variants, Total Colors)
 * @route   GET /api/products/summary
 * @access  Private (view_products or admin)
 */
const getProductSummary = async (req, res) => {
  try {
    const targetUserId =
      req.user.role === 'admin' && req.query.userId
        ? new mongoose.Types.ObjectId(req.query.userId)
        : new mongoose.Types.ObjectId(req.user._id);

    const [aggregation] = await Product.aggregate([
      { $match: { userId: targetUserId, deletedAt: null } },
      {
        $project: {
          variantCount: { $size: { $ifNull: ['$variants', []] } },
          colorCount: { $size: { $ifNull: ['$colors', []] } },
        },
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalVariants: { $sum: '$variantCount' },
          totalColors: { $sum: '$colorCount' },
        },
      },
    ]);

    const summary = aggregation || {
      totalProducts: 0,
      totalVariants: 0,
      totalColors: 0,
    };

    return res.status(200).json({
      success: true,
      summary: {
        totalProducts: summary.totalProducts || 0,
        totalVariants: summary.totalVariants || 0,
        totalColors: summary.totalColors || 0,
      },
    });
  } catch (error) {
    console.error('Product summary error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching summary.' });
  }
};

/**
 * @desc    Get single product by ID
 * @route   GET /api/products/:id
 * @access  Private (view_products or admin)
 */
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Ownership check: regular user can only access their own product
    if (product.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this product record.',
      });
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error('Get product by ID error:', error);
    return res.status(500).json({ success: false, message: 'Server error while fetching product.' });
  }
};

/**
 * @desc    Update an existing product
 * @route   PUT /api/products/:id
 * @access  Private (edit_product or admin)
 */
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { productName, variants, colors } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Ownership check
    if (product.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only edit your own products.',
      });
    }

    if (productName !== undefined) {
      if (!productName || !productName.trim()) {
        return res.status(400).json({ success: false, message: 'Product name cannot be empty.' });
      }
      product.productName = productName.trim();
    }

    if (variants !== undefined) {
      const variantRes = validateAndCleanVariants(variants);
      if (variantRes.error) {
        return res.status(400).json({ success: false, message: variantRes.error });
      }
      product.variants = variantRes.variants;
    }

    if (colors !== undefined) {
      const colorRes = validateAndCleanColors(colors);
      if (colorRes.error) {
        return res.status(400).json({ success: false, message: colorRes.error });
      }
      product.colors = colorRes.colors;
    }

    await product.save();

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully.',
      product,
    });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages[0] });
    }
    return res.status(500).json({ success: false, message: 'Server error while updating product.' });
  }
};

/**
 * @desc    Delete a product (soft delete to preserve historical order records)
 * @route   DELETE /api/products/:id
 * @access  Private (delete_product or admin)
 */
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Ownership check
    if (product.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own products.',
      });
    }

    // Soft delete to protect existing order histories referencing this product
    product.deletedAt = new Date();
    await product.save();

    return res.status(200).json({
      success: true,
      message: 'Product deleted successfully.',
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({ success: false, message: 'Server error while deleting product.' });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductSummary,
  getProductById,
  updateProduct,
  deleteProduct,
};
