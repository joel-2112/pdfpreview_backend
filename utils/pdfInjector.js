const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Injects key-value form fields into a target PDF document and saves it.
 * @param {string} sourcePath - Absolute path to the original PDF template
 * @param {Object} fieldValues - Map of PDF field names to standard values
 * @param {string} outputPath - Absolute path to write the filled PDF copy
 * @returns {Promise<string>} - Absolute path of the newly written file
 */
const injectData = async (sourcePath, fieldValues, outputPath) => {
  try {
    const pdfBytes = fs.readFileSync(sourcePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    // Strip the XFA stream from the Catalog if present to ensure browser compatibility
    try {
      const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
      if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
        acroForm.delete(PDFName.of('XFA'));
        logger.info('Successfully detected and stripped /XFA reference from standard catalog to enable browser rendering.');
      }
    } catch (err) {
      logger.warn(`Non-blocking warning while stripping XFA from catalog: ${err.message}`);
    }

    const form = pdfDoc.getForm();
    
    Object.entries(fieldValues).forEach(([fieldName, value]) => {
      try {
        const field = form.getField(fieldName);
        if (!field) return;
        
        const typeStr = field.constructor.name;
        
        if (typeStr.includes('PDFTextField')) {
          field.setText(String(value));
        } else if (typeStr.includes('PDFCheckBox')) {
          if (value === true || value === 'true' || value === 'yes' || value === 'checked' || value === '1' || value === 'on') {
            field.check();
          } else {
            field.uncheck();
          }
        } else if (typeStr.includes('PDFRadioGroup')) {
          field.select(String(value));
        } else if (typeStr.includes('PDFDropdown') || typeStr.includes('PDFOptionList')) {
          field.select(String(value));
        }
      } catch (err) {
        logger.warn(`Failed to inject value into field "${fieldName}": ${err.message}`);
      }
    });
    
    const filledPdfBytes = await pdfDoc.save();
    
    // Ensure destination directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, filledPdfBytes);
    logger.info(`Successfully injected data and saved filled PDF: ${outputPath}`);
    
    return outputPath;
  } catch (error) {
    logger.error(`Error in pdfInjector service: ${error.message}`);
    throw new Error(`Failed to inject data into PDF: ${error.message}`);
  }
};

module.exports = {
  injectData
};
