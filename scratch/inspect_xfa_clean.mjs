import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
const pdfjs = await import(pdfjsPath);

async function inspectAll() {
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
          radioGroups.set(groupKey, {
            name: groupKey,
            dataId: dataId || groupKey,
            type: 'radio',
            label: ariaLabel.replace(/^Indicate (Yes|No) to (the )?/i, '').trim() || groupKey,
            options: [],
            value: '',
          });
        }
        const group = radioGroups.get(groupKey);
        group.options.push({
          label: ariaLabel.startsWith('Indicate Yes') ? 'Yes' : (ariaLabel.startsWith('Indicate No') ? 'No' : (node.attributes?.xfaOn || 'Selected')),
          value: node.attributes?.xfaOn || 'Y',
        });
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

      if (identifier) {
        // Clean display label
        let cleanLabel = ariaLabel;
        if (!cleanLabel && dataId) {
          cleanLabel = dataId.replace(/\d+$/, '').replace(/([A-Z])/g, ' $1').trim();
        }

        extractedFields.push({
          name: identifier,
          dataId: dataId || identifier,
          fieldId: fieldId || '',
          label: cleanLabel || identifier,
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
    extractedFields.push(group);
  }

  console.log("Total unique structured fields extracted:", extractedFields.length);
  console.log("First 10 extracted fields:\n", JSON.stringify(extractedFields.slice(0, 10), null, 2));
}

inspectAll().catch(console.error);
