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
    if (isTextContent) {
      content = buffer.toString('utf8');
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
        metadata: metadata.Metadata || {}
      },
      content: content,
      isTextContent: isTextContent,
      contentType: contentType
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
    if (isTextContent) {
      content = buffer.toString('utf8');
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
        metadata: metadata.Metadata || {}
      },
      content: content,
      isTextContent: isTextContent,
      contentType: contentType // Original content type used for rendering
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