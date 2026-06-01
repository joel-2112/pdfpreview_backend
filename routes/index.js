const express = require('express');
const authRoutes = require('./auth.routes');
const documentRoutes = require('./document.routes');
const autofillRoutes = require('./autofill.routes');
const xfaRoutes = require('./xfa.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/xfa', xfaRoutes)
router.use('/autofill', autofillRoutes);

module.exports = router;
