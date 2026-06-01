const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const xfaController = require('../controllers/xfa.controller');

router.get('/preview/:documentId', authMiddleware, xfaController.previewXfaWithFormVu);

module.exports = router;