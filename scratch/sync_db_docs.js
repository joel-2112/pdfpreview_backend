require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Document = require('../models/Document.model');
const { parsePdf } = require('../utils/pdfParser');
const path = require('path');
const fs = require('fs');

async function syncAllDocs() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pdf_preview');
  console.log("Connected to Mongo");

  const docs = await Document.find({});
  console.log(`Found ${docs.length} documents in database.`);

  for (const doc of docs) {
    const fullPath = path.isAbsolute(doc.path) ? doc.path : path.join(process.cwd(), doc.path);
    if (fs.existsSync(fullPath)) {
      console.log(`Analyzing ${doc.originalName} at ${fullPath}...`);
      const analysis = await parsePdf(fullPath);
      if (analysis && analysis.fields) {
        doc.fields = analysis.fields;
        doc.hasXfa = Boolean(analysis.hasXfa);
        doc.type = analysis.type;
        doc.xfaEngine = analysis.xfaEngine;
        doc.pdfTitle = analysis.pdfTitle;
        await doc.save();
        console.log(`Updated ${doc.originalName}: ${analysis.fields.length} rich fields saved!`);
      }
    } else {
      console.log(`File does not exist: ${fullPath}`);
    }
  }

  await mongoose.disconnect();
  console.log("Finished sync.");
}

syncAllDocs().catch(console.error);
