const fs = require('fs');

const PLACEHOLDER_MARKERS = [
  'Please wait',
  'not eventually replaced by the proper contents',
  'upgrade to the latest version of Adobe Reader',
];

/**
 * True when the PDF still contains the default XFA "Please wait" shell
 * (e.g. IMM 1295 / LiveCycle forms opened without an XFA engine).
 */
const isXfaPlaceholderPdf = (filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    const sample = buf.toString('latin1', 0, Math.min(buf.length, 2 * 1024 * 1024));
    return PLACEHOLDER_MARKERS.every((m) => sample.includes(m));
  } catch {
    return true;
  }
};

const isLiveCycleXfa = ({ pdfCreator, pdfProducer, xfaEngine }) => {
  if (xfaEngine === 'livecycle') return true;
  const combined = [pdfCreator, pdfProducer].filter(Boolean).join(' ');
  return /LiveCycle/i.test(combined);
};

module.exports = {
  isXfaPlaceholderPdf,
  isLiveCycleXfa,
  PLACEHOLDER_MARKERS,
};
