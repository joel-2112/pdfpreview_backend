const express = require('express');
const { upload, getAll, getOne, remove, getSecureLink, secureView } = require('../controllers/document.controller');
const { protect } = require('../middleware/auth.middleware');
const { uploadPdf } = require('../middleware/upload.middleware');

const router = express.Router();

// Public endpoint accessed via temporary signed query tokens
router.get('/secure-view', secureView);

// Protected REST routes
router.post('/upload', uploadPdf, protect, upload);
router.get('/', protect, getAll);
router.get('/:id', protect, getOne);
router.delete('/:id', protect, remove);
router.get('/:id/secure-link', protect, getSecureLink);

module.exports = router;
