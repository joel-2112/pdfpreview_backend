

/**
 * Handle new document uploads: metadata mapping, static extraction, field definitions, and db creation.
 * @param {Object} file - Multer uploaded file schema
 * @param {string} userId - Requesting user Mongoose ID
 * @returns {Promise<Document>}
 */
const uploadDocument = async (file, userId) => {
  const document = new Document({
    user: userId,
    originalName: file.originalname,
    filename: file.filename,
    // Store path relative to project root for portability
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
  
  // 2. Remove configuration maps and definitions
  await FieldMap.deleteOne({ document: id, user: userId });
  await Document.deleteOne({ _id: id, user: userId });
  
  logger.info(`Successfully purged document record ${id} from database and disk.`);
  return true;
};

module.exports = {
  uploadDocument,
  getDocumentById,
  getDocuments,
  deleteDocument
};
