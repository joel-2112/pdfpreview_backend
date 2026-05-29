const { validationResult } = require('express-validator');

/**
 * Validates request parameters and return a clean validation error map.
 * @param {Array} validations - Array of express-validator rules
 */
const validate = (validations) => {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    // Format errors nicely
    const extractedErrors = errors.array().map(err => ({ [err.path]: err.msg }));
    
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: extractedErrors
    });
  };
};

module.exports = { validate };
