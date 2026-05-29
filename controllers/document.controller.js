const documentService = require('../services/document.service');
const { generateSignedUrl, verifySignedUrlToken } = require('../services/signedUrl.service');
const { ensureFlattenedPreview, getPreviewStatus } = require('../services/xfaPreview.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const fs = require('fs');
const path = require('path');
const Document = require('../models/Document.model');

const needsXfaPreview = (doc) =>
  doc.type === 'XFA' || (doc.hasXfa && (!doc.fields || doc.fields.length === 0));

const resolveDocumentFilePath = async (doc, userId, streamType) => {
  const absoluteSource = path.join(process.cwd(), doc.path);

  if (streamType === 'filled') {
    const autofillService = require('../services/autofill.service');
    return autofillService.autofillDocument(doc._id, userId);
  }

  if (streamType === 'preview' && needsXfaPreview(doc)) {
    const flattened = await ensureFlattenedPreview(absoluteSource, doc._id.toString());
    if (!flattened) {
      const err = new Error(
        'XFA preview is not available on this server. Install pdftk or upload an AcroForm PDF.'
      );
      err.statusCode = 503;
      err.code = 'XFA_PREVIEW_UNAVAILABLE';
      throw err;
    }
    return flattened;
  }

  return absoluteSource;
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
    const { type } = req.query; // 'original' | 'filled' | 'preview'
    const streamType = type || 'original';
    const signedUrl = generateSignedUrl(doc._id, req.user.id, streamType);

    let previewReady = true;
    if (streamType === 'preview' && needsXfaPreview(doc)) {
      const absoluteSource = path.join(process.cwd(), doc.path);
      const flattened = await ensureFlattenedPreview(absoluteSource, doc._id.toString());
      previewReady = Boolean(flattened);
    }

    return successResponse(
      res,
      { signedUrl, previewReady, needsXfaPreview: needsXfaPreview(doc) },
      'Secure temporary link generated.'
    );
  } catch (error) {
    next(error);
  }
};

const preparePreview = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id, req.user.id);

    if (!needsXfaPreview(doc)) {
      return successResponse(res, { previewReady: true }, 'Document does not require XFA conversion.');
    }

    const absoluteSource = path.join(process.cwd(), doc.path);
    const flattened = await ensureFlattenedPreview(absoluteSource, doc._id.toString());
    const status = await getPreviewStatus();

    if (!flattened) {
      return errorResponse(
        res,
        status.pdftkAvailable
          ? 'Could not flatten this PDF. The file may use dynamic XFA that pdftk cannot process.'
          : 'Server preview converter (pdftk) is not installed. Set PDFTK_PATH or upload an AcroForm PDF.',
        503
      );
    }

    return successResponse(res, { previewReady: true }, 'Preview-ready PDF generated.');
  } catch (error) {
    next(error);
  }
};

const getPreviewCapabilities = async (req, res, next) => {
  try {
    const status = await getPreviewStatus();
    return successResponse(res, status, 'Preview capabilities retrieved.');
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
  getAll,
  getOne,
  remove,
  getSecureLink,
  secureView,
  preparePreview,
  getPreviewCapabilities,
};
