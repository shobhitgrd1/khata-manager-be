const express = require('express');
const router = express.Router();
const {
  getKhataBooks,
  createKhataBook,
  getKhataBookById,
  updateKhataBook,
  archiveKhataBook,
  getTransactions,
  addTransaction,
  recordPayment,
  updateTransaction,
  reverseTransaction,
  getKhataBookByDealerId,
  getStatement,
} = require('../controllers/khataBookController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Helper check by dealer
router.get('/by-dealer/:dealerId', getKhataBookByDealerId);

// Core CRUD
router
  .route('/')
  .get(getKhataBooks)
  .post(createKhataBook);

router
  .route('/:id')
  .get(getKhataBookById)
  .put(updateKhataBook)
  .delete(archiveKhataBook);

// Statement
router.get('/:id/statement', getStatement);

// Transactions
router
  .route('/:id/transactions')
  .get(getTransactions)
  .post(addTransaction);

router.post('/:id/payments', recordPayment);

router.put('/:id/transactions/:transactionId', updateTransaction);
router.post('/:id/transactions/:transactionId/reverse', reverseTransaction);

module.exports = router;

