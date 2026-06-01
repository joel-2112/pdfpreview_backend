// routes/xfa.routes.js (new file)
const express = require('express');
const router = express.Router();
const xfaController = require('../controllers/xfa.controller');

router.get('/preview/:documentId',xfaController.previewXfaWithFormVu);

module.exports = router;