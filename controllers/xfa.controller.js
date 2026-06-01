// controllers/xfa.controller.js (new file)
const formvuService = require('../services/formvu.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document.model');

const previewXfaWithFormVu = async (req, res, next) => {
    try {
        const { documentId } = req.params;
        // const userId = req.user.id;

        // Retrieve the document from your database
        const doc = await Document.findOne({ _id: documentId});
        if (!doc) {
            return errorResponse(res, 'Document not found', 404);
        }

        // Determine a temporary output directory for this conversion
        const outputDir = path.join(__dirname, '../formvu_outputs', documentId);
        
        // Call the FormVu service
        const result = await formvuService.convertXfaToHtml(doc.path, outputDir);
        
        // For the trial, result is a downloadUrl. You could either:
        // 1. Return that URL directly to the frontend (but it's temporary)
        // 2. Download and extract the ZIP, then serve the HTML from your own domain
        // The example below assumes you have downloaded and extracted the ZIP.
        const htmlPreviewUrl = `/api/xfa/preview/${documentId}/form.html`;
        
        return successResponse(res, { htmlPreviewUrl }, 'XFA form converted to HTML.');
    } catch (error) {
        next(error);
    }
};

module.exports = { previewXfaWithFormVu };