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
- A section's meeting blocks are checked together. The public data does not reliably link separate lecture and lab CRNs, so the app does not guess those pairs. Confirm them in Howdy.
- RMP is disabled. Ratings and reviews are not requested or shown. Walking distance is not scored without reliable campus route data.
- No SSO, Duo, credentials, enrollment submission, or private student data leaves the browser.

Degree planning, the browser extension, seat alerts, and registration preflight remain planned phases. See `docs/SUMMARY.md`.
