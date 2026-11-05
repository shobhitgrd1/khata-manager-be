const express = require('express');
const router = express.Router();
const {
  createDealer,
  getDealers,
  getDealerSummary,
  getDealerById,
  updateDealer,
  deleteDealer,
} = require('../controllers/dealerController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(protect);

router.get('/summary', requirePermission('view_dealers'), getDealerSummary);

router
  .route('/')
  .get(requirePermission('view_dealers'), getDealers)
  .post(requirePermission('create_dealer'), createDealer);

router
  .route('/:id')
  .get(requirePermission('view_dealers'), getDealerById)
  .put(requirePermission('edit_dealer'), updateDealer)
  .delete(requirePermission('delete_dealer'), deleteDealer);

module.exports = router;

