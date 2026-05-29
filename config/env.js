const logger = require('../utils/logger');

const requiredEnvs = ['MONGO_URI', 'JWT_SECRET'];

const validateEnv = () => {
  const missing = requiredEnvs.filter(env => !process.env[env]);
  if (missing.length > 0) {
    logger.error(`FATAL: Missing critical environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  // Set default values if not explicitly set
  process.env.PORT = process.env.PORT || '5000';
  process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '24h';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  logger.info('Environment variables successfully validated.');
};

module.exports = validateEnv;
