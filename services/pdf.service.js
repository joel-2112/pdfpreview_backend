const { parsePdf } = require('../utils/pdfParser');
const logger = require('../utils/logger');

/**
 * High-level orchestration for PDF structural analysis.
 * @param {string} filePath - Absolute path to the template PDF
 * @returns {Promise<{type: string, fields: Array}>}
 */
const analyzePdf = async (filePath) => {
  try {
    logger.info(`Analyzing PDF structure: ${filePath}`);
    const analysisResult = await parsePdf(filePath);
    logger.info(`Analysis complete. Detected form type: ${analysisResult.type} with ${analysisResult.fields.length} interactive fields.`);
    return analysisResult;
  } catch (error) {
    logger.error(`Error in pdfService.analyzePdf: ${error.message}`);
    throw new Error(`Failed to parse PDF metadata: ${error.message}`);
  }
};

module.exports = {
  analyzePdf
};
