const { PDFDocument, PDFName, PDFDict, PDFHexString } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Check if a string contains characters outside WinAnsi (Latin-1) range.
 * WinAnsi covers U+0020 to U+00FF, plus € (U+20AC).
 * Any character above U+00FF except € requires UTF-16BE.
 */
function needsUtf16(str) {
    if (!str) return false;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code > 0xFF && code !== 0x20AC) {
            return true;
        }
    }
    return false;
}

/**
 * Convert a string to UTF-16BE hex representation with BOM (FEFF).
 * @param {string} str - Input text
 * @returns {string} Hex string like "FEFF00410042..."
 */
function toUtf16Hex(str) {
    let hex = 'FEFF'; // UTF-16BE BOM
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
    return hex;
}

/**
 * Injects key-value form fields into a target PDF document and saves it.
 * Supports Unicode characters via UTF-16BE encoding.
 */
const injectData = async (sourcePath, fieldValues, outputPath) => {
    try {
        const pdfBytes = fs.readFileSync(sourcePath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

        const form = pdfDoc.getForm();
        const acroFields = form.getFields();

        // Strip XFA from hybrid PDFs (existing logic)
        if (acroFields.length > 0) {
            try {
                const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
                if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
                    acroForm.delete(PDFName.of('XFA'));
                    logger.info('Stripped /XFA from hybrid AcroForm PDF for browser-compatible output.');
                }
            } catch (err) {
                logger.warn(`Non-blocking warning while stripping XFA from catalog: ${err.message}`);
            }
        } else {
            logger.warn('PDF has XFA but no AcroForm fields. Use Adobe PDF Services or pdftk to flatten before preview.');
        }

        // Process each field
        for (const [fieldName, value] of Object.entries(fieldValues)) {
            try {
                const field = form.getField(fieldName);
                if (!field) continue;

                const typeStr = field.constructor.name;

                if (typeStr.includes('PDFTextField')) {
                    const stringValue = String(value);
                    if (needsUtf16(stringValue)) {
                        // Encode as UTF-16BE hex string
                        const hexStr = toUtf16Hex(stringValue);
                        const hexString = PDFHexString.fromString(hexStr);
                        // Directly set the field's /V entry to the hex string
                        field.acroField.setValue(hexString);
                        // Also set the appearance stream to avoid rendering issues
                        field.acroField.setDefaultAppearance('/Helvetica 0 Tf 0 g');
                        logger.debug(`Set UTF-16BE for field "${fieldName}": ${stringValue}`);
                    } else {
                        field.setText(stringValue);
                    }
                } else if (typeStr.includes('PDFCheckBox')) {
                    const isChecked = (value === true || value === 'true' || value === 'yes' || value === 'checked' || value === '1' || value === 'on');
                    if (isChecked) {
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
        }

        const filledPdfBytes = await pdfDoc.save();
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

module.exports = { injectData };