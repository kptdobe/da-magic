# Cloudflare KV Export

Export all keys and values from a Cloudflare KV namespace.

## Setup

1. Install dependencies:
```bash
cd config
npm install
```

2. Configure `.dev.vars` (in the parent directory) with:
```
CF_ACCOUNT_ID=your-cloudflare-account-id
CF_API_TOKEN=your-api-token-with-kv-read-permissions
```

## Getting Credentials

### Account ID
- Go to Cloudflare Dashboard
- Select your domain
- Copy Account ID from the right sidebar

### API Token
- Go to: https://dash.cloudflare.com/profile/api-tokens
- Click "Create Token"
- Use "Edit Cloudflare Workers" template or custom with:
  - Permissions: Account > Workers KV Storage > Read
  - Account Resources: Include > Your Account

### Namespace ID
```bash
# List all KV namespaces
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces" \
  -H "Authorization: Bearer {api_token}"
```

Or use Wrangler:
```bash
wrangler kv:namespace list
```

## Usage

### Using the shell wrapper:
```bash
./kv-export.sh <namespace-id> [output-file]
```

### Using Node.js directly:
```bash
node cloudflare-kv-export.js <namespace-id> [output-file]
```

### Examples:
```bash
# Export to default file (kv-export.json)
./kv-export.sh abc123def456

# Export to custom file
./kv-export.sh abc123def456 production-config.json

# Export multiple namespaces
./kv-export.sh namespace-1 export-1.json
./kv-export.sh namespace-2 export-2.json
```

## Output Format

The export file is a JSON object:
```json
{
  "namespace_id": "abc123...",
  "account_id": "xyz789...",
  "exported_at": "2024-01-15T10:30:00.000Z",
  "total_keys": 150,
  "successful_exports": 150,
  "failed_exports": 0,
  "data": [
    {
      "key": "config:app",
      "value": { "theme": "dark", "version": "1.2.3" },
      "metadata": null,
      "expiration": null
    },
    {
      "key": "user:123",
      "value": "simple string value",
      "metadata": { "created": "2024-01-01" },
      "expiration": 1704153600
    }
  ]
}
```

## Features

- **Rate-limited fetching**: Fetches 5 values concurrently with 100ms delays to respect API limits
- **Progress tracking**: Shows real-time progress with retry counts
- **Auto-retry with backoff**: Automatically retries rate-limited requests (429 errors) with exponential backoff
- **JSON parsing**: Automatically parses JSON values
- **Metadata preservation**: Includes key metadata and expiration
- **Error handling**: Continues on individual key failures

## Performance

- Small namespaces (<100 keys): ~5-10 seconds
- Medium namespaces (100-1000 keys): ~30-90 seconds  
- Large namespaces (1000+ keys): ~2-5 minutes

Note: Conservative rate limiting prevents 429 errors but increases total time.

## Limitations

- Cloudflare KV API rate limits apply:
  - Free plan: ~1200 reads/min
  - Paid plan: Higher limits but still enforced
- Script automatically throttles to ~300 reads/min to stay well under limits
- Retries with exponential backoff on 429 errors (2s, 4s, 8s delays)
- Large values may take longer to fetch
- Binary values are not supported (exported as base64 strings)

