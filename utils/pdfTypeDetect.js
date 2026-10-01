const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { PDFName, PDFDict, PDFArray } = require('pdf-lib');

const scanPdfHeader = (absolutePath) => {
  const buf = fs.readFileSync(absolutePath);
  const sample = buf.toString('latin1', 0, Math.min(buf.length, 5 * 1024 * 1024));
  const isXfa =
    sample.includes('/XFA') ||
    sample.includes('<xfa:') ||
    sample.includes('xfa:datasets');
  const liveCycle = /LiveCycle/i.test(sample);
  const immForm = /IMM\s*1295/i.test(sample) || /IMM\s*5257/i.test(sample) || /IMM\s*5707/i.test(sample);
  return { isXfa, liveCycle, immForm };
};

const extractXfaFieldsFromXml = (xmlString) => {
  if (!xmlString) return [];
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    });
    const parsedXml = parser.parse(xmlString);
    const extractedFields = [];

    const walk = (node, currentPath = '') => {
      if (!node || typeof node !== 'object') return;

      for (const [key, val] of Object.entries(node)) {
        if (key.startsWith('@_')) continue;

        if (key === 'field') {
          const fieldItems = Array.isArray(val) ? val : [val];
          for (const item of fieldItems) {
            const fieldName = item['@_name'] || 'unnamedField';
            let fieldType = 'text';
            if (item.ui) {
              if (item.ui.checkButton) fieldType = 'checkbox';
              else if (item.ui.choiceList) fieldType = 'choice';
              else if (item.ui.dateTimeEdit) fieldType = 'date';
              else if (item.ui.numericEdit) fieldType = 'numeric';
              else if (item.ui.button) fieldType = 'button';
            }
            const fullPath = currentPath ? `${currentPath}.${fieldName}` : fieldName;
            
            let defaultValue = '';
            if (item.value) {
              if (typeof item.value === 'object') {
                defaultValue = item.value['#text'] || item.value.text || '';
              } else {
                defaultValue = String(item.value);
              }
            }

            extractedFields.push({
              name: fullPath,
              type: fieldType,
              value: defaultValue,
            });
          }
        } else if (key === 'subform') {
          const subforms = Array.isArray(val) ? val : [val];
          for (const sub of subforms) {
            const subName = sub['@_name'];
            const nextPath = subName ? (currentPath ? `${currentPath}.${subName}` : subName) : currentPath;
            walk(sub, nextPath);
          }
        } else if (typeof val === 'object') {
          walk(val, currentPath);
        }
      }
    };

    walk(parsedXml);
    return extractedFields;
  } catch (e) {
    return [];
  }
};

const extractXfaFields = async (pdfDoc, pdfBytes) => {
  let xdpXml = '';
  try {
    if (pdfDoc && pdfDoc.catalog) {
      const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
      if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
        const xfa = acroForm.lookup(PDFName.of('XFA'));
        if (xfa instanceof PDFArray) {
          for (let i = 0; i < xfa.size(); i += 2) {
            const nameObj = xfa.get(i);
            const streamObj = xfa.lookup(i + 1);
            const partName = nameObj?.asString ? nameObj.asString() : (nameObj?.value || String(nameObj));
            if (streamObj && typeof streamObj.getContents === 'function') {
              const str = Buffer.from(streamObj.getContents()).toString('utf-8');
              if (partName.includes('template') || str.includes('<template')) {
                xdpXml += str;
              }
            }
          }
        } else if (xfa && typeof xfa.getContents === 'function') {
          xdpXml = Buffer.from(xfa.getContents()).toString('utf-8');
        }
      }
    }
  } catch (err) {}

  if (!xdpXml && pdfBytes) {
    const raw = Buffer.isBuffer(pdfBytes) ? pdfBytes.toString('latin1') : String(pdfBytes);
    const match = raw.match(/<xdp:xdp[\s\S]*?<\/xdp:xdp>/i) || raw.match(/<template[\s\S]*?<\/template>/i);
    if (match) xdpXml = match[0];
  }

  return extractXfaFieldsFromXml(xdpXml);
};

/**
 * Repair MongoDB metadata for uploads that pre-date XFA detection fields or were misclassified.
 */
const syncDocumentXfaMetadata = async (doc) => {
  const absolutePath = path.isAbsolute(doc.path)
    ? doc.path
    : path.join(process.cwd(), doc.path);

  if (!fs.existsSync(absolutePath)) {
    return doc;
  }

  const { isXfa, liveCycle, immForm } = scanPdfHeader(absolutePath);

  // If already properly recognized and has fields, return
  if (doc.type === 'XFA' && doc.hasXfa && doc.fields && doc.fields.length > 0) {
    return doc;
  }

  // If detected via header scan or if misclassified as flat
  if (isXfa || liveCycle || immForm || doc.type === 'flat' || !doc.fields || doc.fields.length === 0) {
    try {
      const { parsePdf } = require('./pdfParser');
      const analysis = await parsePdf(absolutePath);
      if (analysis) {
        let changed = false;
        if (analysis.hasXfa && !doc.hasXfa) {
          doc.hasXfa = true;
          changed = true;
        }
        if (analysis.type && doc.type !== analysis.type) {
          doc.type = analysis.type;
          changed = true;
        }
        if (analysis.xfaEngine && doc.xfaEngine !== analysis.xfaEngine) {
          doc.xfaEngine = analysis.xfaEngine;
          changed = true;
        }
        if (analysis.pdfTitle && !doc.pdfTitle) {
          doc.pdfTitle = analysis.pdfTitle;
          changed = true;
        }
        if (analysis.fields && analysis.fields.length > 0 && (!doc.fields || doc.fields.length === 0)) {
          doc.fields = analysis.fields;
          changed = true;
        }
        if (changed) {
          await doc.save();
        }
      }
    } catch (e) {}
  }

  return doc;
};

module.exports = {
  scanPdfHeader,
  extractXfaFields,
  extractXfaFieldsFromXml,
  syncDocumentXfaMetadata,
};
