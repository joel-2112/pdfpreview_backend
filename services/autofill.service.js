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
  // Check if XFA form and handle accordingly
  const isPureXfa = doc.type === 'XFA' || (doc.hasXfa && (!doc.fields || doc.fields.length === 0));
  const isHybridXfa = doc.hasXfa && doc.fields && doc.fields.length > 0;
  
  if (isPureXfa) {
    // Pure XFA forms cannot be filled with pdf-lib
    // Check if Adobe PDF Services API is configured
    if (!process.env.ADOBE_PDF_SERVICES_CLIENT_ID || !process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET) {
      throw new Error(
        'This template uses pure XFA forms (e.g., LiveCycle/IMM 1295). ' +
        'To autofill these forms, configure Adobe PDF Services API credentials in backend .env: ' +
        'ADOBE_PDF_SERVICES_CLIENT_ID and ADOBE_PDF_SERVICES_CLIENT_SECRET. ' +
        'Get credentials from: https://developer.adobe.com/document-services/docs/overview/pdf-services-api/'
      );
    }
    // If Adobe PDF Services is configured, use it for XFA autofill
    logger.info('Using Adobe PDF Services API for XFA form autofill');
    return await autofillXfaDocument(doc, user, fieldMap, filledPath);
  }
  
  if (isHybridXfa) {
    // Hybrid XFA/AcroForm - pdf-lib can handle this by stripping XFA
    logger.info('Hybrid XFA/AcroForm detected - will strip XFA and fill AcroForm fields');
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

const autofillXfaDocument = async (doc, user, fieldMap, outputPath) => {
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument } = require('pdf-lib');
  const { injectXfaData } = require('../utils/xfaInjector');
  const logger = require('../utils/logger');
  
  try {
    logger.info('Injecting data into XFA XML dataset directly');
    
    // Read the original PDF
    const pdfBytes = fs.readFileSync(doc.path);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    // Map user profile values to PDF form keys
    // Since we don't have pdf-lib field extraction for pure XFA, 
    // we just map every rule in fieldMap
    const injectValues = {};
    if (user.profileData) {
      for (const [pdfKey, profileKey] of fieldMap.mappings.entries()) {
        if (user.profileData.has(profileKey)) {
          injectValues[pdfKey] = user.profileData.get(profileKey);
        }
      }
    }
    
    // Fill the XFA XML
    const injected = await injectXfaData(pdfDoc, injectValues);
    
    if (!injected) {
      logger.warn('No XFA datasets found to inject or XML update failed. Outputting unchanged document.');
    }
    
    // Save to outputPath
    const filledPdfBytes = await pdfDoc.save();
    
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, filledPdfBytes);
    
    logger.info(`XFA autofill complete using direct XML injection. Generated file: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    logger.error(`XFA autofill error: ${error.message}`);
    throw error;
  }
};

module.exports = {
  autofillDocument
};
