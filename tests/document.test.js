require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const app = require('../app');
const User = require('../models/User.model');
const Document = require('../models/Document.model');

describe('Document REST Endpoints Integration Tests', () => {
  let mongoServer;
  let token;
  let userRecord;
  let documentRecord;
  const testPdfPath = path.join(__dirname, 'endpoint-test.pdf');

  beforeAll(async () => {
    // 1. Startup in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    
    // Check if Mongoose is already connected (to prevent connection collisions)
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }

    // 2. Write a valid mock PDF form on disk for uploading
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([300, 300]);
    const form = pdfDoc.getForm();
    const txtField = form.createTextField('test_field');
    txtField.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(testPdfPath, pdfBytes);

    // 3. Register a test user
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Test',
        email: 'alex@example.com',
        password: 'password123'
      });
      
    token = regRes.body.data.token;
    userRecord = regRes.body.data.user;
  });

  afterAll(async () => {
    // Purge temp file
    if (fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
    
    // Purge any dynamically created uploads
    const uploadsDir = path.join(__dirname, '../uploads/originals');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      files.forEach(file => {
        if (file.startsWith('pdf-')) {
          fs.unlinkSync(path.join(uploadsDir, file));
        }
      });
    }

    const filledDir = path.join(__dirname, '../uploads/filled');
    if (fs.existsSync(filledDir)) {
      const files = fs.readdirSync(filledDir);
      files.forEach(file => {
        if (file.startsWith('filled-')) {
          fs.unlinkSync(path.join(filledDir, file));
        }
      });
    }

    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe('POST /api/documents/upload', () => {
    it('should block requests without a valid JWT token', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .attach('pdf', testPdfPath);
        
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should upload a PDF, parse its form structure, and return success', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('pdf', testPdfPath);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('AcroForm');
      expect(res.body.data.fields).toHaveLength(1);
      expect(res.body.data.fields[0].name).toBe('test_field');

      documentRecord = res.body.data;
    });
  });

  describe('GET /api/documents', () => {
    it('should retrieve all documents matching the authorized user', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/documents/:id', () => {
    it('should fetch a single document metadata record', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentRecord._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id).toBe(documentRecord._id);
    });
  });

  describe('Mappings and Autofill Cycle', () => {
    it('should default retrieve an empty field map', async () => {
      const res = await request(app)
        .get(`/api/autofill/mappings/${documentRecord._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mappings).toEqual({});
    });

    it('should update field mapping links and save correctly', async () => {
      const updateRes = await request(app)
        .put(`/api/autofill/mappings/${documentRecord._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          mappings: {
            test_field: 'user_phone'
          }
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.data.mappings.test_field).toBe('user_phone');
    });

    it('should generate secure access tokens for downloading the original and filled forms', async () => {
      const linkRes = await request(app)
        .get(`/api/documents/${documentRecord._id}/secure-link?type=filled`)
        .set('Authorization', `Bearer ${token}`);

      expect(linkRes.status).toBe(200);
      expect(linkRes.body.success).toBe(true);
      expect(linkRes.body.data.signedUrl).toContain('/api/documents/secure-view?token=');

      // Attempt to fetch file from secure view streaming endpoint
      const streamRes = await request(app)
        .get(linkRes.body.data.signedUrl);

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toBe('application/pdf');
    });
  });

  describe('DELETE /api/documents/:id', () => {
    it('should purge the document and map files', async () => {
      const res = await request(app)
        .delete(`/api/documents/${documentRecord._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify that it is no longer available
      const checkRes = await request(app)
        .get(`/api/documents/${documentRecord._id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(checkRes.status).toBe(404);
    });
  });
});
