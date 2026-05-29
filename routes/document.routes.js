const express = require('express');
const {
  upload,
  getAll,
  getOne,
  remove,
  getSecureLink,
  secureView,
  preparePreview,
  getPreviewCapabilities,
  uploadPreviewPdf,
  convertToHtml,
  getHtmlFormLink,
  secureHtmlView,
  reanalyze,
} = require('../controllers/document.controller');
const { protect } = require('../middleware/auth.middleware');
const { uploadPdf } = require('../middleware/upload.middleware');

const router = express.Router();

// Public endpoints accessed via temporary signed tokens
router.get('/secure-view', secureView);
router.get(/^\/html-view\/([^/]+)\/?(.*)$/, (req, res, next) => {
  req.htmlToken = req.params[0];
  req.htmlAsset = req.params[1] || 'form.html';
  return secureHtmlView(req, res, next);
});

// Protected REST routes
router.post('/upload', uploadPdf, protect, upload);
router.get('/', protect, getAll);
router.get('/preview-capabilities', protect, getPreviewCapabilities);
router.get('/:id/secure-link', protect, getSecureLink);
router.post('/:id/prepare-preview', protect, preparePreview);
router.post('/:id/preview-pdf', uploadPdf, protect, uploadPreviewPdf);
router.post('/:id/reanalyze', protect, reanalyze);
router.post('/:id/convert-to-html', protect, convertToHtml);
router.get('/:id/html-form', protect, getHtmlFormLink);
router.get('/:id', protect, getOne);
router.delete('/:id', protect, remove);

module.exports = router;
