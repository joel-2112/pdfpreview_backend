/**
 * Enforces consistency in API JSON structures.
 */

const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

const errorResponse = (res, error, statusCode = 500) => {
  const errorMessage = typeof error === 'string' ? error : error.message;
  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    stack: process.env.NODE_ENV === 'development' && error.stack ? error.stack : undefined
  });
};

module.exports = {
  successResponse,
  errorResponse
};
