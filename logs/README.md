# Coralogix Logs Search App

A React-based interface for searching and viewing logs from Coralogix, with the same URL filtering logic as the admin app.

## Features

- **URL Path Filtering**: Same intelligent path extraction as the admin app
  - Supports AEM URLs: `https://main--repo--owner.aem.page/a/b/c`
  - Supports hash-based paths: `https://da.live/edit#/owner/repo/path`
  - Supports direct paths: `owner/repo/path`
  - Automatically removes file extensions for log search
- **Search History**: Remembers last 10 searches with localStorage persistence
- **Time Range Filtering**: Search logs from last 15 minutes to 7 days
- **Visual Log Display**: 
  - Tabular view with timestamp, severity, application, subsystem, and message
  - Color-coded severity levels
  - Detailed log viewer with raw JSON data
  - Filter by severity and search within log content
- **Responsive Design**: Works on desktop and mobile devices

## Setup

### 1. Coralogix Credentials

You need to obtain the following credentials from your Coralogix dashboard:

1. **API Key (CX API Key)**: 
   - Go to [Coralogix Dashboard](https://app.coralogix.com/)
   - Navigate to Settings → API Keys
   - Create a new **CX API Key** (not the regular API key)
   - This is required for the DataPrime API integration

2. **Application Name**: 
   - The name of your application in Coralogix
   - Usually matches your service/application name
   - Used to filter logs by application

3. **Subsystem Name** (optional):
   - The subsystem name if you use subsystems
   - Can be left empty for default
   - Used to filter logs by subsystem

4. **Endpoint** (optional):
   - Default: `https://api.coralogix.com`
   - Use different endpoint if you're on a different region (e.g., `https://api.eu.coralogix.com` for EU)

**Important**: This integration uses the [Coralogix DataPrime API](https://coralogix.com/docs/dataprime/API/direct-archive-query-http/) which requires a **CX API Key** with DataPrime permissions.

### 2. Environment Configuration

Update the `.dev.vars` file in the project root with your Coralogix credentials:

```bash
# Coralogix API credentials
CORALOGIX_API_KEY=your_actual_api_key_here
CORALOGIX_QUERY_ENDPOINT=https://api.coralogix.com
```

### 3. Install Dependencies

```bash
# Backend dependencies
cd logs/backend
npm install

# Frontend dependencies
cd ../frontend
npm install
```

## Running the App

### Option 1: Use the startup script (recommended)

```bash
cd logs
./start.sh
```

This will start both frontend (port 9092) and backend (port 9093) servers.

### Option 2: Start manually

**Terminal 1 - Backend:**
```bash
cd logs/backend
npm start
```

**Terminal 2 - Frontend:**
```bash
cd logs/frontend
PORT=9092 npm start
```

## Usage

1. **Open the app**: Navigate to `http://localhost:9092`
2. **Enter a path**: Use any of the supported URL formats:
   - `owner/repo/path` (direct path)
   - `https://main--repo--owner.aem.page/a/b/c` (AEM URL)
   - `https://da.live/edit#/owner/repo/path` (hash-based URL)
3. **Select time range**: Choose how far back to search (15 minutes to 7 days)
4. **Search**: Click "Search Logs" to find matching log entries
5. **View details**: Click on any log entry to see full details and raw JSON

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/logs/search` - Search logs
- `GET /api/logs/time-ranges` - Get available time ranges

## URL Path Processing

The app uses the same intelligent path extraction as the admin app:

1. **AEM URLs**: `https://main--repo--owner.aem.page/a/b/c` → `owner/repo/a/b/c`
2. **Hash URLs**: `https://da.live/edit#/owner/repo/path` → `owner/repo/path`
3. **Direct paths**: `owner/repo/path` → `owner/repo/path`
4. **Extension removal**: `path.html` → `path`

## Troubleshooting

### Common Issues

1. **"Coralogix API key not configured"**
   - Check that `CORALOGIX_API_KEY` is set in `.dev.vars`
   - Verify the API key is valid and has proper permissions

2. **"Coralogix search failed"**
   - Check your application name and subsystem name
   - Verify the endpoint URL is correct
   - Check if your Coralogix account has logs in the specified time range

3. **No logs found**
   - Try expanding the time range
   - Check if the path format is correct
   - Verify logs exist in Coralogix for that path

### Debug Mode

Check the browser console and backend terminal for detailed error messages.

## Development

The app follows the same patterns as the admin app:
- TypeScript for type safety
- React hooks for state management
- Express.js backend with CORS
- Axios for API calls
- localStorage for persistence
