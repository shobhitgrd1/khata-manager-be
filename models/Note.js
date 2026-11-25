const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: 'Untitled Note',
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    // Structured rich-text JSON (TipTap/ProseMirror format)
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ type: 'doc', content: [] }),
    },
    // Rendered HTML content for reading and previews
    htmlContent: {
      type: String,
      default: '',
    },
    // Plain text content for quick search and excerpt preview
    plainText: {
      type: String,
      default: '',
    },
    folderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NoteFolder',
      default: null,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    coverColor: {
      type: String,
      default: '',
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    // Task/checklist progress tracking
    checklistStats: {
      total: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
    },
    // Embedded checklist items for quick task management
    checklist: [
      {
        id: { type: String, required: true },
        text: { type: String, default: '' },
        completed: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast querying and filtering
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index({ userId: 1, isDeleted: 1, isArchived: 1, isPinned: 1 });
noteSchema.index({ userId: 1, folderId: 1 });
noteSchema.index({ title: 'text', plainText: 'text' });

module.exports = mongoose.model('Note', noteSchema);

