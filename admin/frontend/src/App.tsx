import React, { useState, useEffect } from 'react';
import './App.css';
import DocumentViewer from './components/DocumentViewer';
import VersionsList from './components/VersionsList';

interface DocumentData {
  metadata: {
    contentLength: number;
    contentType: string;
    originalContentType?: string; // Only present for version previews
    lastModified: string;
    etag: string;
    metadata: Record<string, string>;
    // Additional S3 metadata fields
    contentEncoding: string | null;
    contentLanguage: string | null;
    contentDisposition: string | null;
    cacheControl: string | null;
    expires: string | null;
    storageClass: string | null;
    serverSideEncryption: string | null;
    versionId: string | null;
    checksumCRC32: string | null;
    checksumCRC32C: string | null;
    checksumSHA1: string | null;
    checksumSHA256: string | null;
    acceptRanges: string | null;
    partsCount: number | null;
    objectLockMode: string | null;
    objectLockRetainUntilDate: string | null;
    objectLockLegalHoldStatus: string | null;
    replicationStatus: string | null;
    // File analysis
    detectedEncoding: string;
    hasBOM: boolean;
  };
  content: string;
  isTextContent: boolean;
  contentType: string;
  textAnalysis?: {
    lineEndingType: string;
    lineCount: number;
    charCount: number;
    nonWhitespaceCount: number;
  } | null;
}

interface Version {
  key: string;
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  lastModified: string;
  metadata: { [key: string]: string };
  contentType: string | null;
}

function App() {
  const [documentPath, setDocumentPath] = useState('');
  const [documentData, setDocumentData] = useState<DocumentData | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DocumentData | null>(null);
  const [selectedVersionPath, setSelectedVersionPath] = useState<string | null>(null);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load document path and URL history from localStorage on component mount
  useEffect(() => {
    const savedPath = localStorage.getItem('s3-document-path');
    if (savedPath) {
      setDocumentPath(savedPath);
    }
    
    const savedHistory = localStorage.getItem('s3-url-history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setUrlHistory(parsedHistory);
      } catch (e) {
        console.warn('Failed to parse URL history from localStorage:', e);
      }
    }
  }, []);

  // Save document path to localStorage whenever it changes
  useEffect(() => {
    if (documentPath) {
      localStorage.setItem('s3-document-path', documentPath);
    } else {
      localStorage.removeItem('s3-document-path');
    }
  }, [documentPath]);

  // Save URL history to localStorage whenever it changes
  useEffect(() => {
    if (urlHistory.length > 0) {
      localStorage.setItem('s3-url-history', JSON.stringify(urlHistory));
    }
  }, [urlHistory]);

  // Function to add URL to history
  const addToHistory = (url: string) => {
    if (!url.trim()) return;
    
    setUrlHistory(prevHistory => {
      // Remove the URL if it already exists
      const filteredHistory = prevHistory.filter(item => item !== url);
      // Add to beginning and keep only last 10
      return [url, ...filteredHistory].slice(0, 10);
    });
  };

  // Function to select URL from history
  const selectFromHistory = (url: string) => {
    setDocumentPath(url);
    setShowHistory(false);
  };

  // Function to clear history
  const clearHistory = () => {
    setUrlHistory([]);
    setShowHistory(false);
    localStorage.removeItem('s3-url-history');
  };

  // Function to extract document path from various URL formats
  const extractDocumentPath = (input: string): string => {
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

    // Add default .html extension if no extension is provided
    if (path && !path.includes('.') && !path.endsWith('/')) {
      path = path + '.html';
    }

    return path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentPath.trim()) return;

    // Add to URL history
    addToHistory(documentPath);

    // Extract the actual document path from various URL formats
    const extractedPath = extractDocumentPath(documentPath);
    
    if (!extractedPath) {
      setError('Invalid document path format');
      return;
    }

    setLoading(true);
    setError(null);
    setDocumentData(null);
    setVersions([]);
    setSelectedVersion(null);
    setSelectedVersionPath(null);

    try {
      // Fetch document data using the extracted path
      const docResponse = await fetch(`/api/document/${encodeURIComponent(extractedPath)}`);
      const docResult = await docResponse.json();

      if (!docResult.success) {
        throw new Error(docResult.error || 'Failed to fetch document');
      }

      setDocumentData(docResult);

      // Fetch versions using the extracted path
      const versionsResponse = await fetch(`/api/versions/${encodeURIComponent(extractedPath)}`);
      const versionsResult = await versionsResponse.json();

      if (versionsResult.success) {
        setVersions(versionsResult.versions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVersionPreview = async (versionPath: string) => {
    try {
      // Pass the original document's content type as a query parameter
      const originalContentType = documentData?.contentType || '';
      const url = `/api/version/${encodeURIComponent(versionPath)}?originalContentType=${encodeURIComponent(originalContentType)}`;
      
      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch version');
      }

      setSelectedVersion(result);
      setSelectedVersionPath(versionPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview version');
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>S3 Document Admin</h1>
        <form onSubmit={handleSubmit} className="document-form">
          <div className="form-group">
            <label htmlFor="documentPath">Document Path:</label>
            <div className="input-container">
              <input
                type="text"
                id="documentPath"
                value={documentPath}
                onChange={(e) => setDocumentPath(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                placeholder="e.g., owner/repo/path/test.html or https://da.live/edit#/owner/repo/path/test.html"
                required
              />
              {urlHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="history-toggle"
                  title="Show URL history"
                >
                  📋
                </button>
              )}
              {showHistory && urlHistory.length > 0 && (
                <div className="history-dropdown">
                  <div className="history-header">
                    <span>Recent URLs</span>
                    <button
                      type="button"
                      onClick={clearHistory}
                      className="clear-history-btn"
                      title="Clear history"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="history-list">
                    {urlHistory.map((url, index) => (
                      <div
                        key={index}
                        className="history-item"
                        onClick={() => selectFromHistory(url)}
                      >
                        {url}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {localStorage.getItem('s3-document-path') && (
              <small className="persistence-indicator">
                💾 Path saved locally
              </small>
            )}
            {documentPath && extractDocumentPath(documentPath) !== documentPath && (
              <small className="path-extraction-indicator">
                🔍 Will use: <code>{extractDocumentPath(documentPath)}</code>
              </small>
            )}
            <small className="extension-reminder">
              ⚠️ File extension (.html, .json, etc.) must be included in the path
            </small>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Load Document'}
          </button>
        </form>
      </header>

      <main className="App-main">
        {error && (
          <div className="error-message">
            <h3>Error:</h3>
            <p>{error}</p>
          </div>
        )}

        {documentData && (
          <div className="document-section">
            <h2>Document</h2>
            <DocumentViewer document={documentData} />
          </div>
        )}

        {versions.length > 0 && (
          <div className="versions-container">
            <div className="versions-section">
              <h2>Versions ({versions.length})</h2>
              <VersionsList 
                versions={versions} 
                onVersionPreview={handleVersionPreview}
                selectedVersionPath={selectedVersionPath}
              />
            </div>
            
            <div className="version-preview-section">
              <h2>Version Preview</h2>
              {selectedVersion ? (
                <DocumentViewer document={selectedVersion} versionPath={selectedVersionPath || undefined} />
              ) : (
                <div className="no-selection">
                  <p>Click "Preview" on any version to view its content here.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;