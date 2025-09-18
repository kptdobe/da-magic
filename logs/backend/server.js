const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 9093;

// Middleware
app.use(cors());
app.use(express.json());

// Load environment variables
const loadEnvVars = () => {
  // Try to load from .env file first (for development)
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
  
  // Fallback to .dev.vars for backward compatibility
  const devVarsPath = path.join(__dirname, '../../.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const envContent = fs.readFileSync(devVarsPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        const [key, value] = line.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      }
    });
  }
  
  return {
    CORALOGIX_API_KEY: process.env.CORALOGIX_API_KEY,
    CORALOGIX_QUERY_ENDPOINT: process.env.CORALOGIX_QUERY_ENDPOINT
  };
};

// Load configuration
const config = loadEnvVars();

// Validate required environment variables
const requiredVars = ['CORALOGIX_API_KEY'];
const missingVars = requiredVars.filter(varName => !config[varName]);
if (missingVars.length > 0) {
  console.warn(`Missing Coralogix environment variables: ${missingVars.join(', ')}`);
  console.warn('Coralogix integration will be disabled');
}

// Helper function to normalize document path (same as admin app)
const normalizePath = (documentPath) => {
  return documentPath.replace(/^\//, '').toLowerCase();
};

// Helper function to extract document path from various URL formats (same as admin app)
const extractDocumentPath = (input) => {
  if (!input.trim()) return '';

  let path = input.trim();

  // Handle full URLs
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const url = new URL(path);
      
      // Handle AEM URLs (e.g., https://main--repo--owner.aem.page/a/b/c or https://main--repo--owner.aem.live/a/b/c)
      if (url.hostname.includes('.aem.page') || url.hostname.includes('.aem.live')) {
        // Extract owner and repo from hostname (format: main--repo--owner.aem.page)
        const hostParts = url.hostname.split('.')[0].split('--');
        if (hostParts.length >= 3) {
          const owner = hostParts[2]; // owner is the last part
          const repo = hostParts[1];  // repo is the middle part
          const urlPath = url.pathname.replace(/^\/+/, ''); // Remove leading slashes
          path = `${owner}/${repo}/${urlPath}`;
        } else {
          // Fallback to treating as regular path
          path = url.pathname;
        }
      }
      // Handle hash-based paths (e.g., https://da.live/edit#/owner/repo/path/test.html)
      else if (url.hash && url.hash.startsWith('#/')) {
        path = url.hash.substring(2); // Remove '#/'
      }
      // Handle path-based URLs (e.g., https://admin.da.live/source/owner/repo/path/test.html)
      else if (url.pathname.startsWith('/source/')) {
        path = url.pathname.substring(8); // Remove '/source/'
      }
      // Handle other URL paths
      else {
        path = url.pathname;
      }
    } catch (e) {
      // If URL parsing fails, treat as regular path
      console.warn('Failed to parse URL, treating as path:', e);
    }
  }

  // Remove leading slash if present
  path = path.replace(/^\/+/, '');

  // Convert to lowercase (as per backend requirement)
  path = path.toLowerCase();

  // Remove file extension for logs search
  path = path.replace(/\.[^/.]+$/, '');

  return path;
};

// Coralogix API helper using DataPrime API
const searchCoralogixLogs = async (searchPath, timeRange = '1h', offset = 0, limit = 100) => {
  if (!config.CORALOGIX_API_KEY) {
    throw new Error('Coralogix API key not configured');
  }


  // Coralogix DataPrime API integration - using direct query approach
  try {
    // Use the correct DataPrime API format with proper server-side filtering
    const timeRangeMs = getTimeRangeMs(timeRange);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - timeRangeMs);
    
    const queryData = {
      query: `source logs | filter Event.Request.URL.contains('${searchPath}') || ClientRequestPath.contains('${searchPath}') | limit 1000`,
      metadata: {
        startDate: startTime.toISOString(),
        endDate: endTime.toISOString()
      }
    };
    
    // Log the curl command for debugging with proper escaping
    const escapedQuery = JSON.stringify(queryData).replace(/'/g, "\'\\'\'");
    const curlCommand = `curl -H "Authorization: Bearer ${config.CORALOGIX_API_KEY}" -H "Content-Type: application/json" -X POST https://api.eu1.coralogix.com/api/v1/dataprime/query -d '${escapedQuery}'`;
    
    // Also write to a log file for easier debugging
    const fs = require('fs');
    fs.appendFileSync('coralogix-curl.log', `\n${new Date().toISOString()}\n${curlCommand}\n`);
    
    const response = await axios.post(
      'https://api.eu1.coralogix.com/api/v1/dataprime/query',
      queryData,
      {
        headers: {
          'Authorization': `Bearer ${config.CORALOGIX_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Parse the NDJSON response - it contains multiple JSON objects
    const logs = [];
    
    // Split by newlines to handle NDJSON format
    const lines = response.data.trim().split('\n');
    
    // Process all result objects in the NDJSON response
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.result && parsed.result.results) {
            // Process all results from this result object
            for (const result of parsed.result.results) {
              // Extract metadata and labels
              const metadata = {};
              const labels = {};
              
              if (result.metadata) {
                for (const meta of result.metadata) {
                  metadata[meta.key] = meta.value;
                }
              }
              
              if (result.labels) {
                for (const label of result.labels) {
                  labels[label.key] = label.value;
                }
              }
              
                  // Parse userData if it's a JSON string
                  let userData = result.userData || '';
                  try {
                    if (typeof userData === 'string') {
                      userData = JSON.parse(userData);
                    }
                  } catch (e) {
                    // Keep as string if not valid JSON
                  }
                  
                  // Extract useful properties based on type
                  const originalType = labels.subsystemname || 'default';
                  let logType = originalType;
                  let url = 'N/A';
                  let method = 'N/A';
                  let status = 'N/A';
                  
                  if (originalType === 'HTTPRequests') {
                    url = userData.ClientRequestPath || 'N/A';
                    method = userData.ClientRequestMethod || 'N/A';
                    status = userData.EdgeResponseStatus || 'N/A';
                  } else if (originalType === 'WorkersTraceEvents') {
                    // For WorkersTraceEvents, use ScriptName instead of subsystemname
                    logType = userData.ScriptName || 'WorkersTraceEvents';
                    url = userData.Event?.Request?.URL || 'N/A';
                    method = userData.Event?.Request?.Method || 'N/A';
                    status = userData.Event?.Response?.Status || 'N/A';
                  }
                  
                  // Always create the main log entry first
                  logs.push({
                    id: metadata.logid || Math.random().toString(36),
                    timestamp: metadata.timestamp || new Date().toISOString(),
                    url: url,
                    method: method,
                    status: status,
                    type: logType,
                    severity: metadata.severity || 'INFO',
                    applicationName: labels.applicationname || 'unknown',
                    message: userData.message || userData.text || '',
                    level: metadata.severity || 'INFO',
                    event: {
                      userData: userData,
                      metadata: metadata,
                      labels: labels
                    }
                  });

                  // If userData has a Logs array, create additional entries for each log
                  if (userData.Logs && Array.isArray(userData.Logs) && userData.Logs.length > 0) {
                    userData.Logs.forEach((logEntry, logIndex) => {
                      // Handle different log entry formats
                      const logLevel = logEntry.Level || logEntry.level || 'INFO';
                      const logMessage = Array.isArray(logEntry.Message) 
                        ? logEntry.Message.join(' ') 
                        : logEntry.Message || logEntry.message || logEntry.text || '';
                      const logTimestamp = logEntry.TimestampMs 
                        ? new Date(logEntry.TimestampMs).toISOString()
                        : logEntry.timestamp || metadata.timestamp || new Date().toISOString();
                      
                      logs.push({
                        id: `${metadata.logid || Math.random().toString(36)}-log-${logIndex}`,
                        timestamp: logTimestamp,
                        url: url, // Keep the same URL as the parent
                        method: method, // Keep the same method as the parent
                        status: status, // Keep the same status as the parent
                        type: logType, // Keep the same type as the parent
                        severity: logLevel,
                        applicationName: labels.applicationname || 'unknown',
                        message: logMessage,
                        level: logLevel,
                        event: {
                          userData: userData,
                          metadata: metadata,
                          labels: labels,
                          logEntry: logEntry
                        }
                      });
                    });
                  }
            }
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
    }

    // Group logs by parent ID and sort chronologically within groups
    const groupedLogs = [];
    const parentLogs = logs.filter(log => !log.id.includes('-log-'));
    const expandedLogs = logs.filter(log => log.id.includes('-log-'));
    
    // Sort parent logs chronologically
    parentLogs.sort((a, b) => {
      const timestampA = new Date(a.timestamp).getTime();
      const timestampB = new Date(b.timestamp).getTime();
      return timestampA - timestampB;
    });
    
    // For each parent log, add it and its expanded entries
    parentLogs.forEach(parentLog => {
      // Add the parent log
      groupedLogs.push(parentLog);
      
      // Find and add its expanded entries, sorted by timestamp
      const parentId = parentLog.id;
      const childLogs = expandedLogs
        .filter(log => log.id.startsWith(parentId + '-log-'))
        .sort((a, b) => {
          const timestampA = new Date(a.timestamp).getTime();
          const timestampB = new Date(b.timestamp).getTime();
          return timestampA - timestampB;
        });
      
      groupedLogs.push(...childLogs);
    });
    
    // Replace the original logs array with the grouped and sorted logs
    logs.length = 0;
    logs.push(...groupedLogs);

    return {
      logs: logs,
      total: logs.length,
      pagination: {
        offset: offset,
        limit: limit,
        hasMore: logs.length === limit, // If we got exactly the limit, there might be more
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(logs.length / limit) // This is an estimate, not exact total
      }
    };

  } catch (error) {
    console.error('Coralogix API error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    
    throw new Error(`Coralogix API error: ${error.response?.status} - ${error.response?.data?.message || error.message}`);
  }
};

// Helper function to convert time range to milliseconds
const getTimeRangeMs = (timeRange) => {
  const timeRanges = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000
  };
  return timeRanges[timeRange] || timeRanges['1h'];
};

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Coralogix logs server is running',
    coralogixConfigured: !!config.CORALOGIX_API_KEY
  });
});

// Search logs endpoint
app.post('/api/logs/search', async (req, res) => {
  try {
    const { path: inputPath, timeRange = '1h', page = 1, pageSize = 100 } = req.body;
    
    if (!inputPath || !inputPath.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Path is required'
      });
    }

    // Extract and normalize the path
    const searchPath = extractDocumentPath(inputPath);
    
    if (!searchPath) {
      return res.status(400).json({
        success: false,
        error: 'Invalid path format'
      });
    }

    // Calculate pagination parameters
    const offset = (page - 1) * pageSize;
    
    
    // Search Coralogix logs
    const result = await searchCoralogixLogs(searchPath, timeRange, offset, pageSize);
    
    res.json({
      success: true,
      searchPath: searchPath,
      originalPath: inputPath,
      logs: result.logs || [],
      total: result.total || 0,
      pagination: result.pagination || null,
      timeRange: timeRange
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to search logs',
      details: error.message
    });
  }
});

// Get available time ranges
app.get('/api/logs/time-ranges', (req, res) => {
  res.json({
    success: true,
    timeRanges: [
      { value: '15m', label: 'Last 15 minutes' },
      { value: '1h', label: 'Last 1 hour' },
      { value: '4h', label: 'Last 4 hours' },
      { value: '24h', label: 'Last 24 hours' },
      { value: '7d', label: 'Last 7 days' }
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Coralogix logs server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Frontend should run on: http://localhost:9092`);
  if (!config.CORALOGIX_API_KEY) {
    console.warn('⚠️  Coralogix API key not configured - logs search will not work');
  }
});
