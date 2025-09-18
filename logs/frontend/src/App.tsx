import React, { useState, useEffect } from 'react';
import './App.css';
import LogsViewer from './components/LogsViewer';

interface LogEntry {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  status: string;
  type: string;
  severity: string;
  applicationName: string;
  message: string;
  level: string;
  event: {
    userData: any;
    metadata: any;
    labels: any;
    logEntry?: any;
  };
}

function App() {
  const [searchPath, setSearchPath] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('1h');
  const [total, setTotal] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load search history from localStorage on component mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('coralogix-search-history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setSearchHistory(parsedHistory);
      } catch (e) {
        console.warn('Failed to parse search history from localStorage:', e);
      }
    }
  }, []);

  // Save search history to localStorage whenever it changes
  useEffect(() => {
    if (searchHistory.length > 0) {
      localStorage.setItem('coralogix-search-history', JSON.stringify(searchHistory));
    }
  }, [searchHistory]);

  // Function to add search to history
  const addToHistory = (path: string) => {
    if (!path.trim()) return;
    
    setSearchHistory(prevHistory => {
      // Remove the path if it already exists
      const filteredHistory = prevHistory.filter(item => item !== path);
      // Add to beginning and keep only last 10
      return [path, ...filteredHistory].slice(0, 10);
    });
  };

  // Function to select path from history
  const selectFromHistory = (path: string) => {
    setSearchPath(path);
    setShowHistory(false);
  };

  // Function to clear history
  const clearHistory = () => {
    setSearchHistory([]);
    setShowHistory(false);
  };

  // Function to extract document path from various URL formats (same as admin app)
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

    // Remove file extension for logs search
    path = path.replace(/\.[^/.]+$/, '');

    return path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPath.trim()) return;

    // Add to search history
    addToHistory(searchPath);

    // Extract the actual document path from various URL formats
    const extractedPath = extractDocumentPath(searchPath);
    
    if (!extractedPath) {
      setError('Invalid path format');
      return;
    }

    setLoading(true);
    setError(null);
    setLogs([]);
    setTotal(0);

    try {
      const response = await fetch('/api/logs/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: searchPath,
          timeRange: timeRange
        })
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to search logs');
      }

      console.log('API Response - Total logs:', result.logs.length);
      console.log('API Response - Expanded entries:', result.logs.filter((log: any) => log.id.includes('-log-')).length);
      console.log('Sample expanded entry:', result.logs.find((log: any) => log.id.includes('-log-')));

      setLogs(result.logs);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search logs');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-top">
          <h1>Coralogix Logs Search</h1>
          <div className="search-info">
            {total > 0 && (
              <span className="results-count">
                {total} log entries found
              </span>
            )}
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="search-form">
          <div className="form-group">
            <label htmlFor="searchPath">Search Path:</label>
            <div className="input-container">
              <input
                type="text"
                id="searchPath"
                value={searchPath}
                onChange={(e) => setSearchPath(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                placeholder="e.g., owner/repo/path or https://main--repo--owner.aem.page/a/b/c"
                required
              />
              {searchHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="history-toggle"
                  title="Show search history"
                >
                  📋
                </button>
              )}
              {showHistory && searchHistory.length > 0 && (
                <div className="history-dropdown">
                  <div className="history-header">
                    <span>Recent Searches</span>
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
                    {searchHistory.map((path, index) => (
                      <div
                        key={index}
                        className="history-item"
                        onClick={() => selectFromHistory(path)}
                      >
                        {path}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {searchPath && extractDocumentPath(searchPath) !== searchPath && (
              <small className="path-extraction-indicator">
                🔍 Will search for: <code>{extractDocumentPath(searchPath)}</code>
              </small>
            )}
          </div>
          
          <div className="form-group">
            <label htmlFor="timeRange">Time Range:</label>
            <select
              id="timeRange"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="time-range-select"
            >
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last 1 hour</option>
              <option value="4h">Last 4 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>
          
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search Logs'}
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

        {logs.length > 0 && (
          <LogsViewer logs={logs} />
        )}
      </main>
    </div>
  );
}

export default App;