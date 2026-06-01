// services/formvu.service.js
const IDRCloudClient = require('@idrsolutions/idrcloudclient');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const FORM_VU_ENDPOINT = 'https://cloud.idrsolutions.com/cloud/' + IDRCloudClient.FORMVU;

/**
 * Convert an XFA PDF to an interactive HTML form using FormVu cloud API.
 * @param {string} inputPdfPath - Absolute path to the XFA PDF file.
 * @param {string} outputDir - Directory where the HTML output should be saved.
 * @returns {Promise<string>} - Path to the generated HTML file.
 */
const convertXfaToHtml = (inputPdfPath, outputDir) => {
    return new Promise((resolve, reject) => {
        // Ensure the output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const parameters = {
            token: 'a2d0a317324485967d727bd55ac78183',
            input: IDRCloudClient.UPLOAD,
            file: inputPdfPath,
        };

        const progressListener = (e) => {
            logger.info(`FormVu conversion progress: ${JSON.stringify(e)}`);
        };

        const failureListener = (e) => {
            logger.error(`FormVu conversion failed: ${e}`);
            reject(new Error(`FormVu conversion failed: ${e}`));
        };

        const successListener = (e) => {
            logger.info(`FormVu conversion successful. Download URL: ${e.downloadUrl}`);
            // The downloadUrl points to a ZIP file containing the HTML and assets.
            // You would need to download and extract it to outputDir.
            // For simplicity, this example assumes you handle that separately.
            resolve(e.downloadUrl);
        };

        IDRCloudClient.convert({
            endpoint: FORM_VU_ENDPOINT,
            parameters: parameters,
            progress: progressListener,
            success: successListener,
            failure: failureListener
        });
    });
};

module.exports = { convertXfaToHtml };