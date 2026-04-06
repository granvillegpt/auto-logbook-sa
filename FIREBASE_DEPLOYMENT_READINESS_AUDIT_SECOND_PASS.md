# Firebase Deployment Readiness Audit — Second Pass (Verification)

**Audit date:** 2025-03-14  
**Purpose:** Verify that previously identified deployment fixes were applied and confirm readiness for Firebase Hosting + Cloud Functions.  
**Rules:** Audit only — no code changes, no refactors, no fixes.

---

## SECTION 1 — Template Path Fix

**Check:** `public/index.html` template download links and folder name.

**Verified:**
- Line 109: `href="templates/sales_rep_route_template.xlsx"` — lowercase `templates/`.
- Line 114: `href="templates/business_travel_template.xlsx"` — lowercase `templates/`.
- No references to `Templates/` (capital T) remain in the file.
- Folder on disk: `public/templates/` (lowercase) — confirmed via `ls public/`.
- Files present: `public/templates/sales_rep_route_template.xlsx`, `public/templates/business_travel_template.xlsx`.
- Links are relative to `index.html`; when served from site root they resolve to `/templates/...`.

**Result: PASS**

---

## SECTION 2 — Engine Deployment Location

**Check:** Engine scripts under `public/engine/` and `logbook.html` script references.

**Verified:**
- `public/engine/logbookEngine.js` — exists.
- `public/engine/parseRouteListExcel.js` — exists.
- `public/engine/parsers/` — exists; contains `businessRouteParser.js`.
- `public/engine/routing/` — exists; contains `distanceMatrixRouting.js`, `googleGeocodeService.js`, `mockRouting.js`.

**logbook.html script tags (lines 472–478):**
- `engine/parseRouteListExcel.js`
- `engine/parsers/businessRouteParser.js`
- `engine/dateRange.js`
- `engine/logbookEngine.js`
- `engine/routing/distanceMatrixRouting.js`
- `engine/routing/googleGeocodeService.js`

Paths are relative; with hosting root = `public/`, they resolve to `public/engine/...`. No path mismatch.

**Result: PASS**

---

## SECTION 3 — Static Asset Validation

**Check:** Referenced assets exist on disk.

| Referenced path | Location | Exists |
|-----------------|----------|--------|
| `assets/images/hero_image1.png` | index.html | Yes |
| `assets/logos/logo.png` | index.html | Yes |
| `assets/logos/favicon.ico` | index.html, admin | Yes |
| `assets/logos/auto_logbook_favicon-white.png` | logbook.html | Yes |
| `assets/logos/auto_logbook_logo-white%20(1).png` | logbook.html | Yes (file: `auto_logbook_logo-white (1).png`) |
| `assets/payment/Payfast logo.png` | index.html | Yes |
| `assets/payment/Visa.png` | index.html | Yes |
| `assets/payment/Master Card.png` | index.html | Yes |
| `assets/payment/Capitec Pay - colour.png` | index.html | Yes |
| `assets/payment/instantEFT_hi-Res_logo_png.png` | index.html | Yes |
| `templates/example-logbook.pdf` | index.html (iframe) | Yes |

**Missing assets:** None. All referenced files exist under `public/`.

**Result: PASS** (with filename caveats in Section 6)

---

## SECTION 4 — PDF Preview Validation

**Check:** Example logbook modal iframe path.

**Verified:**
- `public/index.html` (lines 202–205): iframe `src="templates/example-logbook.pdf#page=1&view=FitH&toolbar=0"`.
- Path is relative; no leading slash, no `file://` or localhost.
- File exists: `public/templates/example-logbook.pdf`.
- Fragment (`#page=1&view=FitH&toolbar=0`) is client-side only; no server dependency.

**Result: PASS**

---

## SECTION 5 — JavaScript Path / API Validation

**Check:** `/api/*` usage and any localhost URLs.

**Verified:**
- `public/engine/routing/googleGeocodeService.js`: `GEOCODE_URL = '/api/geocode'`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`.
- `public/engine/routing/distanceMatrixRouting.js`: `API_PATH = '/api/distancematrix'`.
- `public/js/local-config.js`: comment states browser calls `/api/geocode`, etc.; server proxies with key.
- No hardcoded `localhost` or `127.0.0.1` in HTML or JS.
- Only `file://` mention is in a comment in `public/js/app.js` (“Works with file:// (relative paths only)”); no runtime dependency on file protocol.

**Conclusion:** These endpoints are expected to be provided by a backend (e.g. Cloud Functions). The app is structured for Hosting (static) + Cloud Functions (API). No localhost URLs remain.

**Result: PASS** (with requirement that Cloud Functions or equivalent implement the `/api/*` routes)

---

## SECTION 6 — File Name Safety Check

**Scan:** Assets with spaces, uppercase folder refs, or special characters.

**Findings:**

| File / reference | Issue | Safe alternative (recommendation only) |
|------------------|--------|----------------------------------------|
| `assets/payment/Payfast logo.png` | Space in filename | e.g. `payfast-logo.png` |
| `assets/payment/Master Card.png` | Space | e.g. `mastercard.png` |
| `assets/payment/Capitec Pay - colour.png` | Spaces, hyphen | e.g. `capitec-pay-colour.png` |
| `assets/payment/instantEFT_hi-Res_logo_png.png` | Hyphen | e.g. `instanteft.png` (optional) |
| `assets/logos/auto_logbook_logo-white (1).png` | Space, parentheses | e.g. `auto_logbook_logo-white.png` |

**Uppercase folder references:** None. All HTML uses lowercase `templates/`, `assets/`, etc.

**No renames were performed.** Recommendations only; deployment may still work with current names on many hosts, but lowercase, no-space names reduce risk on case-sensitive or strict servers.

**Result: PASS** (with recommended cleanup for robustness)

---

## SECTION 7 — Deployment Structure

**Check:** Final structure under `public/` and that no critical frontend files sit outside `public/`.

**Verified structure:**
```
public/
  index.html
  logbook.html
  engine/
    logbookEngine.js
    parseRouteListExcel.js
    dateRange.js
    workflow2TemplateParser.js
    parsers/
    routing/
    exports/
  css/
  js/
  assets/
    images/
    logos/
    payment/
  templates/
  samples/
  admin/
  data/
```

No script or asset references in `index.html` or `logbook.html` point outside `public/`. All required runtime files for the frontend (HTML, CSS, JS, engine, assets, templates) are under `public/`.

**Result: PASS**

---

## SECTION 8 — Firebase Hosting Compatibility

**Check:** Deploy with `hosting.public = "public"` and need for rewrites.

**Verified:**
- No `firebase.json` found in the project root. One must be added for deployment.
- With `"public": "public"`, Firebase will serve `public/` as the site root. All current links are relative and will resolve correctly.
- No SPA-style routing was found; no rewrites are required for basic static + engine behavior. Optional: rewrites for pretty URLs (e.g. `/generate` → `/logbook.html`) can be added later if desired.

**Suggested minimal `firebase.json`:**
```json
{
  "hosting": {
    "public": "public"
  }
}
```

**Result: PASS** (add `firebase.json` before first deploy)

---

## SECTION 9 — Final Deployment Status

### PASS / FAIL summary

| Section | Result |
|---------|--------|
| 1. Template path fix | PASS |
| 2. Engine deployment location | PASS |
| 3. Static asset validation | PASS |
| 4. PDF preview validation | PASS |
| 5. JavaScript / API validation | PASS |
| 6. File name safety | PASS (with recommendations) |
| 7. Deployment structure | PASS |
| 8. Firebase Hosting compatibility | PASS (firebase.json must be added) |

### Prerequisites for deployment

1. **Add `firebase.json`** with `"hosting": { "public": "public" }`.
2. **Backend for `/api/*`:** Geocoding, Places, and Distance Matrix require a server (e.g. Cloud Functions) that implements `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`, `/api/distancematrix`. Without them, logbook generation will not have real geocode/distance data (mock/fallback only).
3. **Optional:** Rename payment and logo assets to avoid spaces/special characters (Section 6) for maximum compatibility.

### Final verdict

**SAFE TO DEPLOY** for Firebase Hosting (static app), provided:

- `firebase.json` is added with `public: "public"`.
- It is understood that full logbook functionality (address resolution, distances) depends on deploying Cloud Functions (or another backend) that implement the `/api/*` endpoints used by the engine.

The previously identified deployment issues (template path case, engine location) have been verified as fixed. The app is in a state suitable for Firebase Hosting + Cloud Functions deployment from an audit perspective.

---

*End of second-pass audit.*
