const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrders,
  getOrderSummary,
  getOrderPerformance,
  getOrderById,
  updateOrder,
  deliverOrder,
  correctDeliveryPrice,
  deleteOrder,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(protect);

router.get('/summary', requirePermission('view_orders'), getOrderSummary);
router.get('/performance', requirePermission('view_orders'), getOrderPerformance);

router
  .route('/')
  .get(requirePermission('view_orders'), getOrders)
  .post(requirePermission('create_order'), createOrder);

router
  .route('/:id')
  .get(requirePermission('view_orders'), getOrderById)
  .put(requirePermission('edit_order'), updateOrder)
  .delete(requirePermission('delete_order'), deleteOrder);

router.patch('/:id/deliver', requirePermission('edit_order'), deliverOrder);
router.patch('/:id/delivery-price', requirePermission('edit_order'), correctDeliveryPrice);

module.exports = router;

