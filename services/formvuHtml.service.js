const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const FormData = require('form-data');
const idrcloudclient = require('@idrsolutions/idrcloudclient');
const Document = require('../models/Document.model');
const logger = require('../utils/logger');

const HTML_ROOT = path.join(process.cwd(), 'uploads', 'html-forms');
const POLL_MS = 2000;
const MAX_WAIT_MS = 10 * 60 * 1000;

const isFormVuConfigured = () =>
  Boolean(process.env.FORMVU_SERVICE_URL || process.env.FORMVU_CLOUD_TOKEN);

const getHtmlOutputDir = (documentId) => path.join(HTML_ROOT, String(documentId));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findFormHtml = (dir) => {
  const direct = path.join(dir, 'form.html');
  if (fs.existsSync(direct)) return direct;

  const walk = (folder) => {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'form.html') return full;
      if (entry.isDirectory()) {
        const nested = walk(full);
        if (nested) return nested;
      }
    }
    return null;
  };

  return walk(dir);
};

const extractZipToDir = (zipBuffer, outputDir) => {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(outputDir, true);
};

const downloadZip = async (url) => {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(response.data);
};

const pollMicroservice = async (baseUrl, uuid) => {
  const statusUrl = `${baseUrl.replace(/\/$/, '')}/formvu`;
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const { data } = await axios.get(statusUrl, {
      params: { uuid },
      timeout: 30000,
    });

    if (data.state === 'processed') {
      return data;
    }
    if (data.state === 'error') {
      throw new Error(data.error || 'FormVu conversion failed');
    }

    await sleep(POLL_MS);
  }

  throw new Error('FormVu conversion timed out');
};

const convertViaMicroservice = async (sourceAbsolutePath, outputDir) => {
  const baseUrl = process.env.FORMVU_SERVICE_URL.replace(/\/$/, '');
  const formData = new FormData();
  formData.append('input', 'upload');
  formData.append('file', fs.createReadStream(sourceAbsolutePath), {
    filename: path.basename(sourceAbsolutePath),
    contentType: 'application/pdf',
  });

  const { data } = await axios.post(`${baseUrl}/formvu`, formData, {
    headers: formData.getHeaders(),
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  if (!data.uuid) {
    throw new Error('FormVu microservice did not return a conversion uuid');
  }

  const result = await pollMicroservice(baseUrl, data.uuid);

  if (!result.downloadUrl) {
    throw new Error('FormVu conversion finished without a download URL');
  }

  const zipBuffer = await downloadZip(result.downloadUrl);
  extractZipToDir(zipBuffer, outputDir);

  return findFormHtml(outputDir);
};

const convertViaCloud = (sourceAbsolutePath, outputDir) =>
  new Promise((resolve, reject) => {
    const endpoint = `https://cloud.idrsolutions.com/cloud/${idrcloudclient.FORMVU}`;

    idrcloudclient.convert({
      endpoint,
      conversionTimeout: MAX_WAIT_MS,
      parameters: {
        input: idrcloudclient.UPLOAD,
        file: sourceAbsolutePath,
        token: process.env.FORMVU_CLOUD_TOKEN,
      },
      success: async (data) => {
        try {
          if (!data.downloadUrl) {
            throw new Error('FormVu cloud did not return downloadUrl');
          }
          const zipBuffer = await downloadZip(data.downloadUrl);
          extractZipToDir(zipBuffer, outputDir);
          resolve(findFormHtml(outputDir));
        } catch (err) {
          reject(err);
        }
      },
      failure: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });

/**
 * Convert a PDF form to interactive HTML using FormVu (cloud or self-hosted).
 */
const convertPdfToHtml = async (sourceAbsolutePath, outputDir) => {
  if (!isFormVuConfigured()) {
    throw new Error(
      'FormVu is not configured. Set FORMVU_CLOUD_TOKEN or FORMVU_SERVICE_URL in backend .env'
    );
  }

  if (process.env.FORMVU_SERVICE_URL) {
    return convertViaMicroservice(sourceAbsolutePath, outputDir);
  }

  return convertViaCloud(sourceAbsolutePath, outputDir);
};

const documentNeedsHtmlForm = (doc) =>
  Boolean(
    doc.type === 'XFA' ||
      doc.hasXfa ||
      doc.xfaEngine === 'livecycle' ||
      doc.xfaEngine === 'generic'
  );

/**
 * Convert a stored document to HTML and persist paths on the Document record.
 */
const convertDocumentToHtml = async (documentId, userId) => {
  const doc = await Document.findOne({ _id: documentId, user: userId });
  if (!doc) {
    throw new Error('Document not found or access denied.');
  }

  if (!documentNeedsHtmlForm(doc)) {
    throw new Error('This document does not require HTML form conversion.');
  }

  const sourceAbsolute = path.isAbsolute(doc.path)
    ? doc.path
    : path.join(process.cwd(), doc.path);

  if (!fs.existsSync(sourceAbsolute)) {
    throw new Error('Source PDF file not found on disk.');
  }

  doc.htmlFormStatus = 'converting';
  doc.htmlFormError = null;
  await doc.save();

  const outputDir = getHtmlOutputDir(documentId);

  try {
    const formHtmlPath = await convertPdfToHtml(sourceAbsolute, outputDir);

    if (!formHtmlPath) {
      throw new Error('FormVu output did not contain form.html');
    }

    doc.htmlFormPath = path.relative(process.cwd(), outputDir);
    doc.htmlFormStatus = 'ready';
    doc.htmlFormError = null;
    doc.htmlFormConvertedAt = new Date();
    await doc.save();

    logger.info(`FormVu HTML ready for document ${documentId}`);
    return doc;
  } catch (error) {
    doc.htmlFormStatus = 'failed';
    doc.htmlFormError = error.message;
    await doc.save();
    logger.error(`FormVu HTML conversion failed for ${documentId}: ${error.message}`);
    throw error;
  }
};

const scheduleHtmlConversion = (documentId, userId) => {
  if (!isFormVuConfigured()) {
    logger.warn('FormVu not configured — skipping automatic HTML conversion.');
    return;
  }

  setImmediate(() => {
    convertDocumentToHtml(documentId, userId).catch((err) => {
      logger.error(`Background FormVu conversion failed: ${err.message}`);
    });
  });
};

const resolveHtmlAssetPath = (doc, requestedFile) => {
  if (!doc.htmlFormPath || doc.htmlFormStatus !== 'ready') {
    return null;
  }

  const rootDir = path.isAbsolute(doc.htmlFormPath)
    ? doc.htmlFormPath
    : path.join(process.cwd(), doc.htmlFormPath);

  const safeFile = requestedFile || 'form.html';
  const resolved = path.normalize(path.join(rootDir, safeFile));

  if (!resolved.startsWith(path.normalize(rootDir))) {
    return null;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }

  return resolved;
};

module.exports = {
  isFormVuConfigured,
  convertDocumentToHtml,
  convertPdfToHtml,
  documentNeedsHtmlForm,
  scheduleHtmlConversion,
  resolveHtmlAssetPath,
  getHtmlOutputDir,
};
