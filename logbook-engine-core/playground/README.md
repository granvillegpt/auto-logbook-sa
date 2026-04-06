# Logbook Engine Playground

Standalone test harness for the pure logbook engine.

## Setup

1. Start a local server (no npm install needed - uses CDN for xlsx):
```bash
cd logbook-engine-core/playground
npx serve .
```

Or use any other static file server:
```bash
python3 -m http.server 8000
# etc.
```

2. Open `http://localhost:3000` (or your server's URL) in your browser.

**Note:** The playground uses ES modules, so you must serve it via HTTP (not file://).

**Alternative:** If you prefer to use npm-installed xlsx instead of CDN:
1. Run `npm install` in the playground directory
2. Use a bundler (Vite, webpack, etc.) to bundle the modules

## Usage

1. Upload an Excel route list file
2. Enter:
   - Home address
   - Opening KM
   - Start date
   - End date
   - Current week (1-4)
3. Click "Run Logbook Engine"
4. View totals and logbook entries

## Excel File Format

The Excel file should have columns:
- Address (required)
- Customer/Client (optional, defaults to address)
- Suburb/City (optional)
- Mon/Monday (checkbox)
- Tue/Tuesday (checkbox)
- Wed/Wednesday (checkbox)
- Thu/Thursday (checkbox)
- Fri/Friday (checkbox)
- Sat/Saturday (checkbox)
- Weeks (optional, comma-separated: 1,2,3,4)

## Notes

- This is a pure local testing environment
- No Firebase, no Firestore, no Cloud Storage
- No lifecycle logic, no versioning, no locking
- Mock routing service returns fixed 10km distances

