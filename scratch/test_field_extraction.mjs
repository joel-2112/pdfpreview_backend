import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
const pdfjs = await import(pdfjsPath);

function formatFieldLabel(ariaLabel, dataId, fieldId) {
  if (ariaLabel && ariaLabel.trim()) {
    let clean = ariaLabel.trim().replace(/\s+/g, ' ');
    return clean;
  }
  if (dataId) {
    return dataId.replace(/\d+$/, '').replace(/([A-Z])/g, ' $1').trim();
  }
  return fieldId || 'Field';
}

async function testFieldExtraction() {
  const filePath = 'c:/my_files/projects/pdf_preview/backend/uploads/originals/pdf-1790844353223-961855078.pdf';
  const pdfBytes = fs.readFileSync(filePath);
  const data = new Uint8Array(pdfBytes);
  const loadingTask = pdfjs.getDocument({
    data,
    enableXfa: true,
  });

  const doc = await loadingTask.promise;
  const extractedFields = [];
  const radioGroups = new Map();
  const seenNames = new Set();

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
        const optLabel = ariaLabel.startsWith('Indicate Yes') ? 'Yes' : (ariaLabel.startsWith('Indicate No') ? 'No' : (node.attributes?.xfaOn || 'Selected'));
        if (!group.options.some(o => o.value === (node.attributes?.xfaOn || 'Y'))) {
          group.options.push({
            label: optLabel,
            value: node.attributes?.xfaOn || 'Y',
          });
        }
        return;
      }

      // Collect select options
      let choices = [];
      if (node.name === 'select' && Array.isArray(node.children)) {
        node.children.forEach(opt => {
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
      node.children.forEach(c => walk(c, currentLabel));
    }
  };

  if (doc.allXfaHtml) {
    walk(doc.allXfaHtml);
  }

  // Add radio groups
  for (const group of radioGroups.values()) {
    if (!seenNames.has(group.name)) {
      seenNames.add(group.name);
      extractedFields.push(group);
    }
  }

  console.log("Total unique structured fields:", extractedFields.length);
  console.log("Sample of 12 fields:\n", JSON.stringify(extractedFields.slice(0, 12), null, 2));
}

testFieldExtraction().catch(console.error);
