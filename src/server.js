const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const UI_PREFIX = process.env.UI_PREFIX || '/kafka';
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

// Winston logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get(`${API_PREFIX}/health`, (req, res) => {
  res.json({ status: 'healthy' });
});

// Serve the main dashboard
app.get(`${UI_PREFIX}/dashboard`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Dashboard UI available at http://localhost:${PORT}${UI_PREFIX}/dashboard`);
  logger.info(`API available at http://localhost:${PORT}${API_PREFIX}`);
}); 