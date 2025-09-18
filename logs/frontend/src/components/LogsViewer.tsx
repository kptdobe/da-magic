import React, { useState } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  status: string;
  type: string;
  severity: string;
  applicationName: string;
  event: {
    userData: any;
    metadata: any;
    labels: any;
  };
}

interface LogsViewerProps {
  logs: LogEntry[];
}

const LogsViewer: React.FC<LogsViewerProps> = ({ logs }) => {
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  // Get unique severities for filter
  const severities = Array.from(new Set(logs.map(log => log.severity || 'unknown')));

  // Filter logs based on severity and search text
  const filteredLogs = logs.filter(log => {
    const matchesSeverity = filterSeverity === 'all' || log.severity === filterSeverity;
    const matchesSearch = !searchText || 
      JSON.stringify(log.event.userData).toLowerCase().includes(searchText.toLowerCase()) ||
      log.applicationName?.toLowerCase().includes(searchText.toLowerCase()) ||
      log.type?.toLowerCase().includes(searchText.toLowerCase());
    
    return matchesSeverity && matchesSearch;
  });

  const formatTimestamp = (timestamp: string) => {
    // Parse UTC timestamp and convert to local timezone
    // Ensure the timestamp is treated as UTC by adding 'Z' if not present
    const utcTimestamp = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
    const date = new Date(utcTimestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3, // Include milliseconds
      hour12: false,
      timeZoneName: 'short'
    });
  };


  const getStatusColor = (status: string | number) => {
    const statusNum = typeof status === 'string' ? parseInt(status) : status;
    if (statusNum >= 200 && statusNum < 300) return '#28a745'; // Green for 2xx
    if (statusNum >= 300 && statusNum < 400) return '#ffc107'; // Yellow for 3xx
    if (statusNum >= 400 && statusNum < 500) return '#fd7e14'; // Orange for 4xx
    if (statusNum >= 500) return '#dc3545'; // Red for 5xx
    return '#6c757d'; // Gray for others
  };


  const formatLogText = (text: string) => {
    // Basic JSON formatting if the text looks like JSON
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  };

  return (
    <div className="logs-viewer">
      <div className="logs-controls">
        <div className="filter-controls">
          <div className="filter-group">
            <label htmlFor="severityFilter">Filter by Severity:</label>
            <select
              id="severityFilter"
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="severity-filter"
            >
              <option value="all">All Severities</option>
              {severities.map(severity => (
                <option key={severity} value={severity}>
                  {severity.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="searchText">Search in logs:</label>
            <input
              type="text"
              id="searchText"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search log content..."
              className="log-search-input"
            />
          </div>
        </div>
        
        <div className="logs-stats">
          <span>Showing {filteredLogs.length} of {logs.length} logs</span>
          <span style={{ marginLeft: '20px', fontSize: '12px', color: '#666' }}>
            Times converted from UTC to {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
        </div>
      </div>

      <div className="logs-container">
        <div className="logs-list">
                <div className="logs-header">
                  <div className="log-column timestamp">Timestamp</div>
                  <div className="log-column url">URL</div>
                  <div className="log-column method">Method</div>
                  <div className="log-column status">Status</div>
                  <div className="log-column type">Type</div>
                </div>
          
          {filteredLogs.map((log, index) => (
            <div
              key={log.id || index}
              className={`log-entry ${selectedLog?.id === log.id ? 'selected' : ''}`}
              onClick={() => setSelectedLog(log)}
            >
              <div className="log-column timestamp">
                {formatTimestamp(log.timestamp)}
              </div>
              <div className="log-column url" title={log.url}>
                {log.url}
              </div>
              <div className="log-column method">
                {log.method}
              </div>
              <div 
                className="log-column status"
                style={{ color: getStatusColor(log.status) }}
              >
                {log.status}
              </div>
              <div className="log-column type">
                {log.type || 'N/A'}
              </div>
            </div>
          ))}
        </div>

        {selectedLog && (
          <div className="log-detail">
            <div className="log-detail-header">
              <h3>Log Details</h3>
              <button 
                onClick={() => setSelectedLog(null)}
                className="close-detail-btn"
              >
                ✕
              </button>
            </div>
            
            <div className="log-detail-content">
              <div className="detail-section">
                <h4>Request Information</h4>
                <div className="detail-grid">
                  <div className="detail-item">
                    <strong>Timestamp:</strong> {formatTimestamp(selectedLog.timestamp)}
                  </div>
            <div className="detail-item">
              <strong>Type:</strong> {selectedLog.type || 'N/A'}
            </div>
                  <div className="detail-item">
                    <strong>URL:</strong> {selectedLog.url}
                  </div>
                  <div className="detail-item">
                    <strong>Method:</strong> {selectedLog.method}
                  </div>
                  <div className="detail-item">
                    <strong>Status:</strong> 
                    <span style={{ color: getStatusColor(selectedLog.status) }}>
                      {selectedLog.status}
                    </span>
                  </div>
                </div>
              </div>
              
        <div className="detail-section">
          <h4>Log Message</h4>
          <pre className="log-message">
            {formatLogText(JSON.stringify(selectedLog.event.userData))}
          </pre>
        </div>
              
              <div className="detail-section">
                <h4>Event Data</h4>
                <pre className="raw-data">
                  {JSON.stringify(selectedLog.event, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsViewer;
