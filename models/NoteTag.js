const mongoose = require('mongoose');

const noteTagSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Tag name is required'],
      trim: true,
      maxlength: [40, 'Tag name cannot exceed 40 characters'],
    },
    color: {
      type: String,
      default: '#a855f7',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

noteTagSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('NoteTag', noteTagSchema);

