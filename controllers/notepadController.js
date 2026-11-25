const Note = require('../models/Note');
const NoteFolder = require('../models/NoteFolder');
const NoteTag = require('../models/NoteTag');

/**
 * Helper to compute checklist stats from embedded checklist array
 */
const computeChecklistStats = (checklist = []) => {
  if (!Array.isArray(checklist) || checklist.length === 0) {
    return { total: 0, completed: 0 };
  }
  const total = checklist.length;
  const completed = checklist.filter((item) => Boolean(item.completed)).length;
  return { total, completed };
};

/**
 * @desc    Get summary statistics for logged-in user
 * @route   GET /api/notepad/stats
 * @access  Private
 */
const getNotepadStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const [totalNotes, pinnedNotes, todoNotes, archivedNotes, trashNotes, recentNotes] =
      await Promise.all([
        Note.countDocuments({ userId, isDeleted: false, isArchived: false }),
        Note.countDocuments({ userId, isDeleted: false, isArchived: false, isPinned: true }),
        Note.countDocuments({
          userId,
          isDeleted: false,
          isArchived: false,
          $or: [
            { 'checklistStats.total': { $gt: 0 } },
            { 'checklist.0': { $exists: true } },
            { plainText: /\[[ xX]\]/ },
          ],
        }),
        Note.countDocuments({ userId, isDeleted: false, isArchived: true }),
        Note.countDocuments({ userId, isDeleted: true }),
        Note.countDocuments({
          userId,
          isDeleted: false,
          isArchived: false,
          updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
      ]);

    return res.status(200).json({
      success: true,
      stats: {
        totalNotes,
        pinnedNotes,
        todoNotes,
        recentNotes,
        archivedNotes,
        trashNotes,
      },
    });
  } catch (error) {
    console.error('getNotepadStats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve notepad statistics',
    });
  }
};

/**
 * @desc    Get all notes with filters, search, sorting and folder population
 * @route   GET /api/notepad/notes
 * @access  Private
 */
const getNotes = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      filter = 'all', // 'all' | 'pinned' | 'recent' | 'todos' | 'archived' | 'trash'
      folderId,
      tag,
      search = '',
      sort = 'updated_desc',
    } = req.query;

    const query = { userId };

    // Apply base view filter
    switch (filter) {
      case 'trash':
        query.isDeleted = true;
        break;
      case 'archived':
        query.isDeleted = false;
        query.isArchived = true;
        break;
      case 'pinned':
        query.isDeleted = false;
        query.isArchived = false;
        query.isPinned = true;
        break;
      case 'recent':
        query.isDeleted = false;
        query.isArchived = false;
        break;
      case 'todos':
        query.isDeleted = false;
        query.isArchived = false;
        query.$or = [
          { 'checklistStats.total': { $gt: 0 } },
          { 'checklist.0': { $exists: true } },
          { plainText: /\[[ xX]\]/ },
        ];
        break;
      case 'all':
      default:
        query.isDeleted = false;
        query.isArchived = false;
        break;
    }

    // Specific Folder filter
    if (folderId) {
      if (folderId === 'unfiled') {
        query.folderId = null;
      } else {
        query.folderId = folderId;
      }
    }

    // Specific Tag filter
    if (tag && tag.trim()) {
      query.tags = tag.trim();
    }

    // Search filter across title, content, tags
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      const searchConditions = [
        { title: searchRegex },
        { plainText: searchRegex },
        { tags: searchRegex },
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    // Sorting
    let sortObj = { isPinned: -1, updatedAt: -1 };
    switch (sort) {
      case 'updated_asc':
        sortObj = { updatedAt: 1 };
        break;
      case 'created_desc':
        sortObj = { createdAt: -1 };
        break;
      case 'created_asc':
        sortObj = { createdAt: 1 };
        break;
      case 'title_asc':
        sortObj = { title: 1 };
        break;
      case 'title_desc':
        sortObj = { title: -1 };
        break;
      case 'updated_desc':
      default:
        // In default views, pinned notes float to top unless sorting specifically by other criteria
        sortObj = filter === 'trash' || filter === 'archived'
          ? { updatedAt: -1 }
          : { isPinned: -1, updatedAt: -1 };
        break;
    }

    const notes = await Note.find(query)
      .populate('folderId', 'name color')
      .sort(sortObj)
      .lean();

    return res.status(200).json({
      success: true,
      count: notes.length,
      notes,
    });
  } catch (error) {
    console.error('getNotes error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve notes',
    });
  }
};

/**
 * @desc    Get single note by ID
 * @route   GET /api/notepad/notes/:id
 * @access  Private
 */
const getNoteById = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id })
      .populate('folderId', 'name color');

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found or unauthorized',
      });
    }

    return res.status(200).json({
      success: true,
      note,
    });
  } catch (error) {
    console.error('getNoteById error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve note',
    });
  }
};

/**
 * @desc    Create a new note
 * @route   POST /api/notepad/notes
 * @access  Private
 */
const createNote = async (req, res) => {
  try {
    const {
      title,
      content,
      htmlContent,
      plainText,
      folderId,
      tags,
      coverColor,
      isPinned,
      isArchived,
      checklist,
    } = req.body;

    const checklistStats = computeChecklistStats(checklist);

    // Verify folder belongs to user if provided
    let verifiedFolderId = null;
    if (folderId) {
      const folder = await NoteFolder.findOne({ _id: folderId, userId: req.user._id });
      if (folder) verifiedFolderId = folder._id;
    }

    const note = await Note.create({
      userId: req.user._id,
      title: title && title.trim() ? title.trim() : 'Untitled Note',
      content: content || { type: 'doc', content: [] },
      htmlContent: htmlContent || '',
      plainText: plainText || '',
      folderId: verifiedFolderId,
      tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
      coverColor: coverColor || '',
      isPinned: Boolean(isPinned),
      isArchived: Boolean(isArchived),
      checklist: Array.isArray(checklist) ? checklist : [],
      checklistStats,
    });

    const populated = await Note.findById(note._id).populate('folderId', 'name color');

    return res.status(201).json({
      success: true,
      message: 'Note created successfully',
      note: populated,
    });
  } catch (error) {
    console.error('createNote error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create note',
    });
  }
};

/**
 * @desc    Update an existing note (used for autosave and manual save)
 * @route   PUT /api/notepad/notes/:id
 * @access  Private
 */
const updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found or unauthorized',
      });
    }

    const {
      title,
      content,
      htmlContent,
      plainText,
      folderId,
      tags,
      coverColor,
      isPinned,
      isArchived,
      checklist,
    } = req.body;

    if (title !== undefined) {
      note.title = title && title.trim() ? title.trim() : 'Untitled Note';
    }
    if (content !== undefined) note.content = content;
    if (htmlContent !== undefined) note.htmlContent = htmlContent;
    if (plainText !== undefined) note.plainText = plainText;

    if (folderId !== undefined) {
      if (!folderId || folderId === 'unfiled') {
        note.folderId = null;
      } else {
        const folder = await NoteFolder.findOne({ _id: folderId, userId: req.user._id });
        if (folder) note.folderId = folder._id;
      }
    }

    if (tags !== undefined && Array.isArray(tags)) {
      note.tags = tags.map((t) => String(t).trim()).filter(Boolean);
    }

    if (coverColor !== undefined) note.coverColor = coverColor;
    if (isPinned !== undefined) note.isPinned = Boolean(isPinned);
    if (isArchived !== undefined) {
      note.isArchived = Boolean(isArchived);
      if (note.isArchived) note.isPinned = false;
    }

    if (checklist !== undefined && Array.isArray(checklist)) {
      note.checklist = checklist;
      note.checklistStats = computeChecklistStats(checklist);
    } else if (checklist === undefined && note.checklist) {
      // Re-verify checklist stats if unchanged
      note.checklistStats = computeChecklistStats(note.checklist);
    }

    await note.save();

    const populated = await Note.findById(note._id).populate('folderId', 'name color');

    return res.status(200).json({
      success: true,
      message: 'Note updated successfully',
      note: populated,
    });
  } catch (error) {
    console.error('updateNote error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update note',
    });
  }
};

/**
 * @desc    Duplicate a note
 * @route   POST /api/notepad/notes/:id/duplicate
 * @access  Private
 */
const duplicateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const original = await Note.findOne({ _id: id, userId: req.user._id });

    if (!original) {
      return res.status(404).json({
        success: false,
        message: 'Note not found',
      });
    }

    const duplicate = await Note.create({
      userId: req.user._id,
      title: `${original.title} (Copy)`,
      content: original.content,
      htmlContent: original.htmlContent,
      plainText: original.plainText,
      folderId: original.folderId,
      tags: original.tags,
      coverColor: original.coverColor,
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      checklist: original.checklist,
      checklistStats: original.checklistStats,
    });

    const populated = await Note.findById(duplicate._id).populate('folderId', 'name color');

    return res.status(201).json({
      success: true,
      message: 'Note duplicated successfully',
      note: populated,
    });
  } catch (error) {
    console.error('duplicateNote error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to duplicate note',
    });
  }
};

/**
 * @desc    Toggle pin status of note
 * @route   PATCH /api/notepad/notes/:id/pin
 * @access  Private
 */
const togglePinNote = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found',
      });
    }

    note.isPinned = !note.isPinned;
    await note.save();

    return res.status(200).json({
      success: true,
      message: note.isPinned ? 'Note pinned' : 'Note unpinned',
      isPinned: note.isPinned,
      note,
    });
  } catch (error) {
    console.error('togglePinNote error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to toggle pin status',
    });
  }
};

/**
 * @desc    Toggle archive status of note
 * @route   PATCH /api/notepad/notes/:id/archive
 * @access  Private
 */
const toggleArchiveNote = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found',
      });
    }

    note.isArchived = !note.isArchived;
    if (note.isArchived) {
      note.isPinned = false;
    }
    await note.save();

    return res.status(200).json({
      success: true,
      message: note.isArchived ? 'Note archived' : 'Note unarchived',
      isArchived: note.isArchived,
      note,
    });
  } catch (error) {
    console.error('toggleArchiveNote error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to toggle archive status',
    });
  }
};

/**
 * @desc    Move note to trash (soft delete)
 * @route   DELETE /api/notepad/notes/:id
 * @access  Private
 */
const moveToTrash = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found',
      });
    }

    note.isDeleted = true;
    note.deletedAt = new Date();
    note.isPinned = false;
    await note.save();

    return res.status(200).json({
      success: true,
      message: 'Note moved to trash',
    });
  } catch (error) {
    console.error('moveToTrash error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete note',
    });
  }
};

/**
 * @desc    Restore note from trash
 * @route   PATCH /api/notepad/notes/:id/restore
 * @access  Private
 */
const restoreFromTrash = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOne({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found',
      });
    }

    note.isDeleted = false;
    note.deletedAt = null;
    await note.save();

    return res.status(200).json({
      success: true,
      message: 'Note restored from trash',
      note,
    });
  } catch (error) {
    console.error('restoreFromTrash error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restore note',
    });
  }
};

/**
 * @desc    Permanently delete a note
 * @route   DELETE /api/notepad/notes/:id/permanent
 * @access  Private
 */
const deleteNotePermanently = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findOneAndDelete({ _id: id, userId: req.user._id });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Note not found or already deleted',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Note permanently deleted',
    });
  } catch (error) {
    console.error('deleteNotePermanently error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete note permanently',
    });
  }
};

/**
 * @desc    Empty trash (permanently delete all trashed notes for user)
 * @route   DELETE /api/notepad/trash/empty
 * @access  Private
 */
const emptyTrash = async (req, res) => {
  try {
    const result = await Note.deleteMany({ userId: req.user._id, isDeleted: true });

    return res.status(200).json({
      success: true,
      message: `Trash emptied (${result.deletedCount} notes deleted)`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('emptyTrash error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to empty trash',
    });
  }
};

// ─────────────────────────────────────────────────────────────
// FOLDERS MANAGEMENT
// ─────────────────────────────────────────────────────────────

/**
 * @desc    Get all folders for logged-in user with note counts
 * @route   GET /api/notepad/folders
 * @access  Private
 */
const getFolders = async (req, res) => {
  try {
    const userId = req.user._id;
    const folders = await NoteFolder.find({ userId }).sort({ name: 1 }).lean();

    // Compute note counts per folder
    const counts = await Note.aggregate([
      { $match: { userId, isDeleted: false, isArchived: false, folderId: { $ne: null } } },
      { $group: { _id: '$folderId', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    counts.forEach((c) => {
      countMap[c._id.toString()] = c.count;
    });

    const foldersWithCount = folders.map((f) => ({
      ...f,
      noteCount: countMap[f._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      folders: foldersWithCount,
    });
  } catch (error) {
    console.error('getFolders error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve folders',
    });
  }
};

/**
 * @desc    Create a new folder
 * @route   POST /api/notepad/folders
 * @access  Private
 */
const createFolder = async (req, res) => {
  try {
    const { name, color = '#38bdf8' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Folder name is required',
      });
    }

    const existing = await NoteFolder.findOne({
      userId: req.user._id,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A folder with this name already exists',
      });
    }

    const folder = await NoteFolder.create({
      userId: req.user._id,
      name: name.trim(),
      color: color || '#38bdf8',
    });

    return res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      folder: { ...folder.toObject(), noteCount: 0 },
    });
  } catch (error) {
    console.error('createFolder error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create folder',
    });
  }
};

/**
 * @desc    Update a folder
 * @route   PUT /api/notepad/folders/:id
 * @access  Private
 */
const updateFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const folder = await NoteFolder.findOne({ _id: id, userId: req.user._id });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    if (name && name.trim()) {
      const duplicate = await NoteFolder.findOne({
        _id: { $ne: id },
        userId: req.user._id,
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Another folder with this name already exists',
        });
      }
      folder.name = name.trim();
    }

    if (color) folder.color = color;

    await folder.save();

    return res.status(200).json({
      success: true,
      message: 'Folder updated successfully',
      folder,
    });
  } catch (error) {
    console.error('updateFolder error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update folder',
    });
  }
};

/**
 * @desc    Delete a folder (safely unlinks notes to Unfiled)
 * @route   DELETE /api/notepad/folders/:id
 * @access  Private
 */
const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await NoteFolder.findOneAndDelete({ _id: id, userId: req.user._id });

    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    // Safety: move notes to unfiled (folderId: null)
    await Note.updateMany({ userId: req.user._id, folderId: id }, { folderId: null });

    return res.status(200).json({
      success: true,
      message: 'Folder deleted and notes moved to unfiled',
    });
  } catch (error) {
    console.error('deleteFolder error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete folder',
    });
  }
};

// ─────────────────────────────────────────────────────────────
// TAGS MANAGEMENT
// ─────────────────────────────────────────────────────────────

/**
 * @desc    Get all tags for logged-in user with usage counts
 * @route   GET /api/notepad/tags
 * @access  Private
 */
const getTags = async (req, res) => {
  try {
    const userId = req.user._id;
    const tags = await NoteTag.find({ userId }).sort({ name: 1 }).lean();

    // Compute tag occurrences
    const tagCounts = await Note.aggregate([
      { $match: { userId, isDeleted: false } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    tagCounts.forEach((t) => {
      countMap[t._id] = t.count;
    });

    const tagsWithCount = tags.map((t) => ({
      ...t,
      noteCount: countMap[t.name] || 0,
    }));

    return res.status(200).json({
      success: true,
      tags: tagsWithCount,
    });
  } catch (error) {
    console.error('getTags error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve tags',
    });
  }
};

/**
 * @desc    Create a new tag
 * @route   POST /api/notepad/tags
 * @access  Private
 */
const createTag = async (req, res) => {
  try {
    const { name, color = '#a855f7' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Tag name is required',
      });
    }

    const cleanName = name.trim().toLowerCase();

    const existing = await NoteTag.findOne({
      userId: req.user._id,
      name: cleanName,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Tag already exists',
      });
    }

    const tag = await NoteTag.create({
      userId: req.user._id,
      name: cleanName,
      color: color || '#a855f7',
    });

    return res.status(201).json({
      success: true,
      message: 'Tag created successfully',
      tag: { ...tag.toObject(), noteCount: 0 },
    });
  } catch (error) {
    console.error('createTag error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create tag',
    });
  }
};

/**
 * @desc    Update a tag (and update tag name across user's notes if renamed)
 * @route   PUT /api/notepad/tags/:id
 * @access  Private
 */
const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const tag = await NoteTag.findOne({ _id: id, userId: req.user._id });
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
      });
    }

    const oldName = tag.name;

    if (name && name.trim()) {
      const cleanName = name.trim().toLowerCase();
      if (cleanName !== oldName) {
        const duplicate = await NoteTag.findOne({
          _id: { $ne: id },
          userId: req.user._id,
          name: cleanName,
        });
        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: 'Another tag with this name already exists',
          });
        }
        tag.name = cleanName;

        // Update tag in user's notes
        await Note.updateMany(
          { userId: req.user._id, tags: oldName },
          { $set: { 'tags.$[elem]': cleanName } },
          { arrayFilters: [{ elem: oldName }] }
        );
      }
    }

    if (color) tag.color = color;
    await tag.save();

    return res.status(200).json({
      success: true,
      message: 'Tag updated successfully',
      tag,
    });
  } catch (error) {
    console.error('updateTag error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update tag',
    });
  }
};

/**
 * @desc    Delete a tag (and remove from user notes)
 * @route   DELETE /api/notepad/tags/:id
 * @access  Private
 */
const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tag = await NoteTag.findOneAndDelete({ _id: id, userId: req.user._id });

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
      });
    }

    // Remove from notes
    await Note.updateMany(
      { userId: req.user._id, tags: tag.name },
      { $pull: { tags: tag.name } }
    );

    return res.status(200).json({
      success: true,
      message: 'Tag deleted successfully',
    });
  } catch (error) {
    console.error('deleteTag error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete tag',
    });
  }
};

module.exports = {
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
};

