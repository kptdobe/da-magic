import React from 'react';

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
      // Format HTML with proper indentation
      const formatHtml = (html: string): string => {
        // Basic HTML formatting with indentation
        let formatted = html
          .replace(/></g, '>\n<') // Add newlines between tags
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n');
        
        // Add indentation
        let indentLevel = 0;
        const indentSize = 2;
        const lines = formatted.split('\n');
        const indentedLines = lines.map(line => {
          const trimmed = line.trim();
          
          // Decrease indent for closing tags
          if (trimmed.startsWith('</')) {
            indentLevel = Math.max(0, indentLevel - 1);
          }
          
          const indented = ' '.repeat(indentLevel * indentSize) + trimmed;
          
          // Increase indent for opening tags (but not self-closing tags)
          if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>')) {
            indentLevel++;
          }
          
          return indented;
        });
        
        return indentedLines.join('\n');
      };

      return (
        <div className="html-content">
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
        <div className="metadata-grid">
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
          {Object.keys(metadata.metadata).length > 0 && (
            <div className="metadata-item">
              <strong>Custom Metadata:</strong>
              <ul>
                {Object.entries(metadata.metadata).map(([key, value]) => (
                  <li key={key}>
                    <strong>{key}:</strong> {value}
                  </li>
                ))}
              </ul>
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
