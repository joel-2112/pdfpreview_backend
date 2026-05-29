const upload = require('../config/multer');
const { errorResponse } = require('../utils/apiResponse');

const uploadPdf = (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      // Multer error handling (e.g. limit exceeded) or filter error
      const message = err.message || 'File upload failed';
      return errorResponse(res, message, 400);
    }
    
    if (!req.file) {
      return errorResponse(res, 'Please upload a valid PDF file. No file received.', 400);
    }
    
    next();
  });
};

module.exports = { uploadPdf };
