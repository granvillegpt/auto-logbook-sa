# Logbook Engine Lab

Standalone Express backend for testing the pure logbook engine with real Google routing and export capabilities.

## Setup

### Quick Start (Recommended)

```bash
cd logbook-engine-core/lab
./start.sh
```

The script will:
- Install dependencies automatically
- Create `.env` from `.env.example` if needed
- Check for port availability and use 3001 if 3000 is busy
- Start the server

**Important:** After first run, edit `.env` and add your `GOOGLE_MAPS_API_KEY`.

### Manual Setup

1. **Install dependencies:**
   ```bash
   cd logbook-engine-core/lab
   npm install
   ```

2. **Configure Google Maps API Key:**
   ```bash
   cp .env.example .env
   # Edit .env and set your GOOGLE_MAPS_API_KEY
   ```

   Get your API key from: https://console.cloud.google.com/google/maps-apis
   
   Enable the **Routes API** for your project.

3. **Start the server:**
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```
   (or http://localhost:3001 if port 3000 was busy)

## API Endpoints

### GET /
Upload form for generating logbooks.

### POST /run
Generate logbook from Excel file.

**Request (multipart/form-data):**
- `file` (file): Excel route list file
- `homeAddress` (string): Home/base address
- `openingKm` (number): Starting odometer reading
- `startDate` (string): Start date (YYYY-MM-DD)
- `endDate` (string): End date (YYYY-MM-DD)
- `currentWeek` (number): Current week cycle (1-4)
- `leaveDays` (optional, string): Comma-separated dates or JSON array

**Response:**
HTML page showing results with first 50 entries and download links.

### GET /download/:runId.csv
Download logbook as CSV file.

### GET /download/:runId.xlsx
Download logbook as XLSX file.

### GET /download/:runId.pdf
Download logbook as PDF file.

## Excel File Format

The Excel file must have the following columns:

**Required:**
- `Address` - Client address

**Optional:**
- `Customer` or `Client` - Customer name (defaults to address if missing)
- `Suburb` or `City` - Suburb/city name
- `Mon` or `Monday` - Checkbox (true/false/1/0/x)
- `Tue` or `Tuesday` - Checkbox
- `Wed` or `Wednesday` - Checkbox
- `Thu` or `Thursday` - Checkbox
- `Fri` or `Friday` - Checkbox
- `Sat` or `Saturday` - Checkbox
- `Weeks` or `Week` - Comma-separated week numbers (1,2,3,4) - defaults to all weeks

## Cache

### Location
Cache file: `logbook-engine-core/lab/.cache/distances.json`

### How it works
- Distances are cached by origin -> destination key
- Cache persists between server restarts
- Cached distances are reused to avoid API calls

### Clear cache
Delete the cache file:
```bash
rm logbook-engine-core/lab/.cache/distances.json
```

Or restart the server and the cache will be rebuilt as needed.

## Verifying Real Distances

To confirm distances are from Google Routes API (not mocked):

1. **Check the result page** - Look for "source" field in totals/metadata (if displayed)
2. **Check cache file** - Open `.cache/distances.json` and verify entries have `"source": "google-routes"`
3. **Monitor console** - Server logs will show "Routing service initialized with Google Routes API"
4. **Test with invalid API key** - You'll get an error if routing fails
5. **Compare distances** - Real Google Routes API distances will vary by route, not be fixed 10km

## Architecture

- **Engine**: Pure logbook engine in `../src/logbookEngine.js` (no Firebase)
- **Routing**: Pluggable interface with Google Distance Matrix API implementation
- **Caching**: File-based cache with in-memory mutex for concurrency safety
- **Exports**: CSV, XLSX, and PDF generation
- **Storage**: In-memory results store (no database)

## Notes

- **TESTING ONLY**: This lab is for testing the logbook engine in isolation.
- **PRODUCTION EXPORT**: Production logbook exports use `functions/src/logbook/exportLogbook.js` (Cloud Function callable).
- This is a **local dev lab only** - no production deployment
- No Firebase, Firestore, or Cloud Storage dependencies
- No lifecycle logic, versioning, or locking
- Results stored in memory (cleared on server restart)
- Max upload size: 10MB
- Google API has rate limits - cache helps reduce API calls
