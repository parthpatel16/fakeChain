const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const blockchainService = require('./blockchain');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
const certifiedDir = path.join(__dirname, 'certified-documents');
const qrDir = path.join(__dirname, 'qr-codes');
const tempDir = path.join(__dirname, 'temp');

[uploadsDir, certifiedDir, qrDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created: ${dir}`);
  }
});

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|png|jpg|jpeg|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) return cb(null, true);
    cb(new Error('Only PDF, PNG, JPG, JPEG, and TXT files allowed'));
  }
});

function generateCertificateNumber() {
  const prefix = 'CERT';
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${timestamp}-${random}`;
}

function generateDocumentHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Generate QR Code as buffer and save
async function generateQRCode(certificateNumber, documentHash) {
  try {
    const verificationData = JSON.stringify({
      cert: certificateNumber,
      hash: documentHash
    });
    
    const qrBuffer = await QRCode.toBuffer(verificationData, {
      width: 100,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    // Also save QR code as file for reference
    const qrFilePath = path.join(qrDir, `${certificateNumber}.png`);
    fs.writeFileSync(qrFilePath, qrBuffer);
    
    console.log(`✓ QR Code generated for: ${certificateNumber}`);
    return qrBuffer;
  } catch (error) {
    console.error('QR Code generation error:', error);
    return null;
  }
}

// Extract QR code data from certified PDF (reads embedded QR metadata)
async function extractQRDataFromPDF(pdfPath) {
  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    // Try to get custom metadata where we store QR data
    const metadata = pdfDoc.getTitle();
    
    if (metadata && metadata.startsWith('QR:')) {
      const qrData = metadata.substring(3);
      console.log(`✓ QR data extracted from PDF metadata`);
      return qrData;
    }
    
    return null;
  } catch (error) {
    console.error('QR extraction error:', error);
    return null;
  }
}

// Add minimal certificate footer to PDF with metadata
async function addMinimalCertificateToPDF(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    console.log(`Processing PDF: ${inputPath}`);
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    // Store QR data in PDF metadata for extraction
    const qrData = JSON.stringify({ cert: certificateNumber, hash: documentHash });
    pdfDoc.setTitle(`QR:${qrData}`);
    pdfDoc.setSubject('Blockchain Verified Certificate');
    pdfDoc.setKeywords([certificateNumber, 'blockchain', 'verified']);
    
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Generate QR code
    const qrBuffer = await generateQRCode(certificateNumber, documentHash);
    if (!qrBuffer) {
      console.error('Failed to generate QR code');
      return false;
    }
    
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    
    // Footer dimensions - minimal space
    const qrSize = 60;
    const footerHeight = 70;
    const marginBottom = 15;
    const footerY = marginBottom;
    
    // Draw white background for footer
    firstPage.drawRectangle({
      x: 0,
      y: footerY,
      width: width,
      height: footerHeight,
      color: rgb(1, 1, 1),
      opacity: 0.95,
    });
    
    // Draw QR code on left
    const qrX = 30;
    firstPage.drawImage(qrImage, {
      x: qrX,
      y: footerY + 5,
      width: qrSize,
      height: qrSize,
    });
    
    // Text next to QR code
    const textX = qrX + qrSize + 15;
    const textStartY = footerY + 50;
    
    firstPage.drawText('BLOCKCHAIN VERIFIED CERTIFICATE', {
      x: textX,
      y: textStartY,
      size: 10,
      font: boldFont,
      color: rgb(0.1, 0.3, 0.7),
    });
    
    firstPage.drawText(`Certificate No: ${certificateNumber}`, {
      x: textX,
      y: textStartY - 16,
      size: 9,
      font: font,
      color: rgb(0, 0, 0),
    });
    
    firstPage.drawText('Upload this document to verify authenticity', {
      x: textX,
      y: textStartY - 30,
      size: 7,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    });
    
    // Add small line at top of footer
    firstPage.drawLine({
      start: { x: 20, y: footerY + footerHeight },
      end: { x: width - 20, y: footerY + footerHeight },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✓ PDF certified with embedded QR data: ${outputPath}`);
    return true;
  } catch (error) {
    console.error('PDF processing error:', error);
    return false;
  }
}

// Convert image to PDF with minimal certificate
async function convertImageToPDF(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    const pdfDoc = await PDFDocument.create();
    
    // Store QR data in PDF metadata
    const qrData = JSON.stringify({ cert: certificateNumber, hash: documentHash });
    pdfDoc.setTitle(`QR:${qrData}`);
    pdfDoc.setSubject('Blockchain Verified Certificate');
    pdfDoc.setKeywords([certificateNumber, 'blockchain', 'verified']);
    
    const imageBytes = fs.readFileSync(inputPath);
    
    let image;
    const ext = path.extname(inputPath).toLowerCase();
    
    if (ext === '.png') {
      image = await pdfDoc.embedPng(imageBytes);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      image = await pdfDoc.embedJpg(imageBytes);
    } else {
      return false;
    }
    
    const maxWidth = 500;
    const maxHeight = 650;
    let imageWidth = image.width;
    let imageHeight = image.height;
    
    if (imageWidth > maxWidth || imageHeight > maxHeight) {
      const ratio = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
      imageWidth *= ratio;
      imageHeight *= ratio;
    }
    
    const footerHeight = 80;
    const pageWidth = Math.max(imageWidth + 60, 600);
    const pageHeight = imageHeight + footerHeight + 60;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Draw image
    const imageX = (pageWidth - imageWidth) / 2;
    const imageY = footerHeight + 20;
    
    page.drawImage(image, {
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight,
    });
    
    // Generate QR code
    const qrBuffer = await generateQRCode(certificateNumber, documentHash);
    if (!qrBuffer) return false;
    
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    
    // Footer
    const qrSize = 60;
    const footerY = 15;
    
    page.drawRectangle({
      x: 0,
      y: footerY,
      width: pageWidth,
      height: footerHeight,
      color: rgb(1, 1, 1),
      opacity: 0.95,
    });
    
    const qrX = 30;
    page.drawImage(qrImage, {
      x: qrX,
      y: footerY + 10,
      width: qrSize,
      height: qrSize,
    });
    
    const textX = qrX + qrSize + 15;
    const textStartY = footerY + 55;
    
    page.drawText('BLOCKCHAIN VERIFIED CERTIFICATE', {
      x: textX,
      y: textStartY,
      size: 10,
      font: boldFont,
      color: rgb(0.1, 0.3, 0.7),
    });
    
    page.drawText(`Certificate No: ${certificateNumber}`, {
      x: textX,
      y: textStartY - 16,
      size: 9,
      font: font,
      color: rgb(0, 0, 0),
    });
    
    page.drawText('Upload this document to verify authenticity', {
      x: textX,
      y: textStartY - 30,
      size: 7,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    });
    
    page.drawLine({
      start: { x: 20, y: footerY + footerHeight },
      end: { x: pageWidth - 20, y: footerY + footerHeight },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✓ Image converted to PDF with embedded QR: ${outputPath}`);
    return true;
  } catch (error) {
    console.error('Image conversion error:', error);
    return false;
  }
}

// Create certified text file
function createCertifiedTextFile(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    const originalContent = fs.readFileSync(inputPath, 'utf8');
    const timestamp = new Date().toLocaleString();
    const qrData = JSON.stringify({ cert: certificateNumber, hash: documentHash });
    
    const certifiedContent = `${originalContent}

${'═'.repeat(80)}
BLOCKCHAIN VERIFIED CERTIFICATE
Certificate Number: ${certificateNumber}
Document Hash: ${documentHash}
Certified: ${timestamp}

QR Data (for verification): ${qrData}

Upload this file to verify at: http://localhost:${PORT}
${'═'.repeat(80)}
`;
    
    fs.writeFileSync(outputPath, certifiedContent, 'utf8');
    console.log(`✓ Text file certified: ${outputPath}`);
    return true;
  } catch (error) {
    console.error('Text file error:', error);
    return false;
  }
}

// Process document
async function processCertifiedDocument(inputPath, certificateNumber, documentHash, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  
  let outputPath;
  let success = false;
  
  try {
    if (ext === '.pdf') {
      const certifiedFileName = `${baseName}_CERTIFIED_${certificateNumber}.pdf`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = await addMinimalCertificateToPDF(inputPath, outputPath, certificateNumber, documentHash);
    } 
    else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const certifiedFileName = `${baseName}_CERTIFIED_${certificateNumber}.pdf`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = await convertImageToPDF(inputPath, outputPath, certificateNumber, documentHash);
    } 
    else if (ext === '.txt') {
      const certifiedFileName = `${baseName}_CERTIFIED_${certificateNumber}.txt`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = createCertifiedTextFile(inputPath, outputPath, certificateNumber, documentHash);
    }
    
    if (success && outputPath && fs.existsSync(outputPath)) {
      console.log(`✓ File created: ${outputPath}`);
      return outputPath;
    }
    
    return null;
  } catch (error) {
    console.error('Processing error:', error);
    return null;
  }
}

// Download endpoint
app.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(certifiedDir, filename);
    
    console.log(`Download request: ${filename}`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).send('File not found');
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
      } else {
        console.log(`✓ Downloaded: ${filename}`);
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Server error');
  }
});

// Upload endpoint
app.post('/api/upload', upload.single('document'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const certificateNumber = generateCertificateNumber();
    
    // Calculate hash of ORIGINAL document
    const originalDocumentHash = generateDocumentHash(filePath);
    
    console.log(`Upload: ${req.file.originalname} -> ${certificateNumber}`);
    console.log(`Original hash: ${originalDocumentHash.substring(0, 20)}...`);

    // Register on blockchain with ORIGINAL hash
    const blockchainResult = await blockchainService.registerDocument(certificateNumber, originalDocumentHash);

    if (!blockchainResult.success) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(500).json({ 
        error: 'Blockchain registration failed', 
        details: blockchainResult.error 
      });
    }

    // Process document (adds QR code with embedded metadata)
    const certifiedPath = await processCertifiedDocument(
      filePath, 
      certificateNumber, 
      originalDocumentHash,
      req.file.originalname
    );

    if (!certifiedPath) {
      return res.status(500).json({ error: 'Document processing failed' });
    }

    const certifiedFileName = path.basename(certifiedPath);
    const downloadUrl = `http://localhost:${PORT}/download/${certifiedFileName}`;

    res.json({
      success: true,
      certificateNumber,
      documentHash: originalDocumentHash,
      fileName: req.file.originalname,
      certifiedFileName,
      fileSize: req.file.size,
      txHash: blockchainResult.txHash,
      downloadUrl,
      qrData: JSON.stringify({ cert: certificateNumber, hash: originalDocumentHash }),
      message: 'Document certified! QR data embedded in PDF. Simply upload the certified PDF to verify.'
    });

  } catch (error) {
    console.error('Upload error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Verify by scanning QR code data manually
app.post('/api/verify-qr', async (req, res) => {
  try {
    const { qrData } = req.body;
    
    if (!qrData) {
      return res.status(400).json({ error: 'QR data is required' });
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(qrData);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid QR data format' });
    }
    
    const { cert, hash } = parsedData;
    
    if (!cert || !hash) {
      return res.status(400).json({ error: 'Invalid QR data: missing cert or hash' });
    }

    // Verify against blockchain
    const result = await blockchainService.verifyDocument(cert, hash);
    
    if (!result.success) {
      return res.status(500).json({ error: 'Verification failed', details: result.error });
    }

    const documentInfo = await blockchainService.getDocument(cert);

    res.json({
      success: true,
      isValid: result.isValid,
      certificateNumber: cert,
      timestamp: result.timestamp,
      registeredHash: documentInfo.documentHash,
      scannedHash: hash,
      registrationDate: new Date(result.timestamp * 1000).toLocaleString(),
      message: result.isValid ? 
        '✓ VALID - Certificate verified on blockchain' : 
        '✗ INVALID - Certificate not found or has been tampered with'
    });

  } catch (error) {
    console.error('QR verification error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Verify by uploading CERTIFIED document (extracts QR automatically)
app.post('/api/verify-upload', upload.single('document'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    console.log(`Verify upload: ${req.file.originalname}`);

    let qrData = null;

    // Extract QR data based on file type
    if (ext === '.pdf') {
      qrData = await extractQRDataFromPDF(filePath);
    } else if (ext === '.txt') {
      // For text files, extract QR data from the footer
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/QR Data \(for verification\): ({.*?})/);
      if (match) {
        qrData = match[1];
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    if (!qrData) {
      return res.status(400).json({ 
        error: 'No certificate found in document',
        message: 'This document does not appear to be a certified document. Please upload a certified document with QR code.'
      });
    }

    console.log(`Extracted QR data: ${qrData.substring(0, 50)}...`);

    // Parse QR data
    let parsedData;
    try {
      parsedData = JSON.parse(qrData);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid certificate data in document' });
    }

    const { cert, hash } = parsedData;

    if (!cert || !hash) {
      return res.status(400).json({ error: 'Invalid certificate: missing data' });
    }

    // Verify with blockchain
    const result = await blockchainService.verifyDocument(cert, hash);
    
    if (!result.success) {
      return res.status(500).json({ error: 'Verification failed', details: result.error });
    }

    const documentInfo = await blockchainService.getDocument(cert);

    // Check if document has been tampered with
    const isValid = result.isValid && (hash === documentInfo.documentHash);

    res.json({
      success: true,
      isValid: isValid,
      certificateNumber: cert,
      timestamp: result.timestamp,
      registeredHash: documentInfo.documentHash,
      extractedHash: hash,
      registrationDate: new Date(result.timestamp * 1000).toLocaleString(),
      message: isValid ? 
        '✓ VALID - Certificate is authentic and verified on blockchain' : 
        '✗ INVALID - Certificate has been tampered with or is not authentic'
    });

  } catch (error) {
    console.error('Verify upload error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Service running',
    timestamp: new Date().toISOString()
  });
});

async function startServer() {
  console.log('Starting service...');
  
  const initialized = await blockchainService.initialize();
  
  if (!initialized) {
    console.error('\n❌ Blockchain initialization failed!');
    console.error('Please check:');
    console.error('  1. Is Hardhat node running? (npx hardhat node)');
    console.error('  2. Is contract deployed? (npm run deploy)\n');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    console.log('   📄 BLOCKCHAIN DOCUMENT VERIFICATION');
    console.log('═'.repeat(60));
    console.log(`✓ Server: http://localhost:${PORT}`);
    console.log('✓ Blockchain: Connected');
    console.log('✓ Auto QR Extraction: Enabled');
    console.log('✓ Upload certified PDF to verify automatically');
    console.log('═'.repeat(60) + '\n');
  });
}

startServer();