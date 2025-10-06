import React, { useState } from 'react';

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

interface DocumentViewerProps {
  document: DocumentData;
  versionPath?: string; // Optional version path for display
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ document, versionPath }) => {
  const { metadata, content, isTextContent, contentType, textAnalysis } = document;
  const [indentHtml, setIndentHtml] = useState(true);

  // HTML formatting function
  const formatHtml = (html: string): string => {
    if (!indentHtml) return html;
    
    // Split HTML into tokens (tags and text)
    const tokens = html.match(/<[^>]*>|[^<]+/g) || [];
    const lines: string[] = [];
    let indentLevel = 0;
    const indentSize = 2;
    let i = 0;
    
    while (i < tokens.length) {
      const token = tokens[i].trim();
      if (!token) {
        i++;
        continue;
      }
      
      // Handle opening tags
      if (token.startsWith('<') && !token.startsWith('</') && !token.endsWith('/>')) {
        const tagName = token.match(/<(\w+)/)?.[1];
        const currentIndent = ' '.repeat(indentLevel * indentSize);
        
        // Check if this is an empty tag (opening tag followed immediately by closing tag)
        if (i + 1 < tokens.length) {
          const nextToken = tokens[i + 1].trim();
          if (nextToken === `</${tagName}>`) {
            // Empty tag - keep on same line
            lines.push(currentIndent + token + nextToken);
            i += 2; // Skip both opening and closing tags
            continue;
          }
        }
        
        // Regular opening tag - collect all content until closing tag
        let content = token;
        let j = i + 1;
        let foundClosingTag = false;
        
        // Look ahead to collect all content until the matching closing tag
        while (j < tokens.length) {
          const nextToken = tokens[j].trim();
          
          if (nextToken === `</${tagName}>`) {
            // Found closing tag - add it and break
            content += nextToken;
            foundClosingTag = true;
            break;
          } else if (nextToken.startsWith('<') && !nextToken.startsWith('</') && !nextToken.endsWith('/>')) {
            // Found nested opening tag - this is complex content, break and handle normally
            break;
          } else if (nextToken.endsWith('/>')) {
            // Found self-closing tag - add it to content
            content += nextToken;
          } else {
            // Add text content
            content += nextToken;
          }
          j++;
        }
        
        if (foundClosingTag) {
          // Simple content - keep on one line
          lines.push(currentIndent + content);
          i = j + 1;
        } else {
          // Complex content - handle normally
          lines.push(currentIndent + token);
          indentLevel++;
          i++;
        }
      }
      // Handle closing tags
      else if (token.startsWith('</')) {
        indentLevel = Math.max(0, indentLevel - 1);
        lines.push(' '.repeat(indentLevel * indentSize) + token);
        i++;
      }
      // Handle self-closing tags
      else if (token.endsWith('/>')) {
        lines.push(' '.repeat(indentLevel * indentSize) + token);
        i++;
      }
      // Handle text content - keep it with its parent tag
      else {
        const text = token.replace(/\s+/g, ' ').trim();
        if (text) {
          // Check if there's a previous line and it's an opening tag
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            const lastLineTrimmed = lastLine.trim();
            
            // If last line is an opening tag, append text to it
            if (lastLineTrimmed.startsWith('<') && !lastLineTrimmed.startsWith('</') && !lastLineTrimmed.endsWith('/>')) {
              lines[lines.length - 1] = lastLine + text;
            } else {
              // Otherwise, add as new line
              lines.push(' '.repeat(indentLevel * indentSize) + text);
            }
          } else {
            lines.push(' '.repeat(indentLevel * indentSize) + text);
          }
        }
        i++;
      }
    }
    
    return lines.join('\n');
  };

  const renderContent = () => {
    if (!isTextContent) {
      // For binary content (images, etc.)
      if (contentType.startsWith('image/')) {
        return (
          <div className="image-container">
            <img 
              src={`data:${contentType};base64,${content}`} 
              alt="Document content"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        );
      } else {
        return (
          <div className="binary-content">
            <p>Binary content detected (Content-Type: {contentType})</p>
            <p>Size: {metadata.contentLength} bytes</p>
            <a 
              href={`data:${contentType};base64,${content}`} 
              download="document"
              className="download-link"
            >
              Download File
            </a>
          </div>
        );
      }
    }

    // For text content
    if (contentType === 'application/json') {
      try {
        const jsonData = JSON.parse(content);
        return (
          <pre className="json-content">
            {JSON.stringify(jsonData, null, 2)}
          </pre>
        );
      } catch (e) {
        return <pre className="text-content">{content}</pre>;
      }
    }

    if (contentType === 'text/html' || contentType === 'application/xml') {
      return (
        <div className="html-content">
          <div className="html-controls">
            <button
              onClick={() => setIndentHtml(!indentHtml)}
              className={`indent-toggle ${indentHtml ? 'active' : ''}`}
              title={indentHtml ? 'Disable indentation' : 'Enable indentation'}
            >
              {indentHtml ? '📐 Raw' : '📐 Indent'}
            </button>
          </div>
          <pre className="html-source">
            {formatHtml(content)}
          </pre>
        </div>
      );
    }

    // For plain text
    return <pre className="text-content">{content}</pre>;
  };

  return (
    <div className="document-viewer">
      {versionPath && (
        <div className="version-path-section">
          <h3>Version Path</h3>
          <div className="version-path">
            <code>{versionPath}</code>
          </div>
        </div>
      )}
      <div className="metadata-section">
        <h3>Metadata</h3>
        <div className="metadata-two-column">
          <div className="metadata-left-column">
            <h4 style={{ marginTop: 0, marginBottom: '10px', color: '#666' }}>Basic Information</h4>
            <div className="metadata-item">
              <strong>Content Type:</strong> {metadata.contentType}
              {metadata.originalContentType && metadata.originalContentType !== metadata.contentType && (
                <div className="content-type-note">
                  <small>
                    <strong>Note:</strong> Using original document content type for rendering: <code>{metadata.originalContentType}</code>
                  </small>
                </div>
              )}
            </div>
            <div className="metadata-item">
              <strong>Size:</strong> {metadata.contentLength.toLocaleString()} bytes
            </div>
            <div className="metadata-item">
              <strong>Last Modified:</strong> {new Date(metadata.lastModified).toLocaleString()}
            </div>
            <div className="metadata-item">
              <strong>ETag:</strong> {metadata.etag}
            </div>
            
            <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>File Encoding & Analysis</h4>
            <div className="metadata-item">
              <strong>Detected Encoding:</strong> {metadata.detectedEncoding || 'Unknown'}
              {metadata.hasBOM && <span style={{ color: '#e67e22', marginLeft: '8px' }}>(with BOM)</span>}
            </div>
            {textAnalysis && (
              <>
                <div className="metadata-item">
                  <strong>Line Endings:</strong> {textAnalysis.lineEndingType}
                </div>
                <div className="metadata-item">
                  <strong>Line Count:</strong> {textAnalysis.lineCount.toLocaleString()}
                </div>
                <div className="metadata-item">
                  <strong>Character Count:</strong> {textAnalysis.charCount.toLocaleString()}
                </div>
                <div className="metadata-item">
                  <strong>Non-Whitespace Characters:</strong> {textAnalysis.nonWhitespaceCount.toLocaleString()}
                </div>
              </>
            )}
            
            {(metadata.contentEncoding || metadata.contentLanguage || metadata.contentDisposition) && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Content Properties</h4>
                {metadata.contentEncoding && (
                  <div className="metadata-item">
                    <strong>Content Encoding:</strong> {metadata.contentEncoding}
                  </div>
                )}
                {metadata.contentLanguage && (
                  <div className="metadata-item">
                    <strong>Content Language:</strong> {metadata.contentLanguage}
                  </div>
                )}
                {metadata.contentDisposition && (
                  <div className="metadata-item">
                    <strong>Content Disposition:</strong> {metadata.contentDisposition}
                  </div>
                )}
              </>
            )}
          </div>
          
          <div className="metadata-right-column">
            {(metadata.cacheControl || metadata.expires) && (
              <>
                <h4 style={{ marginTop: 0, marginBottom: '10px', color: '#666' }}>Caching</h4>
                {metadata.cacheControl && (
                  <div className="metadata-item">
                    <strong>Cache Control:</strong> {metadata.cacheControl}
                  </div>
                )}
                {metadata.expires && (
                  <div className="metadata-item">
                    <strong>Expires:</strong> {new Date(metadata.expires).toLocaleString()}
                  </div>
                )}
              </>
            )}
            
            {(metadata.storageClass || metadata.serverSideEncryption || metadata.versionId || metadata.acceptRanges || metadata.partsCount) && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Storage & Security</h4>
                {metadata.storageClass && (
                  <div className="metadata-item">
                    <strong>Storage Class:</strong> {metadata.storageClass}
                  </div>
                )}
                {metadata.serverSideEncryption && (
                  <div className="metadata-item">
                    <strong>Server-Side Encryption:</strong> {metadata.serverSideEncryption}
                  </div>
                )}
                {metadata.versionId && (
                  <div className="metadata-item">
                    <strong>Version ID:</strong> <code>{metadata.versionId}</code>
                  </div>
                )}
                {metadata.acceptRanges && (
                  <div className="metadata-item">
                    <strong>Accept Ranges:</strong> {metadata.acceptRanges}
                  </div>
                )}
                {metadata.partsCount && (
                  <div className="metadata-item">
                    <strong>Parts Count:</strong> {metadata.partsCount}
                  </div>
                )}
              </>
            )}
            
            {(metadata.checksumCRC32 || metadata.checksumCRC32C || metadata.checksumSHA1 || metadata.checksumSHA256) && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Checksums</h4>
                {metadata.checksumCRC32 && (
                  <div className="metadata-item">
                    <strong>CRC32:</strong> <code>{metadata.checksumCRC32}</code>
                  </div>
                )}
                {metadata.checksumCRC32C && (
                  <div className="metadata-item">
                    <strong>CRC32C:</strong> <code>{metadata.checksumCRC32C}</code>
                  </div>
                )}
                {metadata.checksumSHA1 && (
                  <div className="metadata-item">
                    <strong>SHA1:</strong> <code>{metadata.checksumSHA1}</code>
                  </div>
                )}
                {metadata.checksumSHA256 && (
                  <div className="metadata-item">
                    <strong>SHA256:</strong> <code>{metadata.checksumSHA256}</code>
                  </div>
                )}
              </>
            )}
            
            {(metadata.objectLockMode || metadata.objectLockRetainUntilDate || metadata.objectLockLegalHoldStatus) && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Object Lock</h4>
                {metadata.objectLockMode && (
                  <div className="metadata-item">
                    <strong>Lock Mode:</strong> {metadata.objectLockMode}
                  </div>
                )}
                {metadata.objectLockRetainUntilDate && (
                  <div className="metadata-item">
                    <strong>Retain Until:</strong> {new Date(metadata.objectLockRetainUntilDate).toLocaleString()}
                  </div>
                )}
                {metadata.objectLockLegalHoldStatus && (
                  <div className="metadata-item">
                    <strong>Legal Hold:</strong> {metadata.objectLockLegalHoldStatus}
                  </div>
                )}
              </>
            )}
            
            {metadata.replicationStatus && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Replication</h4>
                <div className="metadata-item">
                  <strong>Status:</strong> {metadata.replicationStatus}
                </div>
              </>
            )}
            
            {Object.keys(metadata.metadata).length > 0 && (
              <>
                <h4 style={{ marginTop: '20px', marginBottom: '10px', color: '#666' }}>Custom Metadata</h4>
                <div className="metadata-item custom-metadata">
                  <ul>
                    {Object.entries(metadata.metadata).map(([key, value]) => (
                      <li key={key}>
                        <strong>{key}:</strong> {value}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="content-section">
        <h3>Content</h3>
        {renderContent()}
      </div>
    </div>
  );
};

export default DocumentViewer;
