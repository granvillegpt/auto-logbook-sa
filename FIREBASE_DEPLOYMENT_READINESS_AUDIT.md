# Firebase Deployment-Readiness Audit
## Standalone Auto Logbook SA App

**Audit date:** 2025-03-14  
**Scope:** Static app deployed to Firebase Hosting only (no Firebase Auth/Database in scope).  
**Rules:** Audit only — no code changes, no refactors, no fixes implemented.

---

## PASS / FAIL Summary

| Area | Result | Notes |
|------|--------|--------|
| 1. File paths / static assets | **FAIL** | Case mismatch (Templates vs templates), filenames with spaces/special chars |
| 2. PDF / iframe / modal preview | **PASS** | Relative path; fragment params are client-side |
| 3. Template downloads | **FAIL** | Wrong case: `Templates/` in HTML, folder is `templates/` |
| 4. Hero image / static media | **PASS** | Relative paths; one logo filename has space (risk) |
| 5. Navigation / hash links / routing | **PASS** | Hash and relative links are hosting-safe |
| 6. JavaScript dependencies | **FAIL** | `/api/*` calls require a server; engine lives outside `public/` |
| 7. Form / generation flow | **FAIL** | Geocode + Distance Matrix depend on server APIs |
| 8. Payment-readiness prerequisites | **WARN** | Static assets and paths must be fixed first |
| 9. Firebase Hosting compatibility | **FAIL** | No firebase.json; API routes need backend or Cloud Functions |
| **Overall** | **NOT SAFE TO DEPLOY** | Fix critical and medium issues before Firebase Hosting deploy |

---

## 1. Critical Issues

### C1. Template download links use wrong case (404 on Firebase)
- **Where:** `public/index.html` lines 109, 114.
- **Current:** `href="Templates/sales_rep_route_template.xlsx"` and `href="Templates/business_travel_template.xlsx"`.
- **Actual folder:** `public/templates/` (lowercase).
- **Risk:** Firebase Hosting (Linux) is case-sensitive. Requests to `Templates/...` will 404.
- **Required fix:** Change to `templates/` (lowercase) in both links.

### C2. Logbook page depends on `engine/` scripts that are outside `public/`
- **Where:** `public/logbook.html` lines 466–472.
- **Current:** Scripts loaded as `engine/parseRouteListExcel.js`, `engine/parsers/...`, `engine/routing/...`, etc.
- **Reality:** Folder `engine/` exists at **project root** (`standalone-logbook-app/engine/`), **not** inside `public/`.
- **Risk:** With standard Firebase Hosting, only `public/` is deployed. All `engine/*.js` requests will 404 and the logbook page will be broken.
- **Required fix:** Either (a) copy or move the entire `engine/` tree into `public/engine/` before deploy, or (b) use a build step that bundles/inlines and ensure deployed output includes engine scripts under the same paths.

### C3. Geocoding and Distance Matrix require a backend (not available on static hosting)
- **Where:**  
  - `engine/routing/googleGeocodeService.js`: `GEOCODE_URL = '/api/geocode'`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`.  
  - `engine/routing/distanceMatrixRouting.js`: `API_PATH = '/api/distancematrix'`.  
  - `public/js/local-config.js`: comments state browser calls `/api/geocode`, etc.; server proxies with key.
- **Reality:** These routes are implemented in `server.js` (Node). Firebase Hosting serves only static files; there is no Node server in the hosting deploy.
- **Risk:** All address resolution and distance calculations will 404. Logbook generation (route resolution, distances) will fail or fall back to mocks only.
- **Required fix:** Either (a) add Firebase Cloud Functions (or another backend) to proxy Google Geocoding/Places/Distance Matrix and keep the same `/api/*` contract, or (b) document that the app is “demo only” on static hosting (geocode/distance disabled or mocked) and that full flow requires a server.

---

## 2. Medium-Risk Issues

### M1. Payment and other asset filenames with spaces or special characters
- **Where:** `public/index.html` (payment strip and any other asset references).
- **Examples:**  
  - `assets/payment/Payfast logo.png` (space)  
  - `assets/payment/Master Card.png` (space)  
  - `assets/payment/Capitec Pay - colour.png` (spaces, hyphen)  
  - `assets/payment/instantEFT_hi-Res_logo_png.png` (hyphen)
- **Risk:** Some CDNs/servers may normalize or encode URLs differently; spaces and special chars can cause 404 or encoding bugs.
- **Recommendation:** Prefer lowercase, no spaces (e.g. `payfast-logo.png`, `mastercard.png`, `capitec-pay-colour.png`, `instanteft.png`). Rename files and update references.

### M2. Logbook page logo filename with space
- **Where:** `public/logbook.html` line 12.
- **Current:** `src="assets/logos/auto_logbook_logo-white%20(1).png"` (space encoded as `%20`).
- **Risk:** If the actual file is named with a literal space, encoding is correct but the filename is fragile; if the file is renamed, the reference breaks.
- **Recommendation:** Rename to something like `auto_logbook_logo-white.png` and update the `src`.

### M3. Admin page uses `../` relative paths
- **Where:** `public/admin/reviews.html`: `href="../css/styles.css"`, `href="../assets/logos/favicon.ico"`, `href="../index.html"`.
- **Risk:** When the app is at the root (e.g. `https://site.web.app/`), `admin/reviews.html` is at `https://site.web.app/admin/reviews.html`. Resolving `../css/styles.css` gives `https://site.web.app/css/styles.css`. That is correct and will work on Firebase Hosting.
- **Status:** OK for default hosting; only a risk if you use rewrites that change URL structure (e.g. no `.html` or different base path). Document that admin URL is `/admin/reviews.html`.

### M4. No `firebase.json`
- **Where:** Project root; no `firebase.json` found.
- **Risk:** Default deploy target and `public` directory may be wrong; no control over headers, redirects, or rewrites.
- **Recommendation:** Add `firebase.json` with at least `"public": "public"` and, if needed, rewrites/headers (see Section 9).

### M5. Excel template filenames with spaces (in folder)
- **Where:** `public/templates/`: `sales_rep_route_template.xlsx`, `business_travel_template.xlsx` (no spaces in these; folder has `example-logbook.pdf`).
- **Note:** A file `~$business_travel_template.xlsx` (Excel lock file) was present; exclude from deploy or it may be served.
- **Recommendation:** Ensure only the two intended xlsx files and the PDF are deployed; ignore `~$*` in firebase ignore or build.

---

## 3. Low-Risk / Cleanup Items

### L1. Comments reference `file://`
- **Where:** `public/css/styles.css` line 1: “file:// compatible”; `public/js/app.js` line 3: “Works with file:// (relative paths only)”.
- **Risk:** None for hosting; only documentation.
- **Recommendation:** Optional: update to “Static hosting compatible” or similar.

### L2. `reviews.js` and review service
- **Where:** `public/js/services/reviewService.js` uses `localStorage` when `STORAGE_MODE === 'local'`; no fetch to `/api/reviews` from the landing page.
- **Risk:** None for static hosting; reviews work client-side only. If you later add Firestore, you’ll switch `STORAGE_MODE` and implement the firebase placeholders.
- **Recommendation:** None for this audit.

### L3. `data/reviews.json`
- **Where:** `public/data/reviews.json` exists; not referenced in the grep/search (reviews are from reviewService/localStorage).
- **Risk:** Low; if anything fetches `data/reviews.json`, use a relative path and it will work.
- **Recommendation:** Confirm whether this file is used; if not, remove or document.

### L4. Samples folder
- **Where:** `public/samples/` (e.g. `sample-general-logbook.pdf`, `sample-sales-rep-logbook.pdf`).
- **Risk:** No references found in current HTML/JS; if you add links later, use relative paths like `samples/...`.
- **Recommendation:** None for paths; keep if you plan to link to samples.

### L5. Favicon and logo consistency
- **Where:** `index.html` uses `assets/logos/favicon.ico` and `assets/logos/logo.png`; `logbook.html` uses a different favicon and logo (white variant).
- **Risk:** None for deployment; only consistency.
- **Recommendation:** Optional: align naming and paths for easier maintenance.

---

## 4. PDF / Iframe / Modal Preview (Example Logbook)

- **Iframe src:** `templates/example-logbook.pdf#page=1&view=FitH&toolbar=0` (relative).
- **Behavior:** Relative path resolves correctly from the page URL (e.g. `https://site.web.app/index.html` → `https://site.web.app/templates/example-logbook.pdf`). Fragment (`#page=1&view=FitH&toolbar=0`) is client-side only; no server interaction.
- **Verdict:** **PASS** for Firebase Hosting, assuming `public/templates/example-logbook.pdf` is deployed and the folder is `templates` (lowercase).

---

## 5. Template Downloads (Excel)

- **Links:**  
  - Sales Rep: `Templates/sales_rep_route_template.xlsx`  
  - Business Travel: `Templates/business_travel_template.xlsx`  
- **Issue:** Case mismatch (see C1). Folder is `templates/`.
- **Verdict:** **FAIL** until links use `templates/` (lowercase). After fix, no other path issues for static hosting.

---

## 6. Hero Image / Static Media

- **Hero:** `assets/images/hero_image1.png` — relative, fine.
- **Index logos:** `assets/logos/logo.png`, `assets/logos/favicon.ico` — relative, fine.
- **Payment strip:** All under `assets/payment/`; filenames with spaces/special chars (see M1).
- **Verdict:** **PASS** for path shape; **medium risk** on payment asset filenames.

---

## 7. Navigation / Hash Links / Routing

- **Index:** `#how-it-works`, `#templates`, `#generate` — hash links work on static hosting.
- **Cross-page:** `index.html`, `logbook.html`, `index.html#templates` — relative, correct.
- **Admin:** `../index.html` from `admin/reviews.html` resolves to site root — correct.
- **Verdict:** **PASS**.

---

## 8. JavaScript Dependencies (localhost / server assumptions)

- **`/api/*`:** All geocode, Places, and distance matrix calls assume a server (see C3). On pure static hosting they will 404.
- **`localStorage` / `sessionStorage`:** Used for routes and reviews; works on any origin; no localhost assumption.
- **No `file://` or hardcoded localhost in JS:** Only comments mention file://; no code paths depend on it.
- **Verdict:** **FAIL** for full app functionality due to `/api/*`; **PASS** for client-only features (reviews, modals, static content).

---

## 9. Form / Generation Flow

- **Upload:** File input and client-side parsing (SheetJS, engine) do not require a server.
- **Geocoding and distances:** Depend on `/api/geocode`, `/api/findPlace`, `/api/placeDetails`, `/api/distancematrix`. Without a backend, these fail and the flow is degraded or mock-only.
- **Download:** Logbook generation and download are client-side (blob/download); no server needed.
- **Verdict:** **FAIL** for “full” flow on static-only hosting; **PASS** for upload + client-side parse + download if geocode/distance are mocked or disabled.

---

## 10. Payment-Readiness Prerequisites (no implementation)

- **Static asset readiness:** Fix C1 and M1 so all payment and template paths are correct and robust.
- **Success page:** Not implemented; no success URL or redirect to audit; document when you add PayFast.
- **Form/session persistence:** Current flow uses `localStorage`; no server session; fine for static hosting until you add a backend for payments.
- **Download flow:** Post-payment download would need a secure URL or backend; out of scope for this audit.
- **Verdict:** Fix path/case and filename issues before PayFast integration; no other blocking items identified for “static app only.”

---

## 11. Firebase Hosting Compatibility and firebase.json

- **Plain Firebase Hosting:** Serves only static files. No Node, no `/api/*` unless provided by Cloud Functions or another backend.
- **Required for current app:**
  1. Deploy the **contents** of `public/` (or ensure `engine/` is inside the deployed directory — see C2).
  2. Fix **Templates → templates** (C1).
  3. Either add a backend (e.g. Cloud Functions) for `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`, `/api/distancematrix`, or accept a demo/mock-only logbook on static hosting.

**Suggested `firebase.json` (minimal):**

```json
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**",
      "**/*.md"
    ]
  }
}
```

- **Optional rewrites:** If you want pretty URLs (e.g. `/generate` → `logbook.html`), add:

```json
"hosting": {
  "public": "public",
  "rewrites": [
    { "source": "/generate", "destination": "/logbook.html" }
  ]
}
```

- **Headers:** Optional cache control for static assets; not required for correctness.
- **Redirects:** None required for current links.

---

## Recommended File Renames (to reduce risk)

| Current | Recommended |
|--------|-------------|
| `assets/payment/Payfast logo.png` | `assets/payment/payfast-logo.png` |
| `assets/payment/Master Card.png` | `assets/payment/mastercard.png` |
| `assets/payment/Capitec Pay - colour.png` | `assets/payment/capitec-pay.png` |
| `assets/payment/instantEFT_hi-Res_logo_png.png` | `assets/payment/instanteft.png` |
| `assets/logos/auto_logbook_logo-white (1).png` | `assets/logos/auto_logbook_logo-white.png` |

(Update all HTML/CSS references to match.)

---

## Recommended Path Fixes

| Location | Current | Change to |
|----------|---------|-----------|
| `index.html` (template links) | `Templates/sales_rep_route_template.xlsx` | `templates/sales_rep_route_template.xlsx` |
| `index.html` (template links) | `Templates/business_travel_template.xlsx` | `templates/business_travel_template.xlsx` |

(No change to `templates/example-logbook.pdf` — already lowercase.)

---

## Firebase Deployment Checklist

- [ ] Fix template links: `Templates/` → `templates/` in `index.html`.
- [ ] Ensure `engine/` is deployed: copy/move `engine/` into `public/engine/` or add a build step that includes it.
- [ ] Decide geocode/distance strategy: add Cloud Functions (or other backend) for `/api/*`, or document “demo/mock only” on static.
- [ ] Add `firebase.json` with `"public": "public"` (and optional rewrites/ignore).
- [ ] (Recommended) Rename payment and logo assets to avoid spaces/special chars; update references.
- [ ] Exclude `~$*.xlsx` and other temp files from deploy (e.g. `.firebaserc` / ignore patterns).
- [ ] Test deploy to a staging Firebase Hosting channel: open index, logbook, admin, template downloads, example PDF modal, payment strip images.
- [ ] Verify hash links (`#how-it-works`, `#templates`, `#generate`) and cross-page links from index and logbook.

---

## Safe to Deploy?

**Conclusion: NOT SAFE TO DEPLOY** for a fully working app until:

1. **Critical:** Template links use `templates/` (lowercase).
2. **Critical:** `engine/` is part of the deployed output (e.g. under `public/engine/`).
3. **Critical:** Geocoding and distance matrix are either provided via a backend (e.g. Cloud Functions) or the app is explicitly documented as demo/mock-only.

After addressing C1, C2, and C3 (and optionally M1, M2, M4), the app can be deployed to Firebase Hosting with a clear understanding of what works (static pages, template downloads, PDF preview, client-side flow with or without real geocode/distance).

---

*End of audit.*
