# ASB+ implementation status

## What works

- Rust/Axum app with an indexed SQLite database, bound to localhost.
- Search and filter sections by term, subject, course, CRN, instructor, College Station campus, attribute, meeting day/time, historical mean GPA, and A/B share.
- Section results show meetings, instructors, attributes, open status, data source, and whether numeric seats are unavailable. Public open/closed flags are not seat counts.
- Manual public Howdy refresh. It can take up to 90 seconds and is limited to one request every six hours. Failed refreshes preserve existing data.
- Historical grade distributions by course, instructor, section, and term. The app can query anex.us with a 24-hour cache and import TAMU Registrar Grade Distribution PDFs or CSV files. PDF import requires Poppler's `pdftotext`.
- Registrar records take precedence over matching anex records for the same course, term, and section.
- Search current-term professors, view historical grade outcomes, correct ambiguous grade-name matches in browser local storage, and compare up to three courses or professors.
- Professor grade names match automatically only when surname and first initial identify one current professor and one grade name. Users can search and confirm another match.
- Generate and rank every conflict-free combination for selected courses. The browser prunes conflicts as it enumerates; it shows the total and paginates results without truncating the set. Users can compare up to three schedules.
- Each CRN's meeting blocks are checked together. The engine handles weekday overlap, boundary times, time preferences, and TBA meetings. Sections with unknown meeting times remain visible and are labeled as unchecked.
- Schedule ranking is explainable: 2 times mean historical GPA, plus mean historical A/B percent divided by 25, plus public open flags, minus closed flags and hours outside the preferred time window. Missing grades are not scored. Public flag source and update time are shown; numeric seats are never inferred.
- Import weekly ICS/CSV or paste typed schedule blocks to find schedules that fit. Imported meetings and time preferences stay in browser local storage and are not sent to the server. ICS events without weekly recurrence are skipped and reported.
- Local deployment currently indexes 20,703 sections and 5,007 courses. These counts include the supplied Spring 2027 data and a public Howdy refresh.
- No SSO, Duo, credentials, private schedule imports, or registration submission.

## Stubbed or not included

- RMP ratings and reviews are disabled. No RMP requests or redistribution occur. Permission and approved use remain unresolved.
- The public section data does not reliably link separate lecture and lab CRNs. ASB+ does not guess the pairings; confirm separate components in Howdy.
- Schedule ranking does not use walking distance because reliable campus paths are not available.
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

1. Add browser-local degree-plan and audit imports with requirement-aware course picking.
2. Add the minimal-permission Schedule Builder extension and visible-page seat alerts.
3. Add local Holds/Action Items, time-ticket countdown, CRN order, and backups.
4. Resolve permission and approved use before considering RMP.
