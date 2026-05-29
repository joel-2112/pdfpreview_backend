const autofillService = require('../services/autofill.service');
const FieldMap = require('../models/FieldMap.model');
const { generateSignedUrl } = require('../services/signedUrl.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const fillDocument = async (req, res, next) => {
  try {
    const { documentId } = req.body;
    
    // Validate and run filling logic to verify no structural failures
    await autofillService.autofillDocument(documentId, req.user.id);
    
    // Return a temporary secure view URL to download or preview the filled PDF
    const signedUrl = generateSignedUrl(documentId, req.user.id, 'filled');
    
    return successResponse(res, { signedUrl }, 'Document autofilled successfully.');
  } catch (error) {
    next(error);
  }
};

const getMapping = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    let fieldMap = await FieldMap.findOne({ document: documentId, user: req.user.id });
    
    if (!fieldMap) {
      fieldMap = await FieldMap.create({
        user: req.user.id,
        document: documentId,
        mappings: {}
      });
    }
    
    return successResponse(res, fieldMap, 'Field mapping rules retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

const updateMapping = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { mappings } = req.body;
    
    let fieldMap = await FieldMap.findOne({ document: documentId, user: req.user.id });
    if (!fieldMap) {
      fieldMap = new FieldMap({
        user: req.user.id,
        document: documentId
      });
    }
    
    if (mappings && typeof mappings === 'object') {
      Object.entries(mappings).forEach(([pdfField, profileField]) => {
        fieldMap.mappings.set(pdfField, String(profileField));
      });
    }
    
    await fieldMap.save();
    return successResponse(res, fieldMap, 'Field mapping rules updated successfully.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  fillDocument,
  getMapping,
  updateMapping
};
