const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const { errorResponse } = require('../utils/apiResponse');

const protect = async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  if (!token) {
    if (req.file) {
      const { deleteFile } = require('../utils/fileHelper');
      deleteFile(req.file.path);
    }
    return errorResponse(res, 'Not authorized to access this route. Missing bearer token.', 401);
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    
    if (!req.user) {
      if (req.file) {
        const { deleteFile } = require('../utils/fileHelper');
        deleteFile(req.file.path);
      }
      return errorResponse(res, 'The user associated with this token no longer exists.', 404);
    }
    
    next();
  } catch (error) {
    if (req.file) {
      const { deleteFile } = require('../utils/fileHelper');
      deleteFile(req.file.path);
    }
    return errorResponse(res, 'Not authorized to access this route. Invalid or expired token.', 401);
  }
};

module.exports = { protect };
