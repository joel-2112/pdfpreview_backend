const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const { extractXfaFields } = require('./pdfTypeDetect');

async function getPdfJs() {
  try {
    const p = pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
    return await import(p);
  } catch (e) {
    try {
      return require('pdfjs-dist/legacy/build/pdf.js');
    } catch (e2) {
      return null;
    }
  }
}

const parsePdf = async (filePath) => {
  const pdfBytes = fs.readFileSync(filePath);
  const data = new Uint8Array(pdfBytes);

  try {
    const pdfjs = await getPdfJs();
    if (pdfjs) {
      const loadingTask = pdfjs.getDocument({
        data,
        enableXfa: true,
        useSystemFonts: true,
      });
      
      const doc = await loadingTask.promise;
      const meta = await doc.getMetadata().catch(() => ({ info: {} }));
      const info = meta.info || {};

      const isXfa = Boolean(doc.isPureXfa || info.IsXFAPresent);
      const creator = info.Creator || '';
      const producer = info.Producer || '';
      const isLiveCycle = /LiveCycle/i.test(`${creator} ${producer}`) || /Designer/i.test(`${creator} ${producer}`);
      const xfaEngine = isLiveCycle ? 'livecycle' : (isXfa ? 'generic' : null);

      let extractedFields = [];

      // 1. Extract from allXfaHtml if XFA
      if (isXfa || isLiveCycle) {
        if (doc.allXfaHtml) {
          const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.name === 'input' || node.name === 'select' || node.name === 'textarea') {
              const name = node.attributes?.['data-element-id'] || node.attributes?.id || node.attributes?.name;
              if (name) {
                extractedFields.push({
                  name,
                  type: node.name === 'input' ? (node.attributes?.type || 'text') : node.name,
                  value: node.attributes?.value || '',
                });
              }
            }
            if (Array.isArray(node.children)) {
              node.children.forEach(walk);
            }
          };
          walk(doc.allXfaHtml);
        }
      }

      // 2. Extract standard AcroForm annotations if any
      if (extractedFields.length === 0) {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const annots = await page.getAnnotations();
          for (const a of annots) {
            if (a.fieldName) {
              extractedFields.push({
                name: a.fieldName,
                type: a.fieldType || 'text',
                value: a.fieldValue || '',
              });
            }
          }
        }
      }

      let type = 'flat';
      if (isXfa || isLiveCycle) {
        type = 'XFA';
      } else if (extractedFields.length > 0 || info.IsAcroFormPresent) {
        type = 'AcroForm';
      }

      return {
        type,
        hasXfa: isXfa || isLiveCycle,
        xfaEngine,
        pdfTitle: info.Title || null,
        pdfCreator: creator || null,
        pdfProducer: producer || null,
        numPages: doc.numPages,
        fields: extractedFields,
      };
    }
  } catch (err) {
    // Fallback to pdf-lib parsing if pdfjs-dist encounters an unexpected error
  }

  // Fallback: pdf-lib parsing
  const pdfString = pdfBytes.toString('latin1', 0, Math.min(pdfBytes.length, 5 * 1024 * 1024));
  const isXfa = pdfString.includes('/XFA') || pdfString.includes('<xfa:') || pdfString.includes('xfa:datasets');
  const liveCycle = /LiveCycle/i.test(pdfString) || /Designer/i.test(pdfString);
  const xfaEngine = isXfa && liveCycle ? 'livecycle' : isXfa ? 'generic' : null;

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (error) {
    throw new Error(`Failed to read PDF document binary: ${error.message}`);
  }

  let hasXfaInCatalog = false;
  try {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
      hasXfaInCatalog = true;
    }
  } catch (err) {}

  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const hasXfa = isXfa || hasXfaInCatalog;

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
    } else if (typeStr.includes('PDFDropdown') || typeStr.includes('PDFOptionList')) {
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

  if ((type === 'XFA' || hasXfa) && extractedFields.length === 0) {
    try {
      const xfaFields = await extractXfaFields(pdfDoc, pdfBytes);
      if (xfaFields && xfaFields.length > 0) {
        extractedFields = xfaFields;
      }
    } catch (err) {}
  }

  return {
    type,
    hasXfa,
    xfaEngine,
    pdfTitle: null,
    pdfCreator: null,
    pdfProducer: null,
    fields: extractedFields,
  };
};

module.exports = {
  parsePdf
};
