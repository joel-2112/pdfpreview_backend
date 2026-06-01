// controllers/xfa.controller.js
const formvuService = require('../services/formvu.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const path = require('path');
const Document = require('../models/Document.model');
const logger = require('../utils/logger');

const previewXfaWithFormVu = async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const userId = req.user.id; // from protect middleware

        // Retrieve the document, ensuring it belongs to the authenticated user
        const doc = await Document.findOne({ _id: documentId, user: userId });
        if (!doc) {
            return errorResponse(res, 'Document not found or access denied', 404);
        }

        // Output directory unique to this document
        const outputDir = path.join(__dirname, '../formvu_outputs', documentId);
        
        // Convert XFA to HTML (returns local URL like "/formvu-outputs/.../form.html")
        const localUrl = await formvuService.convertXfaToHtml(doc.path, outputDir);
        
        return successResponse(res, { htmlPreviewUrl: localUrl }, 'XFA form converted to HTML.');
    } catch (error) {
        logger.error(`XFA preview failed: ${error.message}`);
        next(error);
    }
};

module.exports = { previewXfaWithFormVu };