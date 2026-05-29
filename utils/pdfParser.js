const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const fs = require('fs');

/**
 * Parses a PDF file to detect form type and extract form fields.
 * @param {string} filePath - Absolute path to the PDF file
 * @returns {Promise<{type: string, fields: Array<{name: string, type: string, value: string}>}>}
 */
const parsePdf = async (filePath) => {
  const pdfBytes = fs.readFileSync(filePath);
  
  // 1. Search for XFA tags in the file buffer (very reliable static signature scan)
  const pdfString = pdfBytes.toString('utf-8', 0, Math.min(pdfBytes.length, 5 * 1024 * 1024));
  const isXfa = pdfString.includes('/XFA') || pdfString.includes('<xfa:') || pdfString.includes('xfa:datasets');
  
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (error) {
    throw new Error(`Failed to read PDF document binary: ${error.message}`);
  }
  
  let stripped = false;
  try {
    // 1. Delete NeedsRendering from the Catalog root
    if (pdfDoc.catalog.has(PDFName.of('NeedsRendering'))) {
      pdfDoc.catalog.delete(PDFName.of('NeedsRendering'));
      stripped = true;
    }
    
    // 2. Delete XFA and NeedsRendering from the AcroForm sub-dictionary
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm instanceof PDFDict) {
      if (acroForm.has(PDFName.of('XFA'))) {
        acroForm.delete(PDFName.of('XFA'));
        stripped = true;
      }
      if (acroForm.has(PDFName.of('NeedsRendering'))) {
        acroForm.delete(PDFName.of('NeedsRendering'));
        stripped = true;
      }
    }
  } catch (err) {
    // Non-blocking warning
  }

  const form = pdfDoc.getForm();
  const fields = form.getFields();
  
  let type = 'flat';
  if (fields.length > 0) {
    type = 'AcroForm';
  } else if (isXfa) {
    type = 'XFA';
  }
  
  const extractedFields = fields.map(field => {
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
  
  if (stripped) {
    try {
      const cleanedBytes = await pdfDoc.save();
      fs.writeFileSync(filePath, cleanedBytes);
    } catch (saveErr) {
      // Non-blocking fallback
    }
  }

  return {
    type,
    fields: extractedFields
  };
};

module.exports = {
  parsePdf
};
