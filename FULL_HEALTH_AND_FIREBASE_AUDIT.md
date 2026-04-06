# Full Health Check + Firebase Readiness Audit — Standalone Auto Logbook SA

**Audit date:** 2026-03-11  
**Scope:** Standalone app only. No ClearTrack architecture. No refactors. Audit only.

---

## 1. PASS / FAIL SUMMARY TABLE

| Section | Area | Result |
|--------|------|--------|
| **1** | UI / Content health | **PASS** (with minor notes) |
| **2** | Functional health | **PASS** (with notes) |
| **3** | Console / JS health | **PASS** (with risks) |
| **4** | Firebase Hosting readiness | **FAIL** (no firebase.json) |
| **5** | File / Asset safety | **PASS** (with caveats) |
| **6** | Pre-launch risk | **FAIL** (see critical/medium) |

---

## 2. CRITICAL ISSUES

### 2.1 No Firebase deployment configuration
- **Finding:** No `firebase.json` or `.firebaserc` found at project root.
- **Impact:** Cannot run `firebase deploy` without adding Hosting (and optionally Functions) config. Deployment is not “ready” until these exist.
- **Recommendation:** Add `firebase.json` with `"public": "public"` (or correct root) and any rewrites; add `.firebaserc` if using multiple projects.

### 2.2 Logbook page legal modals: no ESC, no focus restore, narrow layout
- **Finding:** On `logbook.html`, legal modals (Disclaimer, Terms, Privacy) are opened/closed by inline script only. `app.js` is not loaded on logbook page.
- **Impact:** ESC does not close modals on logbook page. Focus is not returned to the footer link when closing. Modals use `modal-box` only (no `modal-content`), so they do not get the wider, readable legal layout used on index.
- **Recommendation:** Either load app.js on logbook and reuse modal logic, or add ESC + focus restore + `.modal-content` to logbook’s legal modals for consistency and accessibility.

### 2.3 Backend /api/* required for full logbook flow
- **Finding:** Geocoding and Distance Matrix use `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`, `/api/distancematrix`. No localhost in code, but these must be implemented (e.g. Cloud Functions) for address resolution and routing.
- **Impact:** Without these endpoints, logbook generation will fail for real address resolution and distance calculation (unless mock/dev mode is used).
- **Recommendation:** Document that Firebase deploy must include Cloud Functions (or equivalent) for `/api/*` and set API keys server-side.

---

## 3. MEDIUM ISSUES

### 3.1 Refund modal: × button close does not restore focus
- **Finding:** On index, closing Refund modal via the × button uses an inline handler that does not call `window._lastModalOpener.focus()`. The “Close” button and overlay click use app.js `closeModal()` and do restore focus.
- **Impact:** When the user closes via × only, focus can stay on the close button (now hidden), which can trigger Chrome’s aria-hidden/focus warning and is poor accessibility.
- **Recommendation:** Have Refund modal × button close go through the same close path that restores focus (e.g. call `closeModal('refundPolicyModal')` or a shared helper that restores `_lastModalOpener`).

### 3.2 Template download uses absolute paths
- **Finding:** `downloadTemplateWithGuide()` uses `templatePath = '/templates/' + templateFile` and `guidePath = '/templates/route_template_guide.pdf'` (leading slash).
- **Impact:** Correct for Firebase Hosting (root = public). For local `file://` or some dev servers, absolute paths can fail. Comment in app.js says “file:// (relative paths only)”.
- **Recommendation:** For maximum compatibility, consider relative paths (e.g. `templates/` without leading slash) when served from site root, or document that production uses root-relative paths.

### 3.3 Logbook page footer: no Refund Policy link
- **Finding:** index.html footer has Privacy, Terms, Refund Policy, Disclaimer, Contact. logbook.html footer has Privacy, Terms, Disclaimer, Contact only (no Refund Policy).
- **Impact:** Users on the logbook page cannot open the Refund Policy modal from the footer. May be intentional (refund is purchase-related) but is inconsistent with index.
- **Recommendation:** Decide whether Refund Policy should be available on logbook page; if yes, add the link and modal (or link to index#refund).

### 3.4 Debug logging left on in production bundle
- **Finding:** `public/js/logbook-page.js` has `var DEBUG_ROUTELIST = true;` and multiple `console.log`/`console.warn` calls (e.g. `[ROUTES]`, `[DEBUG_ROUTELIST]`, `[PARSER_USED]`).
- **Impact:** Console noise in production; minor performance cost. Not broken behavior.
- **Recommendation:** Set `DEBUG_ROUTELIST = false` for production or guard logs with the flag.

---

## 4. LOW-PRIORITY CLEANUP

### 4.1 Excel lock file in templates
- **Finding:** `public/templates/~$business_travel_template.xlsx` exists (Excel lock file).
- **Impact:** Can be deployed and cause confusion or be ignored by some servers. No runtime impact on template downloads.
- **Recommendation:** Add to `.gitignore` and remove from repo; exclude from deploy if needed.

### 4.2 Header modal triggers on index
- **Finding:** app.js `initModals()` wires `openDisclaimer`, `openTerms`, `openPrivacy` by id. index.html has no elements with these ids (only footer links with `open*Footer` ids).
- **Impact:** None; those buttons are simply not present. No duplicate listeners.
- **Recommendation:** Optional: remove dead code in app.js or add header links if design requires them.

### 4.3 Comment / file protocol
- **Finding:** app.js comment: “Works with file:// (relative paths only)”. Template download uses `/templates/` (absolute).
- **Recommendation:** Update comment or make template paths relative for file:// consistency.

### 4.4 Inconsistent favicon references
- **Finding:** index.html uses `href="assets/logos/favicon.ico"`. Admin uses `href="../assets/logos/favicon.ico"`. favicon.ico exists.
- **Impact:** None; both resolve correctly.
- **Recommendation:** None required.

---

## 5. HARMLESS WARNINGS

- **local-config.js:** `window.GOOGLE_GEOCODE_API_KEY = ""` — Intentional; key is added server-side. No console error.
- **reviewService.js:** Firebase placeholders (`firebaseGetApproved`, `firebaseSubmitReview`, etc.) return empty or no-op when `STORAGE_MODE === 'firebase'` — Expected until Firebase backend is implemented.
- **storageAdapter.js:** `STORAGE_MODE = 'local'` — Expected for current standalone/local storage setup.
- **SheetJS CDN:** External script from cdn.sheetjs.com — Normal; no impact if CDN is available.
- **CSS comment “file:// compatible”:** Informational only; no runtime impact.

---

## 6. FIREBASE DEPLOYMENT VERDICT

**DEPLOYMENT RISK REMAINS**

**Reasons:**
1. No `firebase.json` / `.firebaserc` — deploy not configured.
2. Logbook page legal modals lack ESC, focus restore, and wide layout — UX/accessibility gap on a key page.
3. `/api/*` must be implemented (e.g. Cloud Functions) for full logbook functionality — must be documented and deployed together.

**Once addressed:** Add Firebase config; fix or document logbook modal behavior; deploy or document API backend. Then re-audit for “SAFE TO DEPLOY”.

---

## 7. LAUNCH READINESS VERDICT

**READY FOR STAGING**

**Rationale:**
- All critical user-facing content and flows are present and wired (templates, example modal, legal modals on index, review modal, review admin, logbook steps, generate button, loading state).
- No broken copy, dead links, or missing sections identified in the audited areas.
- Asset and template files exist under `public/` (templates, payment images, logos, example PDF). Payment strip and trust copy are present.
- Review submission, success state, and moderation (pending/approved/rejected, counters, dates, Approve/Reject/Delete) are implemented.
- Logbook page: upload, validation, disabled generate button, loading/car animation, and form are in place.

**Not “READY FOR LIVE”** until:
- Firebase config is in place and tested.
- Logbook page modal behavior (and optionally Refund focus restore on index) is improved or accepted as-is and documented.
- API backend (Cloud Functions or equivalent) for geocode/distance matrix is deployed and documented, or product is clearly “demo/local only” without real routing.

---

## SECTION 1 — UI / CONTENT HEALTH CHECK (DETAIL)

| Area | Status | Notes |
|------|--------|--------|
| Hero | OK | Headline, subline, buttons, hero note present. |
| How It Works | OK | Three steps; CTA to Generate Logbook. |
| Templates & Example | OK | Two template cards (Sales Rep, Basic Travel); template guide note; View Example Logbook button. |
| Example Logbook modal | OK | Title, subtext, iframe to `templates/example-logbook.pdf`. |
| Pricing | OK | R500 once-off, benefits, CTA, trust line. |
| Payment strip | OK | “Secure checkout via”, PayFast + payment method logos. |
| Review section | OK | “What Users Say”, grid, “Leave a Review” CTA. |
| Footer | OK | ©, Privacy, Terms, Refund Policy, Disclaimer, Contact, engine line, legal line. |
| Legal modals (index) | OK | Privacy, Terms, Refund, Disclaimer; all have content and Close (or I Understand). |
| Review modal | OK | Name, Company, Rating, Comment placeholder (“How did Auto Logbook SA help you…”), submit, review note, success block. |
| Admin review page | OK | Pending/Approved/Rejected sections, counters, dates, Approve/Reject/Delete. |

No broken copy, repeated blocks, or placeholder content left in audited sections. No missing labels or inconsistent naming. Buttons and links wired. Logbook page legal modals are narrower and lack ESC/focus restore (see Critical/Medium).

---

## SECTION 2 — FUNCTIONAL HEALTH CHECK (DETAIL)

| Workflow | Status | Notes |
|----------|--------|--------|
| Template downloads | OK | `downloadTemplateWithGuide('sales_rep_route_template.xlsx' | 'business_travel_template.xlsx')`; guide PDF bundled; files exist under `public/templates/`. |
| Example Logbook modal | OK | Opens (openExampleLogbookBtn); closes via × and overlay; ESC closes (app.js); preview path `templates/example-logbook.pdf` correct. |
| Legal modals (index) | OK | Open from footer; close via .modal-close and overlay; ESC closes; focus restore on .modal-close and overlay; Refund × button does not restore focus. |
| Review modal | OK | Open/close; submit; thank-you state; public review note; improved placeholder. |
| Review admin | OK | Pending/Approved/Rejected; counters; dates; Approve/Reject/Delete; data from reviewService. |
| Logbook generator | OK | Upload section; validation; disabled generate button; loading/car animation; no missing UI states identified. |

---

## SECTION 3 — CONSOLE / JS HEALTH CHECK (DETAIL)

- **Undefined functions:** None found. `downloadTemplateWithGuide` is defined inline on index; app.js and reviews.js and reviewService are consistent.
- **Duplicate event listeners:** Refund modal has both inline close (× and overlay) and app.js for .modal-close and overlay (overlay is on the same modal, so overlay close runs twice — once inline, once app.js for the four in the list; Refund is in the list, so overlay click runs app.js closeModal and inline — duplicate close, both run; no crash). Example and Review modals are not in app.js list; their close is inline or reviews.js only. No harmful duplication.
- **Modal event conflicts:** No conflicts identified; ESC and overlay/close buttons behave as intended on index.
- **Broken selectors:** All audited getElementById and querySelector targets exist in the corresponding HTML.
- **Missing asset references:** All referenced assets (logos, hero, payment images, templates, example PDF) exist under public/.
- **onclick handlers:** `downloadTemplateWithGuide` is defined before use. No missing handlers found.
- **Likely console errors:** None from missing scripts or selectors. `/api/*` will 404 until backend exists (expected).
- **Real risks:** DEBUG_ROUTELIST true + console.log (medium); Refund ×/overlay focus (medium); logbook page modals (critical for consistency).

---

## SECTION 4 — FIREBASE HOSTING READINESS (DETAIL)

| Check | Status | Notes |
|-------|--------|--------|
| Frontend under public/ | OK | HTML, JS, CSS, engine, templates, assets, admin, samples under public/. |
| Template links lowercase | OK | References use `templates/` (and JS uses `/templates/`). |
| Engine under public/engine/ | OK | All referenced engine scripts present. |
| Asset paths Firebase-safe | OK | Relative or root-relative; no file:// in runtime. |
| No localhost-only | OK | No localhost in code. |
| No file:// in runtime | OK | Only in comments. |
| firebase.json | FAIL | Not present. |
| Rewrites | N/A | Not configured. |
| Cloud Function/API | Doc | `/api/geocode`, `/api/findPlace`, `/api/textSearch`, `/api/placeDetails`, `/api/distancematrix` must be implemented and documented. |

---

## SECTION 5 — FILE / ASSET SAFETY CHECK (DETAIL)

| Item | Status | Notes |
|------|--------|--------|
| Spaces in filenames | Caution | “Payfast logo.png”, “Master Card.png”, “Capitec Pay - colour.png”, “auto_logbook_logo-white (1).png” — all exist; URLs work in browser; ensure deployment/server allows spaces or use encoded paths. |
| Case mismatch | OK | References match files (e.g. example-logbook.pdf, sales_rep_route_template.xlsx). |
| route_template_guide.pdf | OK | In public/templates/. |
| example-logbook.pdf | OK | In public/templates/. |
| Payment assets | OK | .png and .svg variants present; index uses .png. |
| Logo assets | OK | logo.png, favicon.ico, auto_logbook_favicon-white.png, auto_logbook_logo-white (1).png. |
| Lock file | Low | ~$business_travel_template.xlsx in templates; optional cleanup. |

---

## SECTION 6 — PRE-LAUNCH RISK CHECK (SUMMARY)

| Risk | Level | Mitigation |
|------|--------|------------|
| Payment trust | Low | Copy and logos present; no broken trust strip. |
| User confusion | Low | Logbook legal modals different from index (narrow, no ESC); document or fix. |
| Broken downloads | Low | Template and guide files exist; path is absolute `/templates/` — verify on deploy. |
| Broken example modal | Low | Path and behavior verified. |
| Broken review moderation | Low | Admin and service wired; Firebase mode not yet used. |
| Broken legal modals | Medium | Index OK; logbook missing ESC, focus restore, wide layout. |
| Broken generator | Medium | Depends on /api/*; without backend, address/routing will fail unless mock used. |
| Deployment failure | High | No firebase.json; add config before deploy. |

---

**End of audit.**
