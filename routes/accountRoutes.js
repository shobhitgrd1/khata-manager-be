const express = require('express');
const router = express.Router();
const {
  createAccount,
  getAccounts,
  getAccountSummary,
  getAccountById,
  updateAccount,
  deleteAccount,
} = require('../controllers/accountController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

router.use(protect);

router.get('/summary', requirePermission('view_accounts'), getAccountSummary);

router
  .route('/')
  .get(requirePermission('view_accounts'), getAccounts)
  .post(requirePermission('create_account'), createAccount);

router
  .route('/:id')
  .get(requirePermission('view_accounts'), getAccountById)
  .put(requirePermission('edit_account'), updateAccount)
  .delete(requirePermission('delete_account'), deleteAccount);

module.exports = router;
