const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const generateSignedUrl = (documentId, userId, type = 'original') => {
  const token = jwt.sign(
    { documentId, userId, type },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  // ✅ absolute URL — Adobe ይቀበለዋል
  const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
  const signedUrl = `${BASE_URL}/api/documents/secure-view?token=${token}`;

  logger.info(`Generated signed link for Document: ${documentId}, Type: ${type}`);
  return signedUrl;
};

const verifySignedUrlToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    logger.warn(`Failed to verify token: ${error.message}`);
    throw new Error('Temporary access link has expired or is invalid.');
  }
};

module.exports = { generateSignedUrl, verifySignedUrlToken };