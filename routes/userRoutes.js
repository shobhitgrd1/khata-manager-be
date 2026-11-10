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

// All user management routes strictly require authentication and Admin role
router.use(protect);
router.use(requireRole('admin'));

// Stats for dashboard
router.get('/stats', getUserStats);

// List users and create new user
router.get('/', getUsers);
router.post('/', createUser);

// Get user details
router.get('/:id', getUserById);

// Update user details
router.put('/:id', updateUser);

// Delete user
router.delete('/:id', deleteUser);

module.exports = router;

