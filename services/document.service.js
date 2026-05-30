const Document = require('../models/Document.model');
const path = require('path');
const fs = require('fs');
const FieldMap = require('../models/FieldMap.model');
const { analyzePdf } = require('./pdf.service');
const { deleteFile } = require('../utils/fileHelper');
const { getFlattenedPath } = require('./xfaPreview.service');
const logger = require('../utils/logger');

const uploadDocument = async (file, userId) => {
  const document = new Document({
    user: userId,
    originalName: file.originalname,
    filename: file.filename,
    path: path.relative(process.cwd(), file.path),
    size: file.size,
    status: 'uploaded'
  });
  
  try {
    // Save preliminary record so the user has immediate visual feedback
    await document.save();
    
    // Parse structural field configurations
    const analysis = await analyzePdf(file.path);
    
    document.type = analysis.type;
    document.hasXfa = Boolean(analysis.hasXfa);
    document.xfaEngine = analysis.xfaEngine || null;
    document.pdfTitle = analysis.pdfTitle || null;
    document.pdfCreator = analysis.pdfCreator || null;
    document.pdfProducer = analysis.pdfProducer || null;
    document.fields = analysis.fields;
    document.status = 'processed';
    await document.save();
    
    // Seed an empty field mapping database entry
    const fieldMap = new FieldMap({
      user: userId,
      document: document._id,
      mappings: {}
    });
    await fieldMap.save();
    
    logger.info(`Successfully stored and parsed document metadata: ${document._id}`);
    return document;
  } catch (error) {
    logger.error(`Failed during document parsing flow for file ${file.filename}: ${error.message}`);
    document.status = 'failed';
    await document.save().catch(err => logger.error(`Mongoose fail state save error: ${err.message}`));
    
    // Delete file to avoid leaving orphans
    deleteFile(file.path);
    throw error;
  }
};

const getDocumentById = async (id, userId) => {
  const doc = await Document.findOne({ _id: id, user: userId });
  if (!doc) {
    const error = new Error('Document not found or access denied.');
    error.statusCode = 404;
    throw error;
  }
  const { syncDocumentXfaMetadata } = require('../utils/xfaDetect');
  return syncDocumentXfaMetadata(doc);
};

const reanalyzeDocument = async (id, userId) => {
  const doc = await getDocumentById(id, userId);
  const absolutePath = path.join(process.cwd(), doc.path);
  const analysis = await analyzePdf(absolutePath);

  doc.type = analysis.type;
  doc.hasXfa = Boolean(analysis.hasXfa);
  doc.xfaEngine = analysis.xfaEngine || null;
  doc.pdfTitle = analysis.pdfTitle || null;
  doc.pdfCreator = analysis.pdfCreator || null;
  doc.pdfProducer = analysis.pdfProducer || null;
  doc.fields = analysis.fields;
  await doc.save();

  return doc;
};

const getDocuments = async (userId) => {
  return await Document.find({ user: userId }).sort({ createdAt: -1 });
};

const deleteDocument = async (id, userId) => {
  const doc = await Document.findOne({ _id: id, user: userId });
  if (!doc) {
    const error = new Error('Document not found or access denied.');
    error.statusCode = 404;
    throw error;
  }
  
  // 1. Delete physical template copy from local uploads
  const absolutePath = path.join(process.cwd(), doc.path);
  deleteFile(absolutePath);
  deleteFile(getFlattenedPath(id.toString()));
  if (doc.previewPath) {
    deleteFile(path.join(process.cwd(), doc.previewPath));
  }
  const htmlDir = getHtmlOutputDir(id.toString());
  if (fs.existsSync(htmlDir)) {
    fs.rmSync(htmlDir, { recursive: true, force: true });
  }

  // 2. Remove configuration maps and definitions
  await FieldMap.deleteOne({ document: id, user: userId });
  await Document.deleteOne({ _id: id, user: userId });
  
  logger.info(`Successfully purged document record ${id} from database and disk.`);
  return true;
};

const attachPreviewPdf = async (documentId, userId, file) => {
  const doc = await getDocumentById(documentId, userId);
  const { isXfaPlaceholderPdf } = require('../utils/xfaPlaceholder');

  const previewDir = path.join(process.cwd(), 'uploads', 'previews');
  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true });
  }

  const destName = `preview-${documentId}-${Date.now()}${path.extname(file.originalname)}`;
  const destAbsolute = path.join(previewDir, destName);

  fs.renameSync(file.path, destAbsolute);

  if (isXfaPlaceholderPdf(destAbsolute)) {
    fs.unlinkSync(destAbsolute);
    const error = new Error(
      'This file is still the XFA "Please wait" shell. In Acrobat Reader: open the form → Print → Save as PDF, then upload that file.'
    );
    error.statusCode = 400;
    throw error;
  }

  if (doc.previewPath) {
    deleteFile(path.join(process.cwd(), doc.previewPath));
  }

  doc.previewPath = path.relative(process.cwd(), destAbsolute);
  doc.previewOriginalName = file.originalname;
  await doc.save();

  const { getFlattenedPath } = require('./xfaPreview.service');
  deleteFile(getFlattenedPath(documentId.toString()));

  logger.info(`Attached flattened preview PDF for document ${documentId}`);
  return doc;
};

module.exports = {
  uploadDocument,
  getDocumentById,
  getDocuments,
  deleteDocument,
  attachPreviewPdf,
  reanalyzeDocument,
};
