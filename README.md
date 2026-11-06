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
- Install the unpacked Manifest V3 extension from `extension/` in Chrome or Chromium at `chrome://extensions`. In ASB+, enter course codes, download the local extension snapshot, then import it in the extension popup. The extension makes no network requests and stores imported data, tracked CRNs, and alerts in extension-local storage.
- Use **Refresh public sections** in ASB+ before exporting to include refreshed public open/closed flags. The extension can alert on public flag changes between imports and on visible closed/full-to-open changes in Schedule Builder. It never polls or reloads the authenticated page.
- The extension reads only visible rendered row text and requires an identifiable five-digit CRN plus explicit open/closed wording. The parser has only been smoke-tested against a synthetic page, not a signed-in Schedule Builder page. It may not recognize other layouts or status wording.
- Holds/Action Items, time-ticket countdown, CRN ordering, and backups remain planned. See `docs/SUMMARY.md`.
