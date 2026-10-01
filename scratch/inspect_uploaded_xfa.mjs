import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = pathToFileURL(path.resolve(__dirname, '../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
const pdfjs = await import(pdfjsPath);

async function inspect() {
  const filePath = 'c:/my_files/projects/pdf_preview/backend/uploads/originals/pdf-1790844353223-961855078.pdf';
  if (!fs.existsSync(filePath)) {
    console.log("File does not exist:", filePath);
    return;
  }

  const pdfBytes = fs.readFileSync(filePath);
  const data = new Uint8Array(pdfBytes);
  const loadingTask = pdfjs.getDocument({
    data,
    enableXfa: true,
  });

  const doc = await loadingTask.promise;
  console.log("Num pages:", doc.numPages);
  console.log("isPureXfa:", doc.isPureXfa);
  console.log("has allXfaHtml:", Boolean(doc.allXfaHtml));

  let inputs = [];
  const walk = (node, path = '', label = '') => {
    if (!node || typeof node !== 'object') return;
    
    // Check if node has aria-label, title, or caption
    let currentLabel = label;
    if (node.attributes?.['aria-label']) {
      currentLabel = node.attributes['aria-label'];
    } else if (node.attributes?.title) {
      currentLabel = node.attributes.title;
    }

    if (node.name === 'input' || node.name === 'select' || node.name === 'textarea') {
      inputs.push({
        tag: node.name,
        type: node.attributes?.type || node.name,
        name: node.attributes?.name,
        id: node.attributes?.id,
        elementId: node.attributes?.['data-element-id'],
        label: currentLabel || node.attributes?.['aria-label'] || node.attributes?.title || node.attributes?.placeholder || '',
        value: node.attributes?.value || '',
        attributes: node.attributes,
      });
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(c => walk(c, path, currentLabel));
    }
  };

  if (doc.allXfaHtml) {
    walk(doc.allXfaHtml);
    console.log("Total inputs found in allXfaHtml:", inputs.length);
    console.log("First 20 inputs:\n", JSON.stringify(inputs.slice(0, 20), null, 2));
  }
}

inspect().catch(console.error);
