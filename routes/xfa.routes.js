// routes/xfa.routes.js (new file)
const express = require('express');
const router = express.Router();
const xfaController = require('../controllers/xfa.controller');
const { protect } = require('../middleware/auth.middleware');

router.get('/preview/:documentId',protect, xfaController.previewXfaWithFormVu);

module.exports = router;