const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

const FLATTENED_DIR = path.join(process.cwd(), 'uploads', 'flattened');
const PDFTK_BIN = process.env.PDFTK_PATH || 'pdftk';

const getFlattenedPath = (documentId) =>
  path.join(FLATTENED_DIR, `preview-${documentId}.pdf`);

const isPdftkAvailable = async () => {
  try {
    await execFileAsync(PDFTK_BIN, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Flatten XFA/hybrid PDF for browser preview using pdftk (when installed on the server).
 * @returns {Promise<string|null>} Absolute path to flattened PDF, or null if unavailable
 */
const ensureFlattenedPreview = async (sourceAbsolutePath, documentId) => {
  const outputPath = getFlattenedPath(documentId);

  if (fs.existsSync(outputPath)) {
    const sourceStat = fs.statSync(sourceAbsolutePath);
    const outStat = fs.statSync(outputPath);
    if (outStat.mtimeMs >= sourceStat.mtimeMs) {
      return outputPath;
    }
  }

  if (!(await isPdftkAvailable())) {
    logger.warn('pdftk is not available — cannot flatten XFA for preview.');
    return null;
  }

  if (!fs.existsSync(FLATTENED_DIR)) {
    fs.mkdirSync(FLATTENED_DIR, { recursive: true });
  }

  try {
    await execFileAsync(
      PDFTK_BIN,
      [sourceAbsolutePath, 'output', outputPath, 'flatten'],
      { timeout: 120000 }
    );
  } catch (err) {
    logger.error(`pdftk flatten failed for document ${documentId}: ${err.message}`);
    return null;
  }

  if (!fs.existsSync(outputPath)) {
    return null;
  }

  logger.info(`XFA preview cache written: ${outputPath}`);
  return outputPath;
};

const getPreviewStatus = async () => ({
  pdftkAvailable: await isPdftkAvailable(),
  pdftkPath: PDFTK_BIN,
});

module.exports = {
  ensureFlattenedPreview,
  getFlattenedPath,
  getPreviewStatus,
  isPdftkAvailable,
};
