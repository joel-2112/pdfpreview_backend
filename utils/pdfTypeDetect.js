const fs = require('fs');
const path = require('path');

const scanPdfHeader = (absolutePath) => {
  const buf = fs.readFileSync(absolutePath);
  const sample = buf.toString('latin1', 0, Math.min(buf.length, 5 * 1024 * 1024));
  const isXfa =
    sample.includes('/XFA') ||
    sample.includes('<xfa:') ||
    sample.includes('xfa:datasets');
  const liveCycle = /LiveCycle/i.test(sample);
  const immForm = /IMM\s*1295/i.test(sample);
  return { isXfa, liveCycle, immForm };
};

/**
 * Repair MongoDB metadata for uploads that pre-date XFA detection fields.
 */
const syncDocumentXfaMetadata = async (doc) => {
  const absolutePath = path.isAbsolute(doc.path)
    ? doc.path
    : path.join(process.cwd(), doc.path);

  if (!fs.existsSync(absolutePath)) {
    return doc;
  }

  const { isXfa, liveCycle, immForm } = scanPdfHeader(absolutePath);
  if (!isXfa && !liveCycle && !immForm) {
    return doc;
  }

  let changed = false;

  if (!doc.hasXfa) {
    doc.hasXfa = true;
    changed = true;
  }
  if (liveCycle && doc.xfaEngine !== 'livecycle') {
    doc.xfaEngine = 'livecycle';
    changed = true;
  } else if (isXfa && !doc.xfaEngine) {
    doc.xfaEngine = 'generic';
    changed = true;
  }
  if ((isXfa || liveCycle || immForm) && doc.type !== 'XFA') {
    doc.type = 'XFA';
    changed = true;
  }

  if (changed) {
    await doc.save();
  }

  return doc;
};

module.exports = {
  scanPdfHeader,
  syncDocumentXfaMetadata,
};
