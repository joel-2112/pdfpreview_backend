const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['AcroForm', 'XFA', 'flat', 'unknown'],
    default: 'unknown'
  },
  hasXfa: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['uploaded', 'processed', 'failed'],
    default: 'uploaded'
  },
  fields: [{
    name: { type: String, required: true },
    type: { type: String, required: true }, // e.g. 'text', 'checkbox', 'radio', 'choice', 'button', 'unknown'
    value: { type: String, default: '' }
  }],
  size: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Document', documentSchema);
