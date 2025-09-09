# S3 Document Admin Interface

A React-based admin interface for viewing S3 documents and their versions, with a Node.js backend.

This interface is https://da.live specific.

## Features

- **Document Viewer**: View S3 documents with proper rendering for HTML, JSON, and images
- **Version Management**: List all versions of a document with sorting by modification date
- **Version Preview**: Preview any version of a document
- **Metadata Display**: Show complete document metadata including custom fields
- **Responsive Design**: Works on desktop and mobile devices

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- S3 credentials in `.dev.vars` file

#### Required Environment Variables

Create a `.dev.vars` file in the project root with the following variables:

```bash
# S3/Custom Storage Configuration
S3_ACCESS_KEY_ID=your_access_key_id
S3_SECRET_ACCESS_KEY=your_secret_access_key
S3_DEF_URL=https://your-storage-endpoint.com
```

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd admin/backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the backend server:
   ```bash
   npm start
   ```

   The backend will run on `http://localhost:9091`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd admin/frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the React development server:
   ```bash
   npm start
   ```

   The frontend will run on `http://localhost:9090`

## Quick Start

### Option 1: One-Command Startup (Recommended)

**Linux/macOS:**
```bash
cd admin
./start.sh
```

**Windows:**
```cmd
cd admin
start.bat
```

This will automatically:
- Install dependencies if needed
- Start the backend server on port 9091
- Start the frontend server on port 9090
- Open both in separate terminal windows

### Option 2: Manual Startup

If you prefer to start servers manually:

**Backend:**
```bash
cd admin/backend
npm install
npm start
```

**Frontend (in a new terminal):**
```bash
cd admin/frontend
npm install
npm start
```

## Usage

1. Open your browser and go to `http://localhost:9090`
2. Enter a document path (e.g., `owner/repo/path/test.html`)
3. Click "Load Document" to fetch the document and its versions
4. View the document content and metadata
5. Browse through versions and click "Preview" to view any version

## API Endpoints

- `GET /api/document/:path` - Get document metadata and content
- `GET /api/versions/:path` - Get list of document versions
- `GET /api/version/:path` - Get specific version content
- `GET /api/health` - Health check endpoint

## Content Type Support

- **HTML/XML**: Rendered in an iframe
- **JSON**: Pretty-printed with syntax highlighting
- **Images**: Displayed directly in the browser
- **Text**: Shown as preformatted text
- **Binary**: Download link provided

## Development

### Backend Development
```bash
cd admin/backend
npm run dev  # Uses nodemon for auto-restart
```

### Frontend Development
```bash
cd admin/frontend
npm start  # Hot reload enabled
```

## Project Structure

```
admin/
├── backend/
│   ├── server.js          # Express server with S3 integration
│   └── package.json       # Backend dependencies
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── DocumentViewer.tsx  # Document display component
│   │   │   └── VersionsList.tsx    # Versions list component
│   │   ├── App.tsx        # Main React component
│   │   └── App.css        # Styles
│   └── package.json       # Frontend dependencies
└── README.md
```
