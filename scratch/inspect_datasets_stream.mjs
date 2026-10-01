import fs from 'fs';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';

async function inspectDatasets() {
  const filePath = 'c:/my_files/projects/pdf_preview/backend/uploads/originals/pdf-1790844353223-961855078.pdf';
  const pdfBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) {
    const xfa = acroForm.lookup(PDFName.of('XFA'));
    console.log("XFA is Array:", xfa instanceof PDFArray);
    if (xfa instanceof PDFArray) {
      for (let i = 0; i < xfa.size(); i += 2) {
        const nameObj = xfa.get(i);
        const partName = nameObj?.asString ? nameObj.asString() : (nameObj?.value || String(nameObj));
        const streamObj = xfa.lookup(i + 1);
        const len = streamObj?.getContents ? streamObj.getContents().length : 0;
        console.log(`XFA part [${i}]: ${partName} (length: ${len})`);
        if (partName === 'datasets') {
          const content = Buffer.from(streamObj.getContents()).toString('utf-8');
          console.log("Datasets content snippet:", content.substring(0, 500));
        }
      }
    }
  }
}

inspectDatasets().catch(console.error);
