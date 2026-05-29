const FieldMap = require('../models/FieldMap.model');
const User = require('../models/User.model');
const Document = require('../models/Document.model');
const { injectData } = require('../utils/pdfInjector');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Automates PDF filling by resolving FieldMap rules against the user's Profile data.
 * @param {string} documentId - Target Document Database ID
 * @param {string} userId - Requesting User Database ID
 * @returns {Promise<string>} - Absolute path to the generated filled PDF file
 */
const autofillDocument = async (documentId, userId) => {
  logger.info(`Starting autofill operation for Document: ${documentId}, User: ${userId}`);
  
  const user = await User.findById(userId);
  const doc = await Document.findOne({ _id: documentId, user: userId });
  const fieldMap = await FieldMap.findOne({ document: documentId, user: userId });
  
  if (!doc) {
    throw new Error('PDF document template not found or access denied.');
  }
  if (!user) {
    throw new Error('User profile record not found.');
  }
  if (!fieldMap) {
    throw new Error('Field mappings not configured for this document.');
  }
  if (doc.type === 'XFA' || (doc.hasXfa && (!doc.fields || doc.fields.length === 0))) {
    throw new Error(
      'This template uses XFA forms. Convert it with Adobe PDF Services or pdftk before autofill and browser preview.'
    );
  }
  
  // 1. Map user profile values to PDF form keys
  const injectValues = {};
  
  doc.fields.forEach(field => {
    const profileFieldKey = fieldMap.mappings.get(field.name);
    
    if (profileFieldKey && user.profileData && user.profileData.has(profileFieldKey)) {
      const value = user.profileData.get(profileFieldKey);
      injectValues[field.name] = value;
      logger.debug(`Mapped PDF field "${field.name}" ➔ User Profile "${profileFieldKey}": "${value}"`);
    } else {
      // Retain the template default if present, or assign empty string
      injectValues[field.name] = field.value || '';
    }
  });
  
  // 2. Generate a unique output file path
  const filledFilename = `filled-${Date.now()}-${doc.filename}`;
  const filledPath = path.join(__dirname, '../uploads/filled', filledFilename);
  
  // Ensure the filled directory exists
  const dir = path.dirname(filledPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 3. Inject form fields using pdf-lib
  await injectData(doc.path, injectValues, filledPath);
  
  logger.info(`Autofill complete. Generated file saved at: ${filledPath}`);
  return filledPath;
};

module.exports = {
  autofillDocument
};
