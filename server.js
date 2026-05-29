require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const validateEnv = require('./config/env');
const logger = require('./utils/logger');

// 1. Perform immediate configuration validation check
validateEnv();

// 2. Orchestrate DB Connection and Port Binding listener
const startServer = async () => {
  try {
    await connectDB();
    
    const PORT = process.env.PORT || '5000';
    
    const server = app.listen(PORT, () => {
      logger.info(`Server successfully bound in ${process.env.NODE_ENV} mode. Listening on port ${PORT}...`);
    });
    
    // Secure application from uncaught Promise Rejections
    process.on('unhandledRejection', (err) => {
      logger.error(`Fatal Unhandled Promise Rejection: ${err.message}`);
      
      // Close network ports before shutting down
      server.close(() => {
        logger.info('Closed active TCP sockets. Terminating process...');
        process.exit(1);
      });
    });
  } catch (error) {
    logger.error(`Critical Server Startup failure: ${error.message}`);
    process.exit(1);
  }
};

startServer();
