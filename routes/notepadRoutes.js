const express = require('express');
const router = express.Router();
const {
  getNotepadStats,
  getNotes,
  getNoteById,
  createNote,
  updateNote,
  duplicateNote,
  togglePinNote,
  toggleArchiveNote,
  moveToTrash,
  restoreFromTrash,
  deleteNotePermanently,
  emptyTrash,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  getTags,
  createTag,
  updateTag,
  deleteTag,
} = require('../controllers/notepadController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// All notepad routes require authentication
router.use(protect);

// Summary statistics
router.get('/stats', requirePermission('view_notepad', 'notepad'), getNotepadStats);

// Trash management
router.delete('/trash/empty', requirePermission('delete_note', 'notepad'), emptyTrash);

// Notes routes
router
  .route('/notes')
  .get(requirePermission('view_notepad', 'notepad'), getNotes)
  .post(requirePermission('create_note', 'notepad'), createNote);

router
  .route('/notes/:id')
  .get(requirePermission('view_notepad', 'notepad'), getNoteById)
  .put(requirePermission('edit_note', 'notepad'), updateNote)
  .delete(requirePermission('delete_note', 'notepad'), moveToTrash);

// Note action routes
router.post('/notes/:id/duplicate', requirePermission('create_note', 'notepad'), duplicateNote);
router.patch('/notes/:id/pin', requirePermission('pin_notes', 'notepad'), togglePinNote);
router.patch('/notes/:id/archive', requirePermission('archive_notes', 'notepad'), toggleArchiveNote);
router.patch('/notes/:id/restore', requirePermission('delete_note', 'archive_notes', 'notepad'), restoreFromTrash);
router.delete('/notes/:id/permanent', requirePermission('delete_note', 'notepad'), deleteNotePermanently);

// Folders routes
router
  .route('/folders')
  .get(requirePermission('view_notepad', 'notepad'), getFolders)
  .post(requirePermission('manage_folders', 'notepad'), createFolder);

router
  .route('/folders/:id')
  .put(requirePermission('manage_folders', 'notepad'), updateFolder)
  .delete(requirePermission('manage_folders', 'notepad'), deleteFolder);

// Tags routes
router
  .route('/tags')
  .get(requirePermission('view_notepad', 'notepad'), getTags)
  .post(requirePermission('manage_tags', 'notepad'), createTag);

router
  .route('/tags/:id')
  .put(requirePermission('manage_tags', 'notepad'), updateTag)
  .delete(requirePermission('manage_tags', 'notepad'), deleteTag);

module.exports = router;

