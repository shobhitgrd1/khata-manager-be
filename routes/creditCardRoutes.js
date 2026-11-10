const express = require('express');
const router = express.Router();
const {
  createCreditCard,
  getCreditCards,
  getCreditCardSummary,
  getCreditCardById,
  updateCreditCard,
  deleteCreditCard,
  getCreditCardTransactions,
  addCreditCardTransaction,
  reverseCreditCardTransaction,
} = require('../controllers/creditCardController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All credit card endpoints require authentication
router.use(protect);

// Summary statistics endpoint
router.get('/summary', requirePermission('view_credit_cards'), getCreditCardSummary);

// Collection routes
router
  .route('/')
  .get(requirePermission('view_credit_cards'), getCreditCards)
  .post(requirePermission('create_credit_card'), createCreditCard);

// Transaction routes for a specific credit card
router
  .route('/:id/transactions')
  .get(requirePermission('view_credit_cards'), getCreditCardTransactions)
  .post(requirePermission('edit_credit_card'), addCreditCardTransaction);

router.post(
  '/:id/transactions/:transactionId/reverse',
  requirePermission('edit_credit_card'),
  reverseCreditCardTransaction
);

// Item routes
router
  .route('/:id')
  .get(requirePermission('view_credit_cards'), getCreditCardById)
  .put(requirePermission('edit_credit_card'), updateCreditCard)
  .delete(requirePermission('delete_credit_card'), deleteCreditCard);

module.exports = router;

