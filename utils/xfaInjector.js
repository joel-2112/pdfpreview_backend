const { PDFDocument, PDFName, PDFArray, PDFDict, PDFStream } = require('pdf-lib');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const fs = require('fs');
const zlib = require('zlib');
const util = require('util');

const inflateAsync = util.promisify(zlib.inflate);
const deflateAsync = util.promisify(zlib.deflate);

/**
 * Extracts and injects data into XFA XML datasets within a PDF.
 */

const getXfaDatasetsStream = async (pdfDoc) => {
  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  if (!acroForm || !(acroForm instanceof PDFDict)) return null;

  const xfa = acroForm.lookup(PDFName.of('XFA'));
  if (!xfa) return null;

  let xfaArray = [];
  if (xfa instanceof PDFArray) {
    xfaArray = xfa.array;
  } else if (xfa instanceof PDFStream) {
    // Sometimes XFA is just a single stream
    return { streamRef: acroForm.get(PDFName.of('XFA')), xfaEntry: xfa };
  }

  // Look for 'datasets' in the array
  for (let i = 0; i < xfaArray.length; i += 2) {
    const nameStr = xfaArray[i].name || xfaArray[i].value;
    if (nameStr === 'datasets' && i + 1 < xfaArray.length) {
      return {
        streamRef: xfaArray[i + 1],
        xfaEntry: pdfDoc.context.lookup(xfaArray[i + 1])
      };
    }
  }

  // If 'datasets' not found, maybe there's just a 'template' or single stream
  return null;
};

const extractXfaXml = async (xfaEntry) => {
  let content;
  if (xfaEntry.getContentsString) {
    content = xfaEntry.getContentsString();
  } else {
    // Fallback if raw
    const bytes = xfaEntry.getContents();
    content = Buffer.from(bytes).toString('utf-8');
  }
  return content;
};

/**
 * Recursively updates XML nodes whose tag names match the keys in injectValues.
 */
const updateXmlData = (xmlObj, injectValues) => {
  let modified = false;
  if (!xmlObj || typeof xmlObj !== 'object') return modified;

  for (const key of Object.keys(xmlObj)) {
    if (key === '?' || key === ':@') continue;

    // Check if this key matches a mapped field
    if (injectValues[key] !== undefined) {
      // If it's a leaf node, update it directly
      if (typeof xmlObj[key] === 'string' || typeof xmlObj[key] === 'number' || typeof xmlObj[key] === 'boolean' || xmlObj[key] === '') {
        xmlObj[key] = injectValues[key];
        modified = true;
      } else if (typeof xmlObj[key] === 'object' && xmlObj[key] !== null) {
         // XFA sometimes stores text in #text
         if (xmlObj[key]['#text'] !== undefined || Object.keys(xmlObj[key]).length === 0) {
             xmlObj[key]['#text'] = injectValues[key];
             modified = true;
         } else {
             // Continue searching inside
             if (updateXmlData(xmlObj[key], injectValues)) modified = true;
         }
      }
    } else {
      if (updateXmlData(xmlObj[key], injectValues)) modified = true;
    }
  }
  return modified;
};

const injectXfaData = async (pdfDoc, injectValues) => {
  const ds = await getXfaDatasetsStream(pdfDoc);
  if (!ds || !ds.xfaEntry) {
    return false; // No XFA datasets found
  }

  const { streamRef, xfaEntry } = ds;
  const rawContent = await extractXfaXml(xfaEntry);

  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false, // keep as strings
    cdataPropName: "__cdata" // in case there's cdata
  });
  
  const xmlObj = parser.parse(rawContent);

  // Apply injections
  const wasModified = updateXmlData(xmlObj, injectValues);

  if (wasModified) {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: false,
      suppressEmptyNode: true,
      cdataPropName: "__cdata"
    });
    const newXml = builder.build(xmlObj);

    // Replace the stream content
    // We create a new flate encoded stream
    const newBytes = Buffer.from(newXml, 'utf-8');
    const compressed = await deflateAsync(newBytes);
    
    // Create new PDFStream using pdf-lib context
    const newStream = pdfDoc.context.flateStream(newBytes);
    
    // Replace the old stream reference in the document context
    pdfDoc.context.assign(streamRef, newStream);
    return true;
  }

  return false;
};

const extractXfaFields = async (pdfDoc) => {
  const ds = await getXfaDatasetsStream(pdfDoc);
  if (!ds || !ds.xfaEntry) return [];

  const rawContent = await extractXfaXml(ds.xfaEntry);
  const parser = new XMLParser({ ignoreAttributes: false });
  const xmlObj = parser.parse(rawContent);

  const fields = [];
  const traverse = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key === '?' || key === ':@') continue;
      
      // If it's a leaf node
      if (typeof obj[key] === 'string' || typeof obj[key] === 'number' || typeof obj[key] === 'boolean' || obj[key] === '') {
        // Avoid duplicate field names if possible, or just push
        if (!fields.find(f => f.name === key)) {
          fields.push({ name: key, type: 'xfa-text', value: String(obj[key]) });
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (obj[key]['#text'] !== undefined || Object.keys(obj[key]).length === 0) {
          if (!fields.find(f => f.name === key)) {
             fields.push({ name: key, type: 'xfa-text', value: String(obj[key]['#text'] || '') });
          }
        } else {
          traverse(obj[key]);
        }
      }
    }
  };
  
  // Find the data node to start traversing (usually <xfa:datasets><xfa:data>...)
  // But we can just traverse everything
  traverse(xmlObj);
  return fields;
};

module.exports = {
  injectXfaData,
  getXfaDatasetsStream,
  extractXfaFields
};
