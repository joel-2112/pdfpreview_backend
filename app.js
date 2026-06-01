const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const apiRoutes = require('./routes');
const errorHandler = require('./middleware/error.middleware');
const path = require('path');

const app = express();

// Security headers – disable frameguard for FormVu iframe preview
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false, // allows iframe embedding from any origin (adjust as needed)
  })
);

// CORS configuration (unchanged, keep your existing corsOptions)
const DEFAULT_ORIGINS = [
  'http://localhost:5000',
  'http://localhost:5173',
  'https://pdfpreview-backend.onrender.com',
  'https://pdfpreview-adobe.vercel.app',
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ⭐ Serve static FormVu outputs (XFA converted HTML)
app.use('/formvu-outputs', express.static(path.join(__dirname, 'formvu_outputs')));

// API routes
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