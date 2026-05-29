const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const apiRoutes = require('./routes');
const errorHandler = require('./middleware/error.middleware');

const app = express();

// Security headers
app.use(helmet());

// ✅ CORS — preflight + all routes
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:5000',
      'http://localhost:5173',
      'https://pdfpreview-backend.onrender.com',
      'https://pdfpreview-adobe.vercel.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};

app.options('*', cors(corsOptions)); // ✅ preflight አስቀድሞ
app.use(cors(corsOptions));          // ✅ ሁሉም routes

// Development logger
// if (process.env.NODE_ENV === 'development') {
//   app.use(morgan('dev'));
// }

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res, next) => {
  const error = new Error(`Resource Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Global error handler
app.use(errorHandler);

module.exports = app;