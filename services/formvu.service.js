const IDRCloudClient = require('@idrsolutions/idrcloudclient');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { pipeline } = require('stream/promises');
const stream = require('stream');
const { promisify } = require('util');
const finished = promisify(stream.finished);

const FORM_VU_ENDPOINT = 'https://cloud.idrsolutions.com/cloud/' + IDRCloudClient.FORMVU;

/**
 * Converts an XFA PDF to an interactive HTML form and serves it locally.
 * @param {string} inputPdfPath - Absolute path to the XFA PDF file.
 * @param {string} outputDir - Directory where the HTML output will be saved (e.g., 'formvu_outputs/doc_id').
 * @returns {Promise<string>} - The local URL path to the generated HTML file.
 */
const convertXfaToHtml = async (inputPdfPath, outputDir) => {
    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const parameters = {
        token: 'a2d0a317324485967d727bd55ac78183', // Your personal trial token
        input: IDRCloudClient.UPLOAD,
        file: inputPdfPath,
        outputFormat: 'zip', // Request the output as a ZIP archive
    };

    return new Promise((resolve, reject) => {
        IDRCloudClient.convert({
            endpoint: FORM_VU_ENDPOINT,
            parameters: parameters,
            progress: (e) => logger.info(`FormVu conversion progress: ${JSON.stringify(e)}`),
            failure: (e) => {
                logger.error(`FormVu conversion failed: ${e}`);
                reject(new Error(`FormVu conversion failed: ${e}`));
            },
            success: async (e) => {
                const downloadUrl = e.downloadUrl;
                logger.info(`FormVu conversion successful. Download URL: ${downloadUrl}`);

                try {
                    // 1. Download the ZIP file from the downloadUrl
                    const response = await fetch(downloadUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to download ZIP: ${response.statusText}`);
                    }

                    // 2. Save the ZIP file temporarily
                    const zipPath = path.join(outputDir, 'output.zip');
                    const fileStream = fs.createWriteStream(zipPath);
                    await pipeline(response.body, fileStream);
                    await finished(fileStream);

                    // 3. Extract the ZIP file using the 'unzipper' library
                    const unzipper = require('unzipper');
                    await new Promise((extractResolve, extractReject) => {
                        fs.createReadStream(zipPath)
                            .pipe(unzipper.Extract({ path: outputDir }))
                            .on('close', extractResolve)
                            .on('error', extractReject);
                    });

                    // 4. Clean up: Delete the temporary ZIP file
                    fs.unlinkSync(zipPath);

                    // 5. Locate the main HTML file (assuming it's named 'form.html')
                    const htmlPath = path.join(outputDir, 'form.html');
                    if (!fs.existsSync(htmlPath)) {
                        throw new Error('Converted HTML file (form.html) not found in the extracted archive.');
                    }

                    // 6. Return a local URL path for the frontend to access
                    const localUrl = `/formvu-outputs/${path.basename(outputDir)}/form.html`;
                    logger.info(`FormVu conversion completed and saved locally: ${localUrl}`);
                    resolve(localUrl);
                } catch (error) {
                    logger.error(`Error during post-processing of FormVu conversion: ${error.message}`);
                    reject(new Error(`Failed to process FormVu conversion result: ${error.message}`));
                }
            }
        });
    });
};

module.exports = { convertXfaToHtml };