const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('../utils/logger');
const { isXfaPlaceholderPdf, isLiveCycleXfa } = require('../utils/xfaPlaceholder');

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

const getManualPreviewPath = (doc) => {
  if (!doc.previewPath) return null;
  const absolute = path.isAbsolute(doc.previewPath)
    ? doc.previewPath
    : path.join(process.cwd(), doc.previewPath);
  if (!fs.existsSync(absolute)) return null;
  if (isXfaPlaceholderPdf(absolute)) {
    logger.warn(`Manual preview for ${doc._id} is still an XFA placeholder — ignored.`);
    return null;
  }
  return absolute;
};

const tryPdftkFlatten = async (sourceAbsolutePath, outputPath) => {
  if (!(await isPdftkAvailable())) {
    return null;
  }
  try {
    await execFileAsync(
      PDFTK_BIN,
      [sourceAbsolutePath, 'output', outputPath, 'flatten'],
      { timeout: 120000 }
    );
  } catch (err) {
    logger.error(`pdftk flatten failed: ${err.message}`);
    return null;
  }
  if (!fs.existsSync(outputPath) || isXfaPlaceholderPdf(outputPath)) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    return null;
  }
  return outputPath;
};

/**
 * Resolve a browser-previewable PDF for XFA templates.
 * LiveCycle / IRCC forms (IMM 1295) require a user-uploaded flattened copy.
 */
const ensureFlattenedPreview = async (sourceAbsolutePath, documentId, doc = {}) => {
  const manual = getManualPreviewPath(doc);
  if (manual) {
    return manual;
  }

  const outputPath = getFlattenedPath(documentId);

  if (fs.existsSync(outputPath)) {
    const sourceStat = fs.statSync(sourceAbsolutePath);
    const outStat = fs.statSync(outputPath);
    if (outStat.mtimeMs >= sourceStat.mtimeMs && !isXfaPlaceholderPdf(outputPath)) {
      return outputPath;
    }
    fs.unlinkSync(outputPath);
  }

  if (isLiveCycleXfa(doc)) {
    logger.info(
      `Skipping pdftk for LiveCycle XFA document ${documentId} — upload a flattened preview PDF.`
    );
    return null;
  }

  if (!fs.existsSync(FLATTENED_DIR)) {
    fs.mkdirSync(FLATTENED_DIR, { recursive: true });
  }

  const flattened = await tryPdftkFlatten(sourceAbsolutePath, outputPath);
  if (flattened) {
    logger.info(`XFA preview cache written: ${flattened}`);
  }
  return flattened;
};

const hasPreviewReady = async (doc, sourceAbsolutePath) => {
  if (getManualPreviewPath(doc)) return true;
  const flattened = await ensureFlattenedPreview(
    sourceAbsolutePath,
    doc._id.toString(),
    doc
  );
  return Boolean(flattened);
};

const getPreviewStatus = async () => ({
  pdftkAvailable: await isPdftkAvailable(),
  pdftkPath: PDFTK_BIN,
});

module.exports = {
  ensureFlattenedPreview,
  getFlattenedPath,
  getManualPreviewPath,
  getPreviewStatus,
  hasPreviewReady,
  isPdftkAvailable,
  isXfaPlaceholderPdf,
};
