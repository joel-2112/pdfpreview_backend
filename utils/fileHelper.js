const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const getFileExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Successfully deleted file from disk: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error deleting file from disk (${filePath}): ${error.message}`);
    return false;
  }
};

module.exports = {
  getFileExtension,
  formatBytes,
  deleteFile
};
