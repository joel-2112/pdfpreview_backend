const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const User = require('../models/User.model');
const Document = require('../models/Document.model');
const FieldMap = require('../models/FieldMap.model');
const { autofillDocument } = require('../services/autofill.service');

describe('Autofill Service - Integration Test', () => {
  let mongoServer;
  const originalPdfPath = path.join(__dirname, 'original-test.pdf');
  let filledPdfPath;

  beforeAll(async () => {
    // 1. Fire up a virtual in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // 2. Create the mock template PDF on disk
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    const form = pdfDoc.getForm();
    
    const fNameField = form.createTextField('pdf_first_name');
    fNameField.addToPage(page, { x: 50, y: 300, width: 200, height: 30 });
    
    const lNameField = form.createTextField('pdf_last_name');
    lNameField.addToPage(page, { x: 50, y: 250, width: 200, height: 30 });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(originalPdfPath, pdfBytes);
  });

  afterAll(async () => {
    // Purge physical PDF files
    if (fs.existsSync(originalPdfPath)) {
      fs.unlinkSync(originalPdfPath);
    }
    if (filledPdfPath && fs.existsSync(filledPdfPath)) {
      fs.unlinkSync(filledPdfPath);
    }
    
    // Disconnect DB
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('should resolve mappings, fill fields with User Profile data, and write a valid PDF', async () => {
    // 1. Seed database with User Profile data
    const user = await User.create({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
      profileData: {
        firstName: 'John',
        lastName: 'Doe'
      }
    });

    // 2. Seed Document configuration
    const doc = await Document.create({
      user: user._id,
      originalName: 'test-form.pdf',
      filename: 'original-test.pdf',
      path: originalPdfPath,
      size: fs.statSync(originalPdfPath).size,
      type: 'AcroForm',
      status: 'processed',
      fields: [
        { name: 'pdf_first_name', type: 'text', value: '' },
        { name: 'pdf_last_name', type: 'text', value: '' }
      ]
    });

    // 3. Setup mappings (pdf field ➔ user profile key)
    const fieldMap = await FieldMap.create({
      user: user._id,
      document: doc._id,
      mappings: {
        pdf_first_name: 'firstName',
        pdf_last_name: 'lastName'
      }
    });

    // 4. Trigger the Autofill Service
    filledPdfPath = await autofillDocument(doc._id, user._id);
    expect(fs.existsSync(filledPdfPath)).toBe(true);

    // 5. Verify the injected data by parsing the output PDF
    const filledBytes = fs.readFileSync(filledPdfPath);
    const filledDoc = await PDFDocument.load(filledBytes);
    const filledForm = filledDoc.getForm();
    
    const fNameFieldInjected = filledForm.getTextField('pdf_first_name');
    const lNameFieldInjected = filledForm.getTextField('pdf_last_name');
    
    expect(fNameFieldInjected.getText()).toBe('John');
    expect(lNameFieldInjected.getText()).toBe('Doe');
  });
});
