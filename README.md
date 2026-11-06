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
- On signed-in Spring 2027 College Station options, Add Courses, and course-detail routes, the extension opens an in-page workspace with Find sections, Plan & rank, Saved, and Review CRNs. The native Schedule Builder navigation remains visible.
- Search courses, titles, instructors, five-digit CRNs, and section attributes. Filter by public open flag. Cards show meetings, historical course and instructor grade context, requirement fits, conflicts, source/freshness, and visible page status. Numeric seats appear only if read directly from a visible `Seats Open` cell.
- Schedule combinations are ranked locally in the browser using historical GPA and A/B data. Review CRNs shows selected section details and conflicts, copies exact CRNs, and opens native Add Courses. Kyler chooses By CRN, pastes the list, selects sections, uses Schedule Builder's cart, and clicks Register himself. The native route stays visible until he explicitly reopens ASB+.
- The workspace validates Spring 2027 term `202711` and the backend's exact term-plus-CRN lookup. Unsupported page shapes, term/backend mismatch, and data/search/ranking errors fail open to the original Schedule Builder. **Use original Schedule Builder** is a persistent local kill switch.
- Importing a planner snapshot is optional and adds only requirement rules. Private plan, audit, transcript, and preferences stay in browser storage and are not sent to the server. The extension never handles sign-in, cookies, cart APIs, or registration submission.
