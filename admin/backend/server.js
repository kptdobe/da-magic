const express = require('express');
const cors = require('cors');
const { S3Client, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json());

// Load environment variables from .dev.vars
const loadEnvVars = () => {
  const envPath = path.join(__dirname, '../../.dev.vars');
  if (!fs.existsSync(envPath)) {
    throw new Error('.dev.vars file not found');
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  
  envContent.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        envVars[key.trim()] = value.trim();
      }
    }
  });
  
  return envVars;
};

// Load S3 configuration
const envVars = loadEnvVars();

// Configure AWS S3
const s3Client = new S3Client({
  credentials: {
    accessKeyId: envVars.S3_ACCESS_KEY_ID,
    secretAccessKey: envVars.S3_SECRET_ACCESS_KEY,
  },
  endpoint: envVars.S3_DEF_URL,
  forcePathStyle: true,
  region: 'auto' // Cloudflare R2 uses 'auto' region
});

const BUCKET_NAME = 'aem-content';

// Helper function to normalize document path
const normalizePath = (documentPath) => {
  // Remove leading slash and convert to lowercase
  return documentPath.replace(/^\//, '').toLowerCase();
};

// Helper function to extract root path
const getRootPath = (documentPath) => {
  return documentPath.split('/')[0];
};

// Helper function to format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
};

// Helper function to convert stream to buffer
const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

// Helper function to detect character encoding
const detectEncoding = (buffer) => {
  // Check for BOM (Byte Order Mark)
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { encoding: 'UTF-8', bom: true };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { encoding: 'UTF-16LE', bom: true };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { encoding: 'UTF-16BE', bom: true };
  }
  if (buffer.length >= 4 && buffer[0] === 0xFF && buffer[1] === 0xFE && buffer[2] === 0x00 && buffer[3] === 0x00) {
    return { encoding: 'UTF-32LE', bom: true };
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xFE && buffer[3] === 0xFF) {
    return { encoding: 'UTF-32BE', bom: true };
  }

  // Try to detect encoding by analyzing content
  let hasNullBytes = false;
  let hasHighBytes = false;
  let validUtf8 = true;

  for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
    if (buffer[i] === 0) {
      hasNullBytes = true;
      break;
    }
    if (buffer[i] > 127) {
      hasHighBytes = true;
    }
  }

  if (hasNullBytes) {
    return { encoding: 'Binary/UTF-16/UTF-32', bom: false };
  }

  // Check if valid UTF-8
  try {
    const str = buffer.toString('utf8');
    // Check for replacement characters which indicate invalid UTF-8
    if (str.includes('\uFFFD')) {
      validUtf8 = false;
    }
  } catch (e) {
    validUtf8 = false;
  }

  if (!hasHighBytes) {
    return { encoding: 'ASCII', bom: false };
  }

  if (validUtf8) {
    return { encoding: 'UTF-8', bom: false };
  }

  return { encoding: 'ISO-8859-1/Windows-1252 (likely)', bom: false };
};

// Helper function to detect line endings and count lines
const analyzeTextContent = (content) => {
  const hasCRLF = content.includes('\r\n');
  const hasCR = content.includes('\r') && !hasCRLF;
  const hasLF = content.includes('\n') && !hasCRLF;

  let lineEndingType = 'None';
  if (hasCRLF) {
    lineEndingType = 'CRLF (Windows)';
  } else if (hasLF) {
    lineEndingType = 'LF (Unix/Mac)';
  } else if (hasCR) {
    lineEndingType = 'CR (Old Mac)';
  }

  // Count lines
  const lines = content.split(/\r\n|\r|\n/);
  const lineCount = lines.length;
  
  // Count characters (excluding line endings for consistency)
  const charCount = content.length;
  
  // Count non-whitespace characters
  const nonWhitespaceCount = content.replace(/\s/g, '').length;

  return {
    lineEndingType,
    lineCount,
    charCount,
    nonWhitespaceCount
  };
};

// API Routes

// Get document metadata and content
app.get('/api/document/:path(*)', async (req, res) => {
  try {
    const documentPath = normalizePath(req.params.path);
    
    // Get document metadata
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: documentPath
    });
    
    const metadata = await s3Client.send(headCommand);
    
    // Get document content
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: documentPath
    });
    
    const document = await s3Client.send(getCommand);
    
    // Determine content type for rendering
    const contentType = metadata.ContentType || 'application/octet-stream';
    const isTextContent = contentType.startsWith('text/') || 
                         contentType === 'application/json' || 
                         contentType === 'application/xml';
    
    // Convert stream to buffer
    const buffer = await streamToBuffer(document.Body);
    
    let content = null;
    let textAnalysis = null;
    let encodingInfo = null;
    
    // Detect encoding for all files
    encodingInfo = detectEncoding(buffer);
    console.log('Document encoding info detected:', encodingInfo);
    
    if (isTextContent) {
      content = buffer.toString('utf8');
      // Analyze text content
      textAnalysis = analyzeTextContent(content);
      console.log('Document text analysis:', textAnalysis);
    } else {
      // For binary content, return as base64
      content = buffer.toString('base64');
    }
    
    res.json({
      success: true,
      metadata: {
        contentLength: metadata.ContentLength,
        contentType: metadata.ContentType,
        lastModified: metadata.LastModified,
        etag: metadata.ETag,
        metadata: metadata.Metadata || {},
        // Additional S3 metadata fields
        contentEncoding: metadata.ContentEncoding || null,
        contentLanguage: metadata.ContentLanguage || null,
        contentDisposition: metadata.ContentDisposition || null,
        cacheControl: metadata.CacheControl || null,
        expires: metadata.Expires || null,
        storageClass: metadata.StorageClass || null,
        serverSideEncryption: metadata.ServerSideEncryption || null,
        versionId: metadata.VersionId || null,
        checksumCRC32: metadata.ChecksumCRC32 || null,
        checksumCRC32C: metadata.ChecksumCRC32C || null,
        checksumSHA1: metadata.ChecksumSHA1 || null,
        checksumSHA256: metadata.ChecksumSHA256 || null,
        acceptRanges: metadata.AcceptRanges || null,
        partsCount: metadata.PartsCount || null,
        objectLockMode: metadata.ObjectLockMode || null,
        objectLockRetainUntilDate: metadata.ObjectLockRetainUntilDate || null,
        objectLockLegalHoldStatus: metadata.ObjectLockLegalHoldStatus || null,
        replicationStatus: metadata.ReplicationStatus || null,
        // File analysis
        detectedEncoding: encodingInfo.encoding,
        hasBOM: encodingInfo.bom
      },
      content: content,
      isTextContent: isTextContent,
      contentType: contentType,
      textAnalysis: textAnalysis
    });
    
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(404).json({
      success: false,
      error: 'Document not found or error occurred',
      details: error.message
    });
  }
});

// Get document versions
app.get('/api/versions/:path(*)', async (req, res) => {
  try {
    const documentPath = normalizePath(req.params.path);
    
    // First get the document metadata to extract the ID
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: documentPath
    });
    
    const metadata = await s3Client.send(headCommand);
    const id = metadata.Metadata?.id;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'No Metadata/id found in document'
      });
    }
    
    // Construct versions path
    const rootPath = getRootPath(documentPath);
    const versionsPath = `${rootPath}/.da-versions/${id}/`;
    
    // List files in versions folder
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: versionsPath
    });
    
    const versions = await s3Client.send(listCommand);
    
    // Get metadata for all versions in parallel
    const versionObjects = versions.Contents.filter(obj => obj.Key !== versionsPath);
    
    const metadataPromises = versionObjects.map(async (obj) => {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: obj.Key
        });
        const metadata = await s3Client.send(headCommand);
        return {
          key: obj.Key,
          path: `/${obj.Key}`,
          filename: obj.Key.split('/').pop(),
          size: obj.Size,
          sizeFormatted: formatFileSize(obj.Size),
          lastModified: obj.LastModified,
          metadata: metadata.Metadata || {},
          contentType: metadata.ContentType
        };
      } catch (error) {
        console.error(`Error fetching metadata for ${obj.Key}:`, error);
        // Return basic info if metadata fetch fails
        return {
          key: obj.Key,
          path: `/${obj.Key}`,
          filename: obj.Key.split('/').pop(),
          size: obj.Size,
          sizeFormatted: formatFileSize(obj.Size),
          lastModified: obj.LastModified,
          metadata: {},
          contentType: null
        };
      }
    });
    
    const versionsWithMetadata = await Promise.all(metadataPromises);
    
    // Sort by date, newest first
    const formattedVersions = versionsWithMetadata.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    res.json({
      success: true,
      versions: formattedVersions,
      versionsPath: versionsPath
    });
    
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching versions',
      details: error.message
    });
  }
});

// Get a specific version for preview
app.get('/api/version/:path(*)', async (req, res) => {
  try {
    const versionPath = req.params.path;
    const originalContentType = req.query.originalContentType;
    
    // Get version metadata
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: versionPath
    });
    
    const metadata = await s3Client.send(headCommand);
    
    // Get version content
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: versionPath
    });
    
    const document = await s3Client.send(getCommand);
    
    // Use original document content type for rendering instead of version file content type
    const contentType = originalContentType || metadata.ContentType || 'application/octet-stream';
    const isTextContent = contentType.startsWith('text/') || 
                         contentType === 'application/json' || 
                         contentType === 'application/xml';
    
    // Convert stream to buffer
    const buffer = await streamToBuffer(document.Body);
    
    let content = null;
    let textAnalysis = null;
    let encodingInfo = null;
    
    // Detect encoding for all files
    encodingInfo = detectEncoding(buffer);
    
    if (isTextContent) {
      content = buffer.toString('utf8');
      // Analyze text content
      textAnalysis = analyzeTextContent(content);
    } else {
      // For binary content, return as base64
      content = buffer.toString('base64');
    }
    
    res.json({
      success: true,
      metadata: {
        contentLength: metadata.ContentLength,
        contentType: metadata.ContentType, // Real content type from version file metadata
        originalContentType: contentType, // Original document content type used for rendering
        lastModified: metadata.LastModified,
        etag: metadata.ETag,
        metadata: metadata.Metadata || {},
        // Additional S3 metadata fields
        contentEncoding: metadata.ContentEncoding || null,
        contentLanguage: metadata.ContentLanguage || null,
        contentDisposition: metadata.ContentDisposition || null,
        cacheControl: metadata.CacheControl || null,
        expires: metadata.Expires || null,
        storageClass: metadata.StorageClass || null,
        serverSideEncryption: metadata.ServerSideEncryption || null,
        versionId: metadata.VersionId || null,
        checksumCRC32: metadata.ChecksumCRC32 || null,
        checksumCRC32C: metadata.ChecksumCRC32C || null,
        checksumSHA1: metadata.ChecksumSHA1 || null,
        checksumSHA256: metadata.ChecksumSHA256 || null,
        acceptRanges: metadata.AcceptRanges || null,
        partsCount: metadata.PartsCount || null,
        objectLockMode: metadata.ObjectLockMode || null,
        objectLockRetainUntilDate: metadata.ObjectLockRetainUntilDate || null,
        objectLockLegalHoldStatus: metadata.ObjectLockLegalHoldStatus || null,
        replicationStatus: metadata.ReplicationStatus || null,
        // File analysis
        detectedEncoding: encodingInfo.encoding,
        hasBOM: encodingInfo.bom
      },
      content: content,
      isTextContent: isTextContent,
      contentType: contentType, // Original content type used for rendering
      textAnalysis: textAnalysis
    });
    
  } catch (error) {
    console.error('Error fetching version:', error);
    res.status(404).json({
      success: false,
      error: 'Version not found or error occurred',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Frontend should run on: http://localhost:9090`);
});