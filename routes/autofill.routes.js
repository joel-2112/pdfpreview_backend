const express = require('express');
const { body, param } = require('express-validator');
const { fillDocument, getMapping, updateMapping } = require('../controllers/autofill.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

router.use(protect);

router.post(
  '/',
  validate([
    body('documentId').isMongoId().withMessage('Please supply a valid Mongoose documentId reference.')
  ]),
  fillDocument
);

router.get(
  '/mappings/:documentId',
  validate([
    param('documentId').isMongoId().withMessage('Please supply a valid Mongoose documentId reference in route parameters.')
  ]),
  getMapping
);

router.put(
  '/mappings/:documentId',
  validate([
    param('documentId').isMongoId().withMessage('Please supply a valid Mongoose documentId reference in route parameters.'),
    body('mappings').isObject().withMessage('mappings parameter must be a key-value object map.')
  ]),
  updateMapping
);

module.exports = router;
