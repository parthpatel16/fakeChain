const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const blockchainService = require('./blockchain');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// IMPORTANT: Serve certified documents with proper headers
app.use('/certified-documents', express.static(path.join(__dirname, 'certified-documents'), {
  setHeaders: (res, filePath) => {
    // Force download instead of displaying in browser
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.setHeader('Content-Type', 'application/pdf');
  }
}));

// Create directories if they don't exist
const uploadsDir = path.join(__dirname, 'uploads');
const certifiedDir = path.join(__dirname, 'certified-documents');

console.log('Creating directories...');
console.log('Uploads dir:', uploadsDir);
console.log('Certified dir:', certifiedDir);

[uploadsDir, certifiedDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  } else {
    console.log(`✓ Directory exists: ${dir}`);
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|png|jpg|jpeg|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    if (extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, PNG, JPG, JPEG, and TXT files are allowed'));
    }
  }
});

// Generate random certificate number
function generateCertificateNumber() {
  const prefix = 'CERT';
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${timestamp}-${random}`;
}

// Generate hash for document
function generateDocumentHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Add certificate and watermark to PDF
async function addCertificateToPDF(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    console.log(`Processing PDF: ${inputPath}`);
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    const pages = pdfDoc.getPages();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Add certificate info and watermark to each page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      
      // Certificate box dimensions (only on first page)
      if (i === 0) {
        const boxPadding = 50;
        const boxHeight = 90;
        const boxWidth = width - (boxPadding * 2);
        const boxX = boxPadding;
        const boxY = height - 150;
        
        // Draw certificate box background
        page.drawRectangle({
          x: boxX,
          y: boxY,
          width: boxWidth,
          height: boxHeight,
          color: rgb(1, 1, 1),
          opacity: 0.95,
          borderColor: rgb(0.15, 0.35, 0.7),
          borderWidth: 2,
        });
        
        // Title
        page.drawText('BLOCKCHAIN CERTIFIED DOCUMENT', {
          x: boxX + 15,
          y: boxY + boxHeight - 22,
          size: 13,
          font: boldFont,
          color: rgb(0.1, 0.3, 0.7),
        });
        
        // Certificate Number
        page.drawText(`Certificate No: ${certificateNumber}`, {
          x: boxX + 15,
          y: boxY + boxHeight - 42,
          size: 12,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        
        // Document Hash (truncated)
        const hashDisplay = `Hash: ${documentHash.substring(0, 45)}...`;
        page.drawText(hashDisplay, {
          x: boxX + 15,
          y: boxY + boxHeight - 60,
          size: 8,
          font: regularFont,
          color: rgb(0.3, 0.3, 0.3),
        });
        
        // Verification info
        page.drawText('Verify at: http://localhost:3000 | Secured on Blockchain', {
          x: boxX + 15,
          y: boxY + boxHeight - 75,
          size: 8,
          font: regularFont,
          color: rgb(0.4, 0.4, 0.4),
        });
        
        // Timestamp
        const timestamp = new Date().toLocaleString();
        page.drawText(`Certified: ${timestamp}`, {
          x: boxX + 15,
          y: boxY + boxHeight - 88,
          size: 7,
          font: regularFont,
          color: rgb(0.5, 0.5, 0.5),
        });
      }
      
      // Add diagonal watermark in center (all pages)
      const watermarkText = `CERTIFIED • ${certificateNumber}`;
      const watermarkSize = 35;
      const watermarkWidth = boldFont.widthOfTextAtSize(watermarkText, watermarkSize);
      
      page.drawText(watermarkText, {
        x: (width - watermarkWidth * 0.7) / 2,
        y: height / 2,
        size: watermarkSize,
        font: boldFont,
        color: rgb(0.85, 0.85, 0.85),
        opacity: 0.3,
        rotate: degrees(-45),
      });
      
      // Add small watermark at bottom right corner
      const cornerText = `CERT: ${certificateNumber}`;
      const cornerSize = 8;
      const cornerWidth = regularFont.widthOfTextAtSize(cornerText, cornerSize);
      
      page.drawText(cornerText, {
        x: width - cornerWidth - 30,
        y: 20,
        size: cornerSize,
        font: regularFont,
        color: rgb(0.6, 0.6, 0.6),
        opacity: 0.7,
      });
    }
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✓ PDF certified and saved: ${outputPath}`);
    console.log(`✓ File size: ${fs.statSync(outputPath).size} bytes`);
    return true;
  } catch (error) {
    console.error('Error adding certificate to PDF:', error);
    return false;
  }
}

// Convert image to PDF with certificate and watermark
async function convertImageToPDF(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    console.log(`Converting image to PDF: ${inputPath}`);
    const pdfDoc = await PDFDocument.create();
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
    
    // Scale image to fit page while maintaining aspect ratio
    const maxWidth = 500;
    const maxHeight = 600;
    let imageWidth = image.width;
    let imageHeight = image.height;
    
    if (imageWidth > maxWidth || imageHeight > maxHeight) {
      const widthRatio = maxWidth / imageWidth;
      const heightRatio = maxHeight / imageHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      imageWidth = imageWidth * ratio;
      imageHeight = imageHeight * ratio;
    }
    
    // Create page with space for certificate
    const pageWidth = Math.max(imageWidth + 100, 600);
    const pageHeight = imageHeight + 250;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Certificate box at top
    const boxX = 50;
    const boxY = pageHeight - 150;
    const boxWidth = pageWidth - 100;
    const boxHeight = 90;
    
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      opacity: 0.95,
      borderColor: rgb(0.15, 0.35, 0.7),
      borderWidth: 2,
    });
    
    // Certificate content
    page.drawText('BLOCKCHAIN CERTIFIED DOCUMENT', {
      x: boxX + 15,
      y: boxY + boxHeight - 22,
      size: 13,
      font: boldFont,
      color: rgb(0.1, 0.3, 0.7),
    });
    
    page.drawText(`Certificate No: ${certificateNumber}`, {
      x: boxX + 15,
      y: boxY + boxHeight - 42,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    const hashDisplay = `Hash: ${documentHash.substring(0, 45)}...`;
    page.drawText(hashDisplay, {
      x: boxX + 15,
      y: boxY + boxHeight - 60,
      size: 8,
      font: regularFont,
      color: rgb(0.3, 0.3, 0.3),
    });
    
    page.drawText('Verify at: http://localhost:3000 | Secured on Blockchain', {
      x: boxX + 15,
      y: boxY + boxHeight - 75,
      size: 8,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    
    const timestamp = new Date().toLocaleString();
    page.drawText(`Certified: ${timestamp}`, {
      x: boxX + 15,
      y: boxY + boxHeight - 88,
      size: 7,
      font: regularFont,
      color: rgb(0.5, 0.5, 0.5),
    });
    
    // Draw image below certificate
    const imageX = (pageWidth - imageWidth) / 2;
    const imageY = 40;
    
    page.drawImage(image, {
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight,
    });
    
    // Watermark on image
    const watermarkText = `CERTIFIED • ${certificateNumber}`;
    const watermarkSize = 25;
    const watermarkWidth = boldFont.widthOfTextAtSize(watermarkText, watermarkSize);
    
    page.drawText(watermarkText, {
      x: (pageWidth - watermarkWidth * 0.7) / 2,
      y: imageY + imageHeight / 2,
      size: watermarkSize,
      font: boldFont,
      color: rgb(0.85, 0.85, 0.85),
      opacity: 0.4,
      rotate: degrees(-45),
    });
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✓ Image converted to certified PDF: ${outputPath}`);
    console.log(`✓ File size: ${fs.statSync(outputPath).size} bytes`);
    return true;
  } catch (error) {
    console.error('Error converting image to PDF:', error);
    return false;
  }
}

// Create certified text file
function createCertifiedTextFile(inputPath, outputPath, certificateNumber, documentHash) {
  try {
    console.log(`Creating certified text file: ${inputPath}`);
    const originalContent = fs.readFileSync(inputPath, 'utf8');
    const timestamp = new Date().toLocaleString();
    
    const certifiedContent = `
${'═'.repeat(80)}
                    BLOCKCHAIN CERTIFIED DOCUMENT
${'═'.repeat(80)}

CERTIFICATE NUMBER: ${certificateNumber}

DOCUMENT HASH: ${documentHash}

CERTIFICATION DATE: ${timestamp}

VERIFICATION: http://localhost:3000

STATUS: SECURED ON BLOCKCHAIN

${'═'.repeat(80)}

ORIGINAL DOCUMENT CONTENT:
${'─'.repeat(80)}

${originalContent}

${'─'.repeat(80)}

${'═'.repeat(80)}
END OF CERTIFIED DOCUMENT
Certificate Number: ${certificateNumber}
This document is secured on blockchain and can be verified at http://localhost:3000
${'═'.repeat(80)}
`;
    
    fs.writeFileSync(outputPath, certifiedContent, 'utf8');
    console.log(`✓ Text file certified: ${outputPath}`);
    console.log(`✓ File size: ${fs.statSync(outputPath).size} bytes`);
    return true;
  } catch (error) {
    console.error('Error creating certified text file:', error);
    return false;
  }
}

// Process document and add certificate
async function processCertifiedDocument(inputPath, certificateNumber, documentHash, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext);
  
  // Clean filename - remove special characters
  const cleanBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
  
  let outputPath;
  let success = false;
  
  try {
    if (ext === '.pdf') {
      const certifiedFileName = `${cleanBaseName}_CERTIFIED_${certificateNumber}.pdf`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = await addCertificateToPDF(inputPath, outputPath, certificateNumber, documentHash);
    } 
    else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const certifiedFileName = `${cleanBaseName}_CERTIFIED_${certificateNumber}.pdf`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = await convertImageToPDF(inputPath, outputPath, certificateNumber, documentHash);
    } 
    else if (ext === '.txt') {
      const certifiedFileName = `${cleanBaseName}_CERTIFIED_${certificateNumber}.txt`;
      outputPath = path.join(certifiedDir, certifiedFileName);
      success = createCertifiedTextFile(inputPath, outputPath, certificateNumber, documentHash);
    }
    
    if (success && outputPath) {
      // Verify file was created
      if (fs.existsSync(outputPath)) {
        console.log(`✓ Certified file created successfully: ${outputPath}`);
        console.log(`✓ File accessible: ${fs.statSync(outputPath).size} bytes`);
      } else {
        console.error(`✗ File not found after creation: ${outputPath}`);
        return null;
      }
    }
    
    return success ? outputPath : null;
  } catch (error) {
    console.error('Error processing document:', error);
    return null;
  }
}

// Direct download endpoint
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(certifiedDir, filename);
    
    console.log(`Download request for: ${filename}`);
    console.log(`Full path: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ error: 'File not found' });
    }
    
    console.log(`✓ File found, sending: ${filename}`);
    
    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    // Send file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error downloading file' });
        }
      } else {
        console.log(`✓ File sent successfully: ${filename}`);
      }
    });
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Upload and register document
app.post('/api/upload', upload.single('document'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;
    const certificateNumber = generateCertificateNumber();
    
    // Generate hash of ORIGINAL document (before adding certificate)
    const documentHash = generateDocumentHash(filePath);
    
    console.log('Processing upload:', {
      originalFile: req.file.originalname,
      certificateNumber,
      hash: documentHash.substring(0, 20) + '...'
    });

    // Register on blockchain
    const blockchainResult = await blockchainService.registerDocument(certificateNumber, documentHash);

    if (!blockchainResult.success) {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(500).json({ 
        error: 'Failed to register on blockchain', 
        details: blockchainResult.error 
      });
    }

    console.log('✓ Registered on blockchain, processing document...');

    // Process document and add certificate
    const certifiedPath = await processCertifiedDocument(
      filePath, 
      certificateNumber, 
      documentHash, 
      req.file.originalname
    );

    if (!certifiedPath) {
      return res.status(500).json({ error: 'Failed to process document and add certificate' });
    }

    const certifiedFileName = path.basename(certifiedPath);
    
    // Use direct download endpoint
    const downloadUrl = `http://localhost:${PORT}/api/download/${encodeURIComponent(certifiedFileName)}`;

    console.log(`✓ Upload complete. Download URL: ${downloadUrl}`);

    res.json({
      success: true,
      certificateNumber: certificateNumber,
      documentHash: documentHash,
      fileName: req.file.originalname,
      certifiedFileName: certifiedFileName,
      fileSize: req.file.size,
      txHash: blockchainResult.txHash,
      downloadUrl: downloadUrl,
      message: 'Document uploaded, certified with watermark, and registered on blockchain successfully'
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Cleanup on error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Verify document by uploading file
app.post('/api/verify-upload', upload.single('document'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { certificateNumber } = req.body;
    
    if (!certificateNumber) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Certificate number is required' });
    }

    filePath = req.file.path;
    const documentHash = generateDocumentHash(filePath);
    
    // Clean up uploaded file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const result = await blockchainService.verifyDocument(certificateNumber, documentHash);

    if (!result.success) {
      return res.status(500).json({ 
        error: 'Verification failed', 
        details: result.error 
      });
    }

    const documentInfo = await blockchainService.getDocument(certificateNumber);

    res.json({
      success: true,
      isValid: result.isValid,
      certificateNumber: certificateNumber,
      timestamp: result.timestamp,
      registeredHash: documentInfo.documentHash,
      providedHash: documentHash,
      registrationDate: new Date(result.timestamp * 1000).toLocaleString(),
      message: result.isValid ? 
        '✓ Document is VALID and verified on blockchain' : 
        '✗ Document verification FAILED - hash mismatch or certificate not found'
    });

  } catch (error) {
    console.error('Verification error:', error);
    
    // Cleanup on error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Verify document by hash
app.post('/api/verify', async (req, res) => {
  try {
    const { certificateNumber, documentHash } = req.body;

    if (!certificateNumber || !documentHash) {
      return res.status(400).json({ 
        error: 'Certificate number and document hash are required' 
      });
    }

    const result = await blockchainService.verifyDocument(certificateNumber, documentHash);

    if (!result.success) {
      return res.status(500).json({ 
        error: 'Verification failed', 
        details: result.error 
      });
    }

    const documentInfo = await blockchainService.getDocument(certificateNumber);

    res.json({
      success: true,
      isValid: result.isValid,
      certificateNumber: certificateNumber,
      timestamp: result.timestamp,
      registeredHash: documentInfo.documentHash,
      providedHash: documentHash,
      registrationDate: new Date(result.timestamp * 1000).toLocaleString(),
      message: result.isValid ? 
        '✓ Document is VALID and verified on blockchain' : 
        '✗ Document verification FAILED - hash mismatch or certificate not found'
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Get document details by certificate number
app.get('/api/document/:certificateNumber', async (req, res) => {
  try {
    const { certificateNumber } = req.params;
    const result = await blockchainService.getDocument(certificateNumber);

    if (!result.success) {
      return res.status(500).json({ 
        error: 'Failed to retrieve document', 
        details: result.error 
      });
    }

    if (!result.exists) {
      return res.status(404).json({ 
        error: 'Document not found with this certificate number' 
      });
    }

    res.json({
      success: true,
      certificateNumber: result.certificateNumber,
      documentHash: result.documentHash,
      timestamp: result.timestamp,
      registrationDate: new Date(result.timestamp * 1000).toLocaleString()
    });

  } catch (error) {
    console.error('Retrieval error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Document verification service is running',
    timestamp: new Date().toISOString()
  });
});

// Initialize blockchain service and start server
async function startServer() {
  console.log('Starting Document Verification Service...');
  
  const initialized = await blockchainService.initialize();
  
  if (!initialized) {
    console.error('❌ Failed to initialize blockchain service.');
    console.error('Make sure:');
    console.error('  1. Hardhat node is running (npx hardhat node)');
    console.error('  2. Smart contract is deployed (npm run deploy)');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('');
    console.log('═'.repeat(60));
    console.log('   📄 DOCUMENT VERIFICATION SERVICE');
    console.log('═'.repeat(60));
    console.log(`✓ Server running on http://localhost:${PORT}`);
    console.log('✓ Blockchain service connected and ready');
    console.log('✓ Certificate watermarking enabled');
    console.log(`✓ Upload directory: ${uploadsDir}`);
    console.log(`✓ Certified directory: ${certifiedDir}`);
    console.log('═'.repeat(60));
    console.log('');
  });
}

startServer();