const express = require('express');
const {
  upload,
  getAll,
  getOne,
  remove,
  getSecureLink,
  secureView,
  uploadPreviewPdf,
  reanalyze,
  preparePreview,
} = require('../controllers/document.controller');
const { protect } = require('../middleware/auth.middleware');
const { uploadPdf } = require('../middleware/upload.middleware');

const router = express.Router();

// Public endpoints accessed via temporary signed tokens
router.get('/secure-view', secureView);

// Protected REST routes
router.post('/upload', uploadPdf, protect, upload);
router.get('/', protect, getAll);
router.get('/:id/secure-link', protect, getSecureLink);
router.post('/:id/prepare-preview', protect, preparePreview);
router.post('/:id/preview-pdf', uploadPdf, protect, uploadPreviewPdf);
router.post('/:id/reanalyze', protect, reanalyze);
router.get('/:id', protect, getOne);
router.delete('/:id', protect, remove);

module.exports = router;
