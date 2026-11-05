const express = require('express');
const router = express.Router();
const {
  createProduct,
  getProducts,
  getProductSummary,
  getProductById,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(protect);

router.get('/summary', requirePermission('view_products'), getProductSummary);

router
  .route('/')
  .get(requirePermission('view_products'), getProducts)
  .post(requirePermission('create_product'), createProduct);

router
  .route('/:id')
  .get(requirePermission('view_products'), getProductById)
  .put(requirePermission('edit_product'), updateProduct)
  .delete(requirePermission('delete_product'), deleteProduct);

module.exports = router;

