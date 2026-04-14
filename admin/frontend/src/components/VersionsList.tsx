import React, { useState } from 'react';

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

interface AuditFile {
  filename: string;
  key: string;
  content: string;
}

interface VersionsListProps {
  versions: Version[];
  auditFiles: AuditFile[];
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

// New format: tab-separated lines — col[4] is the version id (empty = audit-only entry)
const countNewFormat = (files: AuditFile[]) => {
  let versions = 0;
  let audit = 0;
  for (const file of files) {
    for (const line of file.content.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length >= 5 && cols[4].trim()) {
        versions++;
      } else {
        audit++;
      }
    }
  }
  return { versions, audit };
};

const VersionsList: React.FC<VersionsListProps> = ({ versions, auditFiles, onVersionPreview, selectedVersionPath }) => {
  const newVersions = versions.filter(v => v.location === 'new');
  const legacyVersions = versions.filter(v => v.location === 'legacy');
  const [newCollapsed, setNewCollapsed] = useState(false);
  const [legacyCollapsed, setLegacyCollapsed] = useState(false);

  // New format counts come from parsing the audit file lines
  const newCounts = countNewFormat(auditFiles);
  // Legacy format: size > 0 = version snapshot, size === 0 = audit-only entry
  const legacyCounts = {
    versions: legacyVersions.filter(v => v.size > 0).length,
    audit: legacyVersions.filter(v => v.size === 0).length,
  };

  if (versions.length === 0 && auditFiles.length === 0) {
    return (
      <div className="no-versions-message">
        No versions found for this document
      </div>
    );
  }

  return (
    <div className="versions-list">
      {(newVersions.length > 0 || auditFiles.length > 0) && (
        <div className="versions-group versions-group-new">
          <button
            className="versions-group-header versions-group-toggle"
            onClick={() => setNewCollapsed(c => !c)}
            aria-expanded={!newCollapsed}
          >
            <span className="versions-group-collapse-arrow">{newCollapsed ? '▶' : '▼'}</span>
            <span className="versions-group-label">New location</span>
            <span className="versions-group-path">org/repo/.da-versions/</span>
            <span className="versions-group-counts">
              <span className="versions-group-count versions-group-count-versions">{newCounts.versions} versions</span>
              <span className="versions-group-count versions-group-count-audit">{newCounts.audit} audit</span>
            </span>
          </button>
          {!newCollapsed && (
            <>
              {auditFiles.map((auditFile) => (
                <div key={auditFile.key} className="audit-section">
                  <div className="audit-title">{auditFile.filename}</div>
                  <pre className="audit-content">{auditFile.content}</pre>
                </div>
              ))}
              {newVersions.length > 0 && (
                <VersionTable
                  versions={newVersions}
                  onVersionPreview={onVersionPreview}
                  selectedVersionPath={selectedVersionPath}
                />
              )}
            </>
          )}
        </div>
      )}

      {legacyVersions.length > 0 && (
        <div className="versions-group versions-group-legacy">
          <button
            className="versions-group-header versions-group-toggle"
            onClick={() => setLegacyCollapsed(c => !c)}
            aria-expanded={!legacyCollapsed}
          >
            <span className="versions-group-collapse-arrow">{legacyCollapsed ? '▶' : '▼'}</span>
            <span className="versions-group-label">Legacy location</span>
            <span className="versions-group-path">org/.da-versions/</span>
            <span className="versions-group-counts">
              <span className="versions-group-count versions-group-count-versions">{legacyCounts.versions} versions</span>
              <span className="versions-group-count versions-group-count-audit">{legacyCounts.audit} audit</span>
            </span>
          </button>
          {!legacyCollapsed && (
            <VersionTable
              versions={legacyVersions}
              onVersionPreview={onVersionPreview}
              selectedVersionPath={selectedVersionPath}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default VersionsList;
