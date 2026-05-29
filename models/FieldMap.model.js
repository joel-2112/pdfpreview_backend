const mongoose = require('mongoose');

const fieldMapSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true
  },
  mappings: {
    type: Map,
    of: String,
    default: {}
  }
}, { timestamps: true });

// Ensure a user can only have one mapping document per PDF
fieldMapSchema.index({ user: 1, document: 1 }, { unique: true });

module.exports = mongoose.model('FieldMap', fieldMapSchema);
