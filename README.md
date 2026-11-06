# ASB+

Local-first course search and grade history for Texas A&M. The server is Rust, Axum, and SQLite. The app binds to `127.0.0.1` and does not handle login or registration.

## Run

Requires Rust, Cargo, and the supplied `data/s27.json` Spring 2027 section file. The section file and local database are not committed.

```sh
cargo run --release
```

Open <http://127.0.0.1:8000>. On first launch, the app indexes `data/s27.json` into `data/asb.sqlite`. Set `ASB_DB_PATH` to use another database path. Stop the server with Ctrl+C.

## Refresh sections

Use the button in the app or run:

```sh
cargo run --release -- refresh-howdy
```

This makes one public Howdy request. Refreshes are limited to one per six hours. The API may take up to 90 seconds. Public `Y/N` open status is not a numeric seat count.

## Import grades

Select a term and college in the [TAMU Registrar grade reports](https://web-as.tamu.edu/gradereports), download its Grade Distribution PDF, then run:

```sh
cargo run --release -- import-grades /path/to/report.pdf
```

PDF import requires Poppler's `pdftotext` command. The command also accepts a CSV with subject and course columns and optional section, instructor, term, GPA, and A-F/Q counts. In the app, the grade button can fetch one course from anex.us; successful results are cached for 24 hours.

## Current scope

- Search sections by course, CRN, instructor, term, campus, attributes, day, and time.
- Filter by historical mean GPA and A/B share. Lower mean GPA is only a difficulty proxy. A/B share uses A-F counts and excludes Q.
- Review public open status and historical grade rows with source and term details.
- Search current-term professors, inspect historical grade outcomes, correct ambiguous instructor-name matches locally, and compare courses or professors.
- Generate every conflict-free combination for the chosen courses, compare alternatives, and rank by historical GPA, A/B share, public open flags, and time preferences. Score components, sources, and freshness are shown. Missing grade data is not scored.
- Import weekly ICS or CSV classes, or paste typed blocks, to fit schedules. Imported meetings and time preferences stay in browser local storage and are not sent to the server.
- Keep a degree plan, separate audit snapshots, user-entered or imported requirement rules, and program/catalog details in browser IndexedDB. Review each PDF/text/CSV/TSV row before saving; PDF text extraction runs locally, with no OCR.
- Pick sections for a user-confirmed requirement rule. Course codes and entered section constraints filter public sections; adding a matching CRN limits schedule generation to that choice. Private plan and audit content stays in the browser.
- No official program rules are preloaded or synced from Howdy. Requirement matching is guidance, not an official degree audit. Review catalog year and sources with an advisor.
- A section's meeting blocks are checked together. The public data does not reliably link separate lecture and lab CRNs, so the app does not guess those pairs. Confirm them in Howdy.
- RMP is disabled. Ratings and reviews are not requested or shown. Walking distance is not scored without reliable campus route data.
- No SSO, Duo, credentials, enrollment submission, or private student data leaves the browser.
- Install the unpacked Manifest V3 extension from `extension/` in Chrome or Chromium at `chrome://extensions`. Its background service worker reads public section and grade data from the local ASB+ backend at `http://localhost:8000` through the SSH tunnel and stores cached sections, tracked CRNs, and alerts in extension-local storage. It makes no third-party requests.
- The popup searches live sections by course, instructor, title, or CRN. Saving a section caches it locally and the Saved view checks meeting-time conflicts. Use **Backend and planning data > Refresh from ASB+** after refreshing public sections in ASB+. Public flag changes for saved CRNs raise alerts, as do visible closed/full-to-open changes on the open Schedule Builder page. The extension never polls or reloads the authenticated page.
- Importing a planner snapshot is optional and now adds only requirement rules. It does not replace live section data.
- The overlay reads only visible rendered text and requires an identifiable five-digit CRN. It matches by the Schedule Builder term and the course code in the row, not by CRN alone, because CRNs are reused across terms. If the page term differs from the ASB+ term, it reports both terms and does not show section details or allow saving. It displays visible open/closed wording when recognized. Use **Check Schedule Builder page** in the popup to report detected CRNs, terms, statuses, and element classes on the active tab.
- Configure a browser-local time-ticket countdown with an IANA time zone, maintain a Holds/Action Items checklist, and create an ordered CRN list from a ranked schedule. Reorder CRNs with a visible reason, select compatible backup CRNs from other generated schedules, and copy the primary CRNs with a manual recovery path.
- These preflight details stay in browser local storage. Holds and ticket times are entered by the user and are not checked against Howdy. Howdy and Schedule Builder links open those sites separately; ASB+ never submits registration.
