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
      const radioGroups = new Map();
      const seenNames = new Set();

      const formatFieldLabel = (ariaLabel, dataId, fieldId) => {
        if (ariaLabel && ariaLabel.trim()) {
          return ariaLabel.trim().replace(/\s+/g, ' ');
        }
        if (dataId) {
          return dataId.replace(/\d+$/, '').replace(/([A-Z])/g, ' $1').trim();
        }
        return fieldId || 'Field';
      };

      // 1. Extract from allXfaHtml if XFA
      if (isXfa || isLiveCycle) {
        if (doc.allXfaHtml) {
          const walk = (node, parentLabel = '') => {
            if (!node || typeof node !== 'object') return;

            let currentLabel = node.attributes?.['aria-label'] || node.attributes?.title || parentLabel;

            if (node.name === 'input' || node.name === 'select' || node.name === 'textarea') {
              const type = node.name === 'input' ? (node.attributes?.type || 'text') : node.name;
              const dataId = node.attributes?.dataId;
              const fieldId = node.attributes?.fieldId;
              const nameAttr = node.attributes?.name;
              const ariaLabel = node.attributes?.['aria-label'] || '';

              const identifier = dataId || nameAttr || fieldId || node.attributes?.id;

              if (type === 'radio') {
                const groupKey = dataId || nameAttr || 'radio_group';
                if (!radioGroups.has(groupKey)) {
                  let cleanGroupLabel = ariaLabel
                    .replace(/^Indicate (Yes|No) to (the )?/i, '')
                    .replace(/^Indicate /i, '')
                    .trim();
                  if (!cleanGroupLabel && dataId) {
                    cleanGroupLabel = formatFieldLabel('', dataId, fieldId);
                  }
                  radioGroups.set(groupKey, {
                    name: groupKey,
                    dataId: dataId || groupKey,
                    fieldId: fieldId || '',
                    type: 'radio',
                    label: cleanGroupLabel || groupKey,
                    options: [],
                    value: '',
                  });
                }
                const group = radioGroups.get(groupKey);
                const optLabel = ariaLabel.startsWith('Indicate Yes')
                  ? 'Yes'
                  : ariaLabel.startsWith('Indicate No')
                  ? 'No'
                  : (node.attributes?.xfaOn || 'Selected');
                const optVal = node.attributes?.xfaOn || 'Y';
                if (!group.options.some((o) => o.value === optVal)) {
                  group.options.push({ label: optLabel, value: optVal });
                }
                return;
              }

              // Collect select options
              let choices = [];
              if (node.name === 'select' && Array.isArray(node.children)) {
                node.children.forEach((opt) => {
                  if (opt.name === 'option') {
                    const optVal = opt.attributes?.value || '';
                    const optText = (opt.children && opt.children[0] && typeof opt.children[0] === 'string') ? opt.children[0] : optVal;
                    if (optVal || optText) {
                      choices.push({ value: optVal, label: optText });
                    }
                  }
                });
              }

              if (identifier && !seenNames.has(identifier)) {
                seenNames.add(identifier);
                const cleanLabel = formatFieldLabel(ariaLabel, dataId, fieldId);

                extractedFields.push({
                  name: identifier,
                  dataId: dataId || identifier,
                  fieldId: fieldId || '',
                  label: cleanLabel,
                  type: type === 'select' ? 'choice' : (type === 'textarea' ? 'text' : type),
                  value: node.attributes?.value || '',
                  choices: choices.length > 0 ? choices : undefined,
                  required: Boolean(node.attributes?.required || node.attributes?.['aria-required']),
                  maxLength: node.attributes?.maxLength || null,
                });
              }
            }

            if (Array.isArray(node.children)) {
              node.children.forEach((c) => walk(c, currentLabel));
            }
          };

          walk(doc.allXfaHtml);

          // Append collected radio groups
          for (const group of radioGroups.values()) {
            if (!seenNames.has(group.name)) {
              seenNames.add(group.name);
              extractedFields.push(group);
            }
          }
        }
      }

      // 2. Extract standard AcroForm annotations if any
      if (extractedFields.length === 0) {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const annots = await page.getAnnotations();
          for (const a of annots) {
            if (a.fieldName && !seenNames.has(a.fieldName)) {
              seenNames.add(a.fieldName);
              extractedFields.push({
                name: a.fieldName,
                dataId: a.fieldName,
                label: a.alternativeText || a.fieldName,
                type: a.fieldType ? a.fieldType.toLowerCase() : 'text',
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
