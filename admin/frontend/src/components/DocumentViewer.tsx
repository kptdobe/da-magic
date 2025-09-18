import React, { useState } from 'react';

interface DocumentData {
  metadata: {
    contentLength: number;
    contentType: string;
    originalContentType?: string; // Only present for version previews
    lastModified: string;
    etag: string;
    metadata: Record<string, string>;
  };
  content: string;
  isTextContent: boolean;
  contentType: string;
}

interface DocumentViewerProps {
  document: DocumentData;
  versionPath?: string; // Optional version path for display
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ document, versionPath }) => {
  const { metadata, content, isTextContent, contentType } = document;
  const [indentHtml, setIndentHtml] = useState(false);

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
              <strong>Size:</strong> {metadata.contentLength} bytes
            </div>
            <div className="metadata-item">
              <strong>Last Modified:</strong> {new Date(metadata.lastModified).toLocaleString()}
            </div>
            <div className="metadata-item">
              <strong>ETag:</strong> {metadata.etag}
            </div>
          </div>
          {Object.keys(metadata.metadata).length > 0 && (
            <div className="metadata-right-column">
              <div className="metadata-item custom-metadata">
                <strong>Custom Metadata:</strong>
                <ul>
                  {Object.entries(metadata.metadata).map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {value}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
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
