const logger = require('../utils/logger');
const { errorResponse } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  // Log the complete stack trace via Winston
  logger.error(err.stack || err.message || err);
  
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  
  // Mongoose CastError (e.g. invalid ObjectId formatting)
  if (err.name === 'CastError') {
    message = `Resource not found with ID of ${err.value}`;
    statusCode = 404;
  }
  
  // Mongoose duplicate unique key errors (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    message = `Duplicate field value entered: '${err.keyValue[field]}' for field '${field}'. Must be unique.`;
    statusCode = 400;
  }
  
  // Mongoose schema validations
  if (err.name === 'ValidationError') {
    message = Object.values(err.errors).map(val => val.message).join(', ');
    statusCode = 400;
  }
  
  return errorResponse(res, message, statusCode);
};

module.exports = errorHandler;
