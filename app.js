const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const corsMiddleware = require('./config/cors');
const apiRoutes = require('./routes');
const errorHandler = require('./middleware/error.middleware');

const app = express();

// Standard HTTP Security Headers
app.use(helmet());

// Log HTTP transactions during local development
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Enable Cross-Origin Request parameters
app.use(corsMiddleware);

// URL-encoded and standard JSON parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Centralized Router Mount
app.use('/api', apiRoutes);

// Catch-all route to format matching 404s
app.use((req, res, next) => {
  const error = new Error(`Resource Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Centralized Global Error middleware
app.use(errorHandler);

module.exports = app;
