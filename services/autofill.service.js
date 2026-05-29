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

/**
 * Autofill pure XFA forms using pdftk or Adobe PDF Services API
 * This is required for LiveCycle/IMM 1295 forms that cannot be filled with pdf-lib
 */
const autofillXfaDocument = async (doc, user, fieldMap, outputPath) => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const fs = require('fs');
  const logger = require('../utils/logger');
  
  const execFileAsync = promisify(execFile);
  const PDFTK_BIN = process.env.PDFTK_PATH || 'pdftk';
  
  try {
    // Check if pdftk is available
    try {
      await execFileAsync(PDFTK_BIN, ['--version'], { timeout: 5000 });
    } catch {
      throw new Error(
        'XFA form autofill requires pdftk to be installed on the server. ' +
        'Install pdftk or set PDFTK_PATH in .env. ' +
        'Alternatively, configure Adobe PDF Services API for full XFA support: ' +
        'ADOBE_PDF_SERVICES_CLIENT_ID and ADOBE_PDF_SERVICES_CLIENT_SECRET.'
      );
    }
    
    // For XFA forms, we need to:
    // 1. Flatten the XFA form to convert it to a standard PDF
    // 2. Then fill it using pdf-lib
    
    logger.info('Flattening XFA form using pdftk before autofill');
    
    // Create a temporary flattened version
    const tempFlattenedPath = path.join(__dirname, '../uploads/temp', `flattened-${Date.now()}-${doc.filename}`);
    const tempDir = path.dirname(tempFlattenedPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Flatten using pdftk
    await execFileAsync(
      PDFTK_BIN,
      [doc.path, 'output', tempFlattenedPath, 'flatten'],
      { timeout: 120000 }
    );
    
    if (!fs.existsSync(tempFlattenedPath)) {
      throw new Error('pdftk failed to flatten XFA form');
    }
    
    // Now parse the flattened PDF to get AcroForm fields
    const { parsePdf } = require('../utils/pdfParser');
    const parsed = await parsePdf(tempFlattenedPath);
    
    if (parsed.fields.length === 0) {
      throw new Error(
        'Flattened XFA form has no fillable fields. ' +
        'This form may not be compatible with automated filling. ' +
        'Please fill it manually in Adobe Acrobat Reader and save as PDF.'
      );
    }
    
    // Map user profile values to PDF form keys
    const injectValues = {};
    parsed.fields.forEach(field => {
      const profileFieldKey = fieldMap.mappings.get(field.name);
      if (profileFieldKey && user.profileData && user.profileData.has(profileFieldKey)) {
        const value = user.profileData.get(profileFieldKey);
        injectValues[field.name] = value;
      } else {
        injectValues[field.name] = field.value || '';
      }
    });
    
    // Fill the flattened PDF
    await injectData(tempFlattenedPath, injectValues, outputPath);
    
    // Clean up temporary file
    fs.unlinkSync(tempFlattenedPath);
    
    logger.info(`XFA autofill complete using pdftk flatten + pdf-lib. Generated file: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    logger.error(`XFA autofill error: ${error.message}`);
    throw error;
  }
};

module.exports = {
  autofillDocument
};
