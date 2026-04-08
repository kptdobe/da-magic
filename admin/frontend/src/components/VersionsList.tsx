import React from 'react';

interface Version {
  key: string;
  path: string;
  filename: string;
  size: number;
  sizeFormatted: string;
  lastModified: string;
  metadata: { [key: string]: string };
  contentType: string | null;
  location: 'legacy' | 'new';
}

interface VersionsListProps {
  versions: Version[];
  auditContent: string | null;
  onVersionPreview: (versionPath: string) => void;
  selectedVersionPath?: string | null;
}

interface VersionTableProps {
  versions: Version[];
  onVersionPreview: (versionPath: string) => void;
  selectedVersionPath?: string | null;
}

const VersionTable: React.FC<VersionTableProps> = ({ versions, onVersionPreview, selectedVersionPath }) => (
  <>
    <div className="versions-header">
      <div className="version-header-filename">Filename</div>
      <div className="version-header-label">Label</div>
      <div className="version-header-size">Size</div>
      <div className="version-header-date">Last Modified</div>
      <div className="version-header-actions">Actions</div>
    </div>
    {versions.map((version) => {
      const isSelected = selectedVersionPath === version.key;
      return (
        <div
          key={version.key}
          className={`version-item ${isSelected ? 'version-item-selected' : ''}`}
        >
          <div className="version-filename" title={version.path}>
            {version.filename}
          </div>
          <div className="version-label" title={version.metadata.label || 'No label'}>
            {version.metadata.label || '-'}
          </div>
          <div className="version-size">{version.sizeFormatted}</div>
          <div className="version-date">
            {new Date(version.lastModified).toLocaleString()}
          </div>
          <div className="version-actions">
            <button onClick={() => onVersionPreview(version.key)} className="preview-button">
              Preview
            </button>
          </div>
        </div>
      );
    })}
  </>
);

const VersionsList: React.FC<VersionsListProps> = ({ versions, auditContent, onVersionPreview, selectedVersionPath }) => {
  const newVersions = versions.filter(v => v.location === 'new');
  const legacyVersions = versions.filter(v => v.location === 'legacy');

  if (versions.length === 0 && !auditContent) {
    return (
      <div className="no-versions-message">
        No versions found for this document
      </div>
    );
  }

  return (
    <div className="versions-list">
      {(newVersions.length > 0 || auditContent) && (
        <div className="versions-group versions-group-new">
          <div className="versions-group-header">
            <span className="versions-group-label">New location</span>
            <span className="versions-group-path">org/repo/.da-versions/</span>
          </div>
          {auditContent && (
            <div className="audit-section">
              <div className="audit-title">audit.txt</div>
              <pre className="audit-content">{auditContent}</pre>
            </div>
          )}
          {newVersions.length > 0 && (
            <VersionTable
              versions={newVersions}
              onVersionPreview={onVersionPreview}
              selectedVersionPath={selectedVersionPath}
            />
          )}
        </div>
      )}

      {legacyVersions.length > 0 && (
        <div className="versions-group versions-group-legacy">
          <div className="versions-group-header">
            <span className="versions-group-label">Legacy location</span>
            <span className="versions-group-path">org/.da-versions/</span>
          </div>
          <VersionTable
            versions={legacyVersions}
            onVersionPreview={onVersionPreview}
            selectedVersionPath={selectedVersionPath}
          />
        </div>
      )}
    </div>
  );
};

export default VersionsList;
