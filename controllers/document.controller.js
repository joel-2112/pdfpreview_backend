const documentService = require('../services/document.service');
const { generateSignedUrl, verifySignedUrlToken } = require('../services/signedUrl.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const fs = require('fs');
const path = require('path');
const Document = require('../models/Document.model');

const upload = async (req, res, next) => {
  try {
    const doc = await documentService.uploadDocument(req.file, req.user.id);
    return successResponse(res, doc, 'Document uploaded and analyzed successfully.', 201);
  } catch (error) {
    next(error);
  }
};

const getAll = async (req, res, next) => {
  try {
    const docs = await documentService.getDocuments(req.user.id);
    return successResponse(res, docs, 'Documents retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

const getOne = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id, req.user.id);
    return successResponse(res, doc, 'Document retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    await documentService.deleteDocument(req.params.id, req.user.id);
    return successResponse(res, null, 'Document deleted successfully.');
  } catch (error) {
    next(error);
  }
};

const getSecureLink = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id, req.user.id);
    const { type } = req.query; // 'original' or 'filled'
    const signedUrl = generateSignedUrl(doc._id, req.user.id, type || 'original');
    return successResponse(res, { signedUrl }, 'Secure temporary link generated.');
  } catch (error) {
    next(error);
  }
};

const secureView = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return errorResponse(res, 'Access denied. Missing signed token parameter.', 400);
    }
    
    // Validate JWT signature and token expiry
    const payload = verifySignedUrlToken(token);
    
    const doc = await Document.findById(payload.documentId);
    if (!doc) {
      return errorResponse(res, 'Document not found.', 404);
    }
    
    let filePath = doc.path;
    
    // If requesting the filled template, run the autofill service on the fly
    if (payload.type === 'filled') {
      const autofillService = require('../services/autofill.service');
      filePath = await autofillService.autofillDocument(doc._id, payload.userId);
    }
    
    if (!fs.existsSync(filePath)) {
      return errorResponse(res, 'Physical PDF file not found on server disk.', 404);
    }
    
    // Stream PDF directly to the browser
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
    const stream = fs.createReadStream(filePath);
    
    stream.on('error', (err) => {
      next(err);
    });
    
    stream.pipe(res);
  } catch (error) {
    return errorResponse(res, error.message, 401);
  }
};

module.exports = {
  upload,
  getAll,
  getOne,
  remove,
  getSecureLink,
  secureView
};
