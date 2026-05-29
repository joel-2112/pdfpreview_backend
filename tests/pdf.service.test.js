const { analyzePdf } = require('../services/pdf.service');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

describe('PDF Service - Structure Analysis', () => {
  const tempPdfPath = path.join(__dirname, 'temp-test-form.pdf');

  beforeAll(async () => {
    // Generate a physical mock interactive PDF form using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    const form = pdfDoc.getForm();

    // 1. Create a Text Field
    const textField = form.createTextField('firstName');
    textField.setText('Jane');
    textField.addToPage(page, { x: 50, y: 300, width: 200, height: 30 });

    // 2. Create a Checkbox
    const checkbox = form.createCheckBox('agreeToTerms');
    checkbox.check();
    checkbox.addToPage(page, { x: 50, y: 250, width: 30, height: 30 });

    const pdfBytes = await pdfDoc.save();
    
    // Ensure temp tests folder exists
    const dir = path.dirname(tempPdfPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(tempPdfPath, pdfBytes);
  });

  afterAll(() => {
    // Clean up temporary template PDF file
    if (fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }
  });

  it('should correctly classify an AcroForm template and extract its inputs', async () => {
    const analysis = await analyzePdf(tempPdfPath);
    
    expect(analysis.type).toBe('AcroForm');
    expect(analysis.fields).toHaveLength(2);
    
    // Assert Text Field parsing
    const parsedText = analysis.fields.find(f => f.name === 'firstName');
    expect(parsedText).toBeDefined();
    expect(parsedText.type).toBe('text');
    expect(parsedText.value).toBe('Jane');
    
    // Assert Checkbox parsing
    const parsedCheck = analysis.fields.find(f => f.name === 'agreeToTerms');
    expect(parsedCheck).toBeDefined();
    expect(parsedCheck.type).toBe('checkbox');
    expect(parsedCheck.value).toBe('true');
  });

  it('should strip XFA dictionary key on-the-fly and preserve fields', async () => {
    const { PDFName } = require('pdf-lib');
    const xfaPdfPath = path.join(__dirname, 'temp-xfa-form.pdf');
    const filledXfaPath = path.join(__dirname, 'temp-xfa-filled.pdf');

    // 1. Create a hybrid XFA PDF document
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    const form = pdfDoc.getForm();
    const textField = form.createTextField('fullName');
    textField.addToPage(page, { x: 50, y: 300, width: 200, height: 30 });
    
    // Add /XFA stream to AcroForm catalog
    let acroForm = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    if (!acroForm) {
      acroForm = pdfDoc.context.obj({});
      pdfDoc.catalog.set(PDFName.of('AcroForm'), acroForm);
    } else {
      acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    }
    acroForm.set(PDFName.of('XFA'), pdfDoc.context.obj([])); // mock XFA key
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(xfaPdfPath, pdfBytes);

    try {
      // 2. Analyze the hybrid XFA PDF (should be recognized as AcroForm due to presence of fields)
      const analysis = await analyzePdf(xfaPdfPath);
      expect(analysis.type).toBe('AcroForm');
      expect(analysis.fields).toHaveLength(1);

      // 3. Inject data, which triggers stripping the XFA catalog key
      const { injectData } = require('../utils/pdfInjector');
      await injectData(xfaPdfPath, { fullName: 'John Tester' }, filledXfaPath);

      // 4. Load the filled PDF and assert that XFA has been stripped
      const filledBytes = fs.readFileSync(filledXfaPath);
      const filledDoc = await PDFDocument.load(filledBytes);
      const filledAcroForm = filledDoc.catalog.lookup(PDFName.of('AcroForm'));
      
      expect(filledAcroForm).toBeDefined();
      expect(filledAcroForm.has(PDFName.of('XFA'))).toBe(false); // XFA key is stripped!
      
      const filledForm = filledDoc.getForm();
      expect(filledForm.getTextField('fullName').getText()).toBe('John Tester');

    } finally {
      // Clean up temporary files
      if (fs.existsSync(xfaPdfPath)) fs.unlinkSync(xfaPdfPath);
      if (fs.existsSync(filledXfaPath)) fs.unlinkSync(filledXfaPath);
    }
  });
});

