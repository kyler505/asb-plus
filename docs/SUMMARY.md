# ASB+ implementation status

## What works

- Rust/Axum app with an indexed SQLite database, bound to localhost.
- Search and filter sections by term, subject, course, CRN, instructor, College Station campus, attribute, meeting day/time, historical mean GPA, and A/B share.
- Course and section results show meetings, instructors, attributes, open status, data source, and whether seats are unavailable. Public open/closed flags are not seat counts.
- Manual public Howdy refresh. It can take up to 90 seconds and is limited to one request every six hours. Failed refreshes preserve existing data.
- Historical grade distributions by course, instructor, section, and term. The app can query anex.us with a 24-hour cache and import TAMU Registrar Grade Distribution PDFs or CSV files. PDF import requires Poppler's `pdftotext`.
- Registrar records take precedence over matching anex records for the same course, term, and section.
- Mean GPA and A/B share filters. Lower mean GPA is only a difficulty proxy. A/B share is computed from A-F counts; Q is excluded.
- Local deployment currently indexes 20,703 sections and 5,007 courses. These counts include the supplied Spring 2027 data and a public Howdy refresh.
- No SSO, Duo, credentials, private student imports, or registration submission.

## Stubbed or not included

- Professor profiles and comparisons, including RMP. No RMP requests are made; permission and terms remain an open decision.
- Schedule generation, schedule comparisons, and local schedule-fit imports.
- UGDP and degree-audit imports, catalog requirement matching, and requirement-aware course picking.
- Browser extension, visible-page seat alerts, Holds/Action Items, time-ticket countdown, CRN ordering, and backups.
- Public Howdy data does not provide numeric seat counts. Confirm availability, eligibility, and registration in Howdy.
- The supplied `data/s27.json` and local SQLite database are not committed. Grade imports are local and must be repeated on another installation.

## Run

Requires Rust, Cargo, the supplied `data/s27.json`, and Poppler only for PDF imports:

```sh
cargo run --release
```

Open <http://127.0.0.1:8000>. The app creates `data/asb.sqlite` and indexes the local section file on first launch. Set `ASB_DB_PATH` to use a different database. Stop the server with Ctrl+C.

Use **Refresh public sections** for a manual Howdy refresh. To import a Registrar PDF, download a report from <https://web-as.tamu.edu/gradereports> and run:

```sh
cargo run --release -- import-grades /path/to/report.pdf
```

The importer also accepts CSV. Use `cargo run --release -- refresh-howdy` to refresh public sections from the command line.

## Next steps

1. Add professor insights and course/professor comparisons. Keep RMP disabled until permission and use are resolved.
2. Build complete conflict-free schedules and browser-local schedule fit.
3. Add browser-local degree planning, requirement matching, and the Schedule Builder extension.
4. Add local registration preflight and ticket-day tools.
