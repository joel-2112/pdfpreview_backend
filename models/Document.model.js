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
  xfaEngine: {
    type: String,
    enum: ['livecycle', 'generic'],
  },
  pdfTitle: { type: String, default: null },
  pdfCreator: { type: String, default: null },
  pdfProducer: { type: String, default: null },
  previewPath: { type: String, default: null },
  previewOriginalName: { type: String, default: null },
  htmlFormPath: { type: String, default: null },
  htmlFormStatus: {
    type: String,
    enum: ['none', 'pending', 'converting', 'ready', 'failed'],
    default: 'none',
  },
  htmlFormError: { type: String, default: null },
  htmlFormConvertedAt: { type: Date, default: null },
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
