const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const fs = require('fs');
const { extractXfaFields } = require('./xfaInjector');

const pickPdfInfoString = (pdfString, key) => {
  const paren = pdfString.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`));
  if (paren) {
    return paren[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
  }
  return null;
};

const parsePdf = async (filePath) => {
  const pdfBytes = fs.readFileSync(filePath);
  
  // 1. Search for XFA tags in the file buffer (very reliable static signature scan)
  const pdfString = pdfBytes.toString('latin1', 0, Math.min(pdfBytes.length, 5 * 1024 * 1024));
  const isXfa = pdfString.includes('/XFA') || pdfString.includes('<xfa:') || pdfString.includes('xfa:datasets');

  const pdfTitle = pickPdfInfoString(pdfString, 'Title');
  const pdfCreator = pickPdfInfoString(pdfString, 'Creator');
  const pdfProducer = pickPdfInfoString(pdfString, 'Producer');
  const liveCycle =
    /LiveCycle/i.test([pdfCreator, pdfProducer].filter(Boolean).join(' '));
  const xfaEngine = isXfa && liveCycle ? 'livecycle' : isXfa ? 'generic' : null;
  
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (error) {
    throw new Error(`Failed to read PDF document binary: ${error.message}`);
  }
  
  // Detect XFA in catalog (hybrid PDFs may also have AcroForm fields)
  let hasXfaInCatalog = false;
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
      hasXfaInCatalog = true;
    }
  } catch (err) {
    // Non-blocking
  }

  const form = pdfDoc.getForm();
  const fields = form.getFields();
  
  const hasXfa = isXfa || hasXfaInCatalog;

  // LiveCycle / pure XFA must not be classified as AcroForm (Adobe Embed shows "Please wait…")
  let type = 'flat';
  if (hasXfa && (liveCycle || fields.length === 0)) {
    type = 'XFA';
  } else if (fields.length > 0) {
    type = 'AcroForm';
  } else if (hasXfa) {
    type = 'XFA';
  }
  
  let extractedFields = fields.map(field => {
    const name = field.getName();
    const typeStr = field.constructor.name;
    let fieldType = 'unknown';
    let value = '';
    
    if (typeStr.includes('PDFTextField')) {
      fieldType = 'text';
      try { value = field.getText() || ''; } catch (e) {}
    } else if (typeStr.includes('PDFCheckBox')) {
      fieldType = 'checkbox';
      try { value = field.isChecked() ? 'true' : 'false'; } catch (e) {}
    } else if (typeStr.includes('PDFDropdown')) {
      fieldType = 'choice';
      try { value = field.getSelected() ? field.getSelected().join(',') : ''; } catch (e) {}
    } else if (typeStr.includes('PDFOptionList')) {
      fieldType = 'choice';
      try { value = field.getSelected() ? field.getSelected().join(',') : ''; } catch (e) {}
    } else if (typeStr.includes('PDFRadioGroup')) {
      fieldType = 'radio';
      try { value = field.getSelected() || ''; } catch (e) {}
    } else if (typeStr.includes('PDFButton')) {
      fieldType = 'button';
    }
    
    return { name, type: fieldType, value };
  });

  if (type === 'XFA' && extractedFields.length === 0) {
    try {
      const { extractXfaFields } = require('./xfaInjector');
      const xfaFields = await extractXfaFields(pdfDoc);
      extractedFields = xfaFields;
    } catch (err) {
      console.warn('Could not extract pure XFA fields:', err.message);
    }
  }
  
  return {
    type,
    hasXfa,
    xfaEngine,
    pdfTitle,
    pdfCreator,
    pdfProducer,
    fields: extractedFields,
  };
};

module.exports = {
  parsePdf
};
