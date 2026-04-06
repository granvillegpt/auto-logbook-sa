# Legal Content Audit

**Scope:** Application source only (project root, `public/`, `engine/`). Third-party licenses in `node_modules/` and other subprojects are excluded.

---

## Terms of Service

**File path:** `terms.html`

**Full text:**

```
Terms of Service (h1)

This application provides a tool to assist users in generating vehicle travel logbooks based on information provided by the user. Users remain responsible for verifying the accuracy of the information entered and reviewing the generated logbook before submission to the South African Revenue Service (SARS). The application does not guarantee acceptance of any logbook by SARS.

Home · Contact (links)
```

---

## Disclaimer

**File path:** `public/index.html` (modal `#disclaimerModal`)

**Full text:**

```
Important Disclaimer (h2)

Auto Logbook SA assists with generating travel logbooks based on information provided by the user. Users remain responsible for verifying accuracy and ensuring compliance with SARS requirements.

[I Understand] (button)
```

---

## Privacy Policy

**File path (standalone page):** `privacy.html`

**Full text:**

```
Privacy Policy (h1)

This application only uses the information you provide to generate travel logbooks. No personal data is sold or shared with third parties. Uploaded data is processed only for the purpose of generating the logbook. The app runs locally in your browser; you can use it without creating an account.

Home · Contact (links)
```

**File path (modal):** `public/index.html` (modal `#privacyModal`)

**Full text:**

```
Privacy Policy (h2)

Uploaded route lists are processed locally in your browser. No data is sent to any server or stored by us. Auto Logbook SA does not collect personal information.

[Close] (button)
```

---

## Footer Legal Copy

**File path:** `public/index.html`

**Full text:**

```
© Auto Logbook SA

Privacy · Terms · Disclaimer  (footer links; open modals)

Powered by ClearTrack Logbook Engine
```

---

## App UI Legal Messages

**File path:** `public/index.html` (Terms modal `#termsModal`)

**Full text:**

```
Terms of Use (h2)

By using Auto Logbook SA you agree to use the tool for personal or professional logbook generation only. You are responsible for the accuracy of data you enter and for compliance with SARS and local tax rules. This tool is provided as-is without warranty.

[Close] (button)
```

**File path:** `public/index.html` (landing hero and problem section)

**Full text (user-facing):**

- Hero note: `✓ SARS-compliant logbook format`
- Problem list: `Errors can invalidate your tax claim`
- Preview note: `✓ SARS-compliant travel logbook format`

**File path:** `public/logbook.html`

**Full text (user-facing):**

- Subtitle: `Create a SARS-compliant travel logbook using your verified routelist.`
- Intro: `Complete the details below to generate your formatted logbook file.`
- Tax Number placeholder: `SARS Tax Number (optional)`
- Tax Year label: `Tax Year` (Required), help: `Tax year runs from 1 March to 28 February.`
- Odometer help: `Mileage values are provided manually. Please ensure odometer readings are accurate.`

**File path:** `contact.html`

**Full text (user-facing):**

- Meta description: `Contact Auto Logbook SA for assistance with your travel logbook or tax questions.`
- Email instruction: `Please include your full name and a brief description of the issue. Do not include SARS eFiling or banking passwords in any message.`
- Form note: `This form is for convenience only. It does not submit to SARS and does not collect any third-party login details.`

---

## Mentions of SARS or Compliance

**File path:** `terms.html` (line 19)

- “reviewing the generated logbook before submission to the South African Revenue Service (SARS)”
- “The application does not guarantee acceptance of any logbook by SARS.”

**File path:** `public/index.html`

- Hero: `✓ SARS-compliant logbook format`
- Problem list: `Errors can invalidate your tax claim`
- Preview: `✓ SARS-compliant travel logbook format`
- Disclaimer modal: “ensuring compliance with SARS requirements”
- Terms modal: “compliance with SARS and local tax rules”

**File path:** `public/logbook.html`

- Subtitle: `Create a SARS-compliant travel logbook using your verified routelist.`
- Placeholder: `SARS Tax Number (optional)`
- Label: `Tax Year`; help: `Tax year runs from 1 March to 28 February.`

**File path:** `contact.html`

- Meta: “tax questions”
- “Do not include SARS eFiling or banking passwords in any message.”
- “It does not submit to SARS and does not collect any third-party login details.”

**File path:** `engine/logbookEngine.js` (line 236, comment)

- `* Generates SARS-compliant logbook entries from visits and distances`

**File path:** `engine/routing/distanceMatrixRouting.js` (line 68, comment)

- `/** Apply road-distance multiplier and round to 2 decimals (SARS-compliant fallback). */`

**File path:** `engine/dateRange.js` (comments and code)

- JSDoc: “Convert tax year string (e.g. "2024/2025") to date range.”, “@param {string} taxYear - Format "YYYY/YYYY"”
- Function: `taxYearToDateRange(taxYear)`
- Error messages: “Invalid tax year format”, “Invalid tax year: years must be numeric.”, “Invalid tax year: second year must be first year + 1.”

**File path:** `public/js/logbook-page.js`

- Variable/labels: `taxYearStr`, “Tax Year:”, form field `#taxYear` (no standalone legal statement; used for export and form behaviour).

**File path:** `LOGBOOK_ENGINE_AUDIT.md` (documentation)

- “SARS-compliant structure”, “SARS-oriented fields”, “Tax-year string”, “tax year”.

**File path:** `LOGBOOK_LAYOUT_AUDIT.md` (documentation)

- “Tax Year”, “Period”, “tax year”.

---

## Summary

| Category            | Location(s)                                      |
|---------------------|--------------------------------------------------|
| Terms of Service    | `terms.html`; Terms modal in `public/index.html` |
| Disclaimer          | Disclaimer modal in `public/index.html`        |
| Privacy Policy      | `privacy.html`; Privacy modal in `public/index.html` |
| Footer legal        | `public/index.html` footer                       |
| App UI legal        | `public/index.html`, `public/logbook.html`, `contact.html` |
| SARS/compliance     | Above files + `engine/logbookEngine.js`, `engine/routing/distanceMatrixRouting.js`, `engine/dateRange.js`, `public/js/logbook-page.js`, audit markdown files |

No separate legal notices or liability statements were found outside the content listed above. Third-party license text in `node_modules/` was not included in this audit.
