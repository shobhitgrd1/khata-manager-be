const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUserStats,
  getUserById,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/permissionMiddleware');

// All routes are protected
router.use(protect);

// Stats for dashboard
router.get('/stats', getUserStats);

// List users: strictly requires Admin role and 'user' or 'view_user' permission
router.get('/', requireRole('admin'), requirePermission('user', 'view_user'), getUsers);

// Get user details
router.get('/:id', getUserById);

// Update user details
router.put('/:id', updateUser);

// Delete user: strictly requires Admin role and 'delete_user' permission
router.delete('/:id', requireRole('admin'), requirePermission('delete_user'), deleteUser);

module.exports = router;

