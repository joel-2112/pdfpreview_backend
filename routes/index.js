const express = require('express');
const authRoutes = require('./auth.routes');
const documentRoutes = require('./document.routes');
const autofillRoutes = require('./autofill.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/autofill', autofillRoutes);

module.exports = router;
