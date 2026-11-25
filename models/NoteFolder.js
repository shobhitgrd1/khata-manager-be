const mongoose = require('mongoose');

const noteFolderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Folder name is required'],
      trim: true,
      maxlength: [60, 'Folder name cannot exceed 60 characters'],
    },
    color: {
      type: String,
      default: '#38bdf8',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

noteFolderSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('NoteFolder', noteFolderSchema);

