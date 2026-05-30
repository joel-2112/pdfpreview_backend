const documentService = require('../services/document.service');
const {
  generateSignedUrl,
  verifySignedUrlToken,
} = require('../services/signedUrl.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const fs = require('fs');
const path = require('path');
const Document = require('../models/Document.model');

const resolveDocumentFilePath = async (doc, userId, streamType) => {
  const absoluteSource = path.join(process.cwd(), doc.path);

  if (streamType === 'filled') {
    const autofillService = require('../services/autofill.service');
    return autofillService.autofillDocument(doc._id, userId);
  }

  // Frontend now uses react-pdf which has native XFA support.
  // We no longer need to flatten XFA PDFs for preview.
  if (streamType === 'preview' && doc.previewPath) {
    // If the user explicitly uploaded a flattened preview, we can use it
    return path.join(process.cwd(), doc.previewPath);
  }

  return absoluteSource;
};

const uploadPreviewPdf = async (req, res, next) => {
  try {
    const doc = await documentService.attachPreviewPdf(
      req.params.id,
      req.user.id,
      req.file
    );
    return successResponse(res, doc, 'Flattened preview PDF attached. You can open Preview now.');
  } catch (error) {
    next(error);
  }
};

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

const reanalyze = async (req, res, next) => {
  try {
    const doc = await documentService.reanalyzeDocument(req.params.id, req.user.id);
    return successResponse(res, doc, 'Document re-analyzed.');
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
    const streamType = req.query.type || req.body?.viewType || 'original';
    const signedUrl = generateSignedUrl(doc._id, req.user.id, streamType);

    const responseData = {
      signedUrl,
      previewReady: true,
      isXfa: doc.type === 'XFA' || doc.hasXfa,
      hasManualPreview: Boolean(doc.previewPath),
    };

    return successResponse(res, responseData, 'Secure temporary link generated.');
  } catch (error) {
    next(error);
  }
};

const preparePreview = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id, req.user.id);

    if (!doc.hasXfa && doc.type !== 'XFA') {
      return successResponse(res, { previewReady: true }, 'Document does not require XFA conversion.');
    }

    // XFA flattening removed — client should upload a flattened PDF if needed
    return errorResponse(res, 'XFA preview generation is not supported server-side. Please upload a flattened PDF.', 503);
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
    
    let filePath;
    try {
      filePath = await resolveDocumentFilePath(doc, payload.userId, payload.type || 'original');
    } catch (err) {
      if (err.code === 'XFA_PREVIEW_UNAVAILABLE') {
        return errorResponse(res, err.message, 503);
      }
      throw err;
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
  uploadPreviewPdf,
  getAll,
  getOne,
  reanalyze,
  remove,
  getSecureLink,
  secureView,
  preparePreview,
};
