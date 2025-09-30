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
}

interface VersionsListProps {
  versions: Version[];
  onVersionPreview: (versionPath: string) => void;
  selectedVersionPath?: string | null;
}

const VersionsList: React.FC<VersionsListProps> = ({ versions, onVersionPreview, selectedVersionPath }) => {
  return (
    <div className="versions-list">
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
            <div className="version-size">
              {version.sizeFormatted}
            </div>
            <div className="version-date">
              {new Date(version.lastModified).toLocaleString()}
            </div>
            <div className="version-actions">
              <button 
                onClick={() => onVersionPreview(version.key)}
                className="preview-button"
              >
                Preview
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default VersionsList;
