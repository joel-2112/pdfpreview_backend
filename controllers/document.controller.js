const documentService = require('../services/document.service');
const {
  generateSignedUrl,
  verifySignedUrlToken,
  generateHtmlFormUrl,
} = require('../services/signedUrl.service');
const {
  convertDocumentToHtml,
  isFormVuConfigured,
  documentNeedsHtmlForm,
  resolveHtmlAssetPath,
} = require('../services/formvuHtml.service');
const {
  ensureFlattenedPreview,
  getPreviewStatus,
  hasPreviewReady,
} = require('../services/xfaPreview.service');
const { isLiveCycleXfa } = require('../utils/xfaPlaceholder');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const fs = require('fs');
const path = require('path');
const Document = require('../models/Document.model');

const needsXfaPreview = (doc) =>
  doc.type === 'XFA' ||
  doc.hasXfa ||
  doc.xfaEngine === 'livecycle' ||
  doc.xfaEngine === 'generic';

const resolveDocumentFilePath = async (doc, userId, streamType) => {
  const absoluteSource = path.join(process.cwd(), doc.path);

  if (streamType === 'filled') {
    const autofillService = require('../services/autofill.service');
    return autofillService.autofillDocument(doc._id, userId);
  }

  if (streamType === 'preview' && needsXfaPreview(doc)) {
    const flattened = await ensureFlattenedPreview(
      absoluteSource,
      doc._id.toString(),
      doc
    );
    if (!flattened) {
      const liveCycle = isLiveCycleXfa(doc);
      const err = new Error(
        liveCycle
          ? 'This is a LiveCycle XFA form (e.g. IMM 1295). Upload a flattened preview PDF (Print to PDF from Acrobat Reader).'
          : 'XFA preview is not available. Install pdftk on the server or upload a flattened preview PDF.'
      );
      err.statusCode = 503;
      err.code = 'XFA_PREVIEW_UNAVAILABLE';
      err.liveCycle = liveCycle;
      throw err;
    }
    return flattened;
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
    return successResponse(res, doc, 'Document re-analyzed. XFA forms will use HTML preview.');
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
      previewReady = await hasPreviewReady(doc, absoluteSource);
    }

    const responseData = {
      signedUrl,
      previewReady,
      needsXfaPreview: needsXfaPreview(doc),
      liveCycleXfa: isLiveCycleXfa(doc),
      hasManualPreview: Boolean(doc.previewPath),
      htmlFormStatus: doc.htmlFormStatus,
      htmlFormError: doc.htmlFormError,
      formVuConfigured: isFormVuConfigured(),
      htmlFormUrl: null,
    };

    if (documentNeedsHtmlForm(doc) && doc.htmlFormStatus === 'ready') {
      responseData.htmlFormUrl = generateHtmlFormUrl(doc._id, req.user.id);
    }

    return successResponse(res, responseData, 'Secure temporary link generated.');
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
    const flattened = await ensureFlattenedPreview(
      absoluteSource,
      doc._id.toString(),
      doc
    );
    const status = await getPreviewStatus();

    if (!flattened) {
      const liveCycle = isLiveCycleXfa(doc);
      let message;
      if (liveCycle) {
        message =
          'IMM / IRCC LiveCycle forms cannot be auto-flattened. Open in Adobe Acrobat Reader → Print → Save as PDF, then use Upload preview PDF.';
      } else if (!status.pdftkAvailable) {
        message =
          'Server preview converter (pdftk) is not installed. Upload a flattened preview PDF or set PDFTK_PATH.';
      } else {
        message =
          'Could not flatten this PDF automatically. Upload a flattened copy from Acrobat Reader.';
      }
      return errorResponse(res, message, 503);
    }

    return successResponse(res, { previewReady: true }, 'Preview-ready PDF generated.');
  } catch (error) {
    next(error);
  }
};

const getPreviewCapabilities = async (req, res, next) => {
  try {
    const status = await getPreviewStatus();
    return successResponse(res, {
      ...status,
      formVuConfigured: isFormVuConfigured(),
    }, 'Preview capabilities retrieved.');
  } catch (error) {
    next(error);
  }
};

const convertToHtml = async (req, res, next) => {
  try {
    const doc = await convertDocumentToHtml(req.params.id, req.user.id);
    const htmlFormUrl = generateHtmlFormUrl(doc._id, req.user.id);
    return successResponse(
      res,
      { document: doc, htmlFormUrl },
      'Interactive HTML form generated successfully.'
    );
  } catch (error) {
    next(error);
  }
};

const getHtmlFormLink = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id, req.user.id);

    if (!documentNeedsHtmlForm(doc)) {
      return successResponse(
        res,
        { htmlFormStatus: 'none', formVuConfigured: isFormVuConfigured() },
        'Document does not use HTML form preview.'
      );
    }

    const payload = {
      htmlFormStatus: doc.htmlFormStatus,
      htmlFormError: doc.htmlFormError,
      formVuConfigured: isFormVuConfigured(),
      htmlFormUrl: null,
    };

    if (doc.htmlFormStatus === 'ready') {
      payload.htmlFormUrl = generateHtmlFormUrl(doc._id, req.user.id);
    }

    return successResponse(res, payload, 'HTML form status retrieved.');
  } catch (error) {
    next(error);
  }
};

const secureHtmlView = async (req, res, next) => {
  try {
    const token = req.htmlToken;
    const assetPath = req.htmlAsset || 'form.html';

    const payload = verifySignedUrlToken(token);
    if (payload.type !== 'html') {
      return errorResponse(res, 'Invalid token type for HTML form view.', 403);
    }

    const doc = await Document.findById(payload.documentId);
    if (!doc) {
      return errorResponse(res, 'Document not found.', 404);
    }

    const filePath = resolveHtmlAssetPath(doc, assetPath);
    if (!filePath) {
      return errorResponse(res, 'HTML form asset not found.', 404);
    }

    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");

    res.sendFile(filePath);
  } catch (error) {
    return errorResponse(res, error.message, 401);
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
  getPreviewCapabilities,
  convertToHtml,
  getHtmlFormLink,
  secureHtmlView,
};
