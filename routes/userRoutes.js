const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissionMiddleware');

// All user management routes require authentication
router.use(protect);

// Administrative User Management routes (strictly Admin only)
router.get('/stats', requireRole('admin'), getUserStats);
router.get('/', requireRole('admin'), getUsers);
router.post('/', requireRole('admin'), createUser);
router.delete('/:id', requireRole('admin'), deleteUser);

// User Profile / Details routes:
// Admins can view/edit any user; Standard Users can view/edit their own profile
router.get('/:id', getUserById);
router.put('/:id', updateUser);

module.exports = router;

