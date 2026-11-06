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
- Guided four-step planning: enter course needs, choose sections, build schedules, and prepare for ticket day. The course list and selected sections carry forward in browser storage. Grade and instructor history appear on section cards, and degree-plan work is optional with rule matching in section selection.
- Generate and rank every conflict-free combination for selected courses. The browser prunes conflicts as it enumerates; it shows the total and paginates results without truncating the set. Users can compare up to three schedules.
- Each CRN's meeting blocks are checked together. The engine handles weekday overlap, boundary times, time preferences, and TBA meetings. Sections with unknown meeting times remain visible and are labeled as unchecked.
- Schedule ranking is explainable: 2 times mean historical GPA, plus mean historical A/B percent divided by 25, plus public open flags, minus closed flags and hours outside the preferred time window. Missing grades are not scored. Public flag source and update time are shown; numeric seats are never inferred.
- Import weekly ICS/CSV or paste typed schedule blocks to find schedules that fit. Imported meetings and time preferences stay in browser local storage and are not sent to the server. ICS events without weekly recurrence are skipped and reported.
- Local deployment currently indexes 20,703 sections and 5,007 courses. These counts include the supplied Spring 2027 data and a public Howdy refresh.
- No SSO, Duo, credentials, or registration submission. All imported student data stays in the local browser.
- Keep program and catalog-year details, manually entered or CSV/TSV-imported requirement rules, a separate degree plan and audit, and local backups in browser IndexedDB.
- Import plan and audit data from PDF, text, CSV, or TSV. Review each parsed row and confirm it before saving. PDF text extraction runs in the browser with vendored PDF.js; scanned or image-only PDFs are not supported.
- Map imported audit rows to requirement rules by explicit confirmation. A row counts only when it is marked Met and matches the rule's entered course, section, attribute, and grade conditions. Plan state and audit completion stay separate.
- Mark a plan approved locally, lock it, and retain an approved snapshot when starting a revision. This is a local note and is not verified by Howdy.
- Find public sections for a confirmed rule using its course codes and entered section constraints. Add matching CRNs to local schedule choices; stale CRNs are reported, not silently replaced.
- Plan, audit, requirement, and profile data stay in IndexedDB. The app does not send these records to its server.
- The unpacked Manifest V3 extension imports a local snapshot of public sections, course/instructor grade summaries, and user-authored requirement rules. It does not include the private degree plan, audit, or transcript. The extension reads visible rendered Schedule Builder rows, adds an inline panel with public status, grade context, requirement fit, and conflicts among tracked CRNs, and stores tracked sections and alerts in extension-local storage.
- Alerts appear for an observed visible closed/full-to-open change and for public open/closed flag changes between manual snapshot imports. Use ASB+'s public refresh before exporting when you need newer public flags. The extension makes no network requests and does not reload, modify, or submit the Schedule Builder page.
- The extension parser requires a visible row with an identifiable five-digit CRN and explicit open/closed wording. It was tested on a synthetic page, not on a signed-in Schedule Builder page, so support for the live site's DOM and wording is not verified.
- Preflight lets the user enter a registration-window time and IANA time zone. It shows a local countdown, handles elapsed times, and rejects local times that do not exist during a daylight-saving clock change.
- The user can maintain a local Holds/Action Items checklist with editable completion state. ASB+ does not read Howdy to detect or verify holds.
- A ranked schedule can become the primary ordered CRN list. The user can reorder courses, record why the order matters, and add backup CRNs only from generated schedules that fit the other chosen primary sections. Stale backups stay visible and are marked for manual verification.
- The copy action copies primary CRNs only. If clipboard access fails, ASB+ selects the list for manual copying. Howdy and Schedule Builder links open in separate tabs; the app cannot submit enrollment.
- Countdown, checklist, ordered CRNs, ordering reason, and backup CRNs stay in browser local storage and are not sent to the server.

## Stubbed or not included

- RMP ratings and reviews are disabled. No RMP requests or redistribution occur. Permission and approved use remain unresolved.
- The public section data does not reliably link separate lecture and lab CRNs. ASB+ does not guess the pairings; confirm separate components in Howdy.
- Schedule ranking does not use walking distance because reliable campus paths are not available.
- Built-in catalog program requirements, automatic Howdy UGDP/audit sync, and official audit or eligibility checks. Users must enter or import rules for their program and catalog year.
- OCR for scanned PDFs. Plan and audit PDF text extraction runs locally in the browser, but requires extractable text.
- Holds are not verified, and the user enters ticket times manually. ASB+ does not check holds, determine ticket eligibility, or submit registration.
- Public Howdy data does not provide numeric seat counts. Confirm availability, eligibility, and registration in Howdy.
- The supplied `data/s27.json` and local SQLite database are not committed. Grade imports are local and must be repeated on another installation.

## Run

Requires Rust, Cargo, and the supplied `data/s27.json`. Poppler is optional; it is needed only for command-line Registrar PDF imports. To install the Schedule Builder extension, open `chrome://extensions`, enable developer mode, and choose **Load unpacked** with this repo's `extension/` directory.

```sh
cargo run --release
```

Open <http://127.0.0.1:8000>. The app creates `data/asb.sqlite` and indexes the local section file on first launch. Set `ASB_DB_PATH` to use a different database. Stop the server with Ctrl+C.

Use **Refresh public sections** for a manual Howdy refresh. To import a Registrar PDF, download a report from <https://web-as.tamu.edu/gradereports> and run:

```sh
cargo run --release -- import-grades /path/to/report.pdf
```

The importer also accepts CSV. Use `cargo run --release -- refresh-howdy` to refresh public sections from the command line.

In ASB+, enter course codes and choose **Download local extension snapshot**. Import the JSON in the extension popup. Refresh public sections first when you want updated public flags. Track desired CRNs from visible Schedule Builder rows; the popup lists local alerts and tracked sections.

The live Schedule Builder parser has not been validated on its signed-in page. It reads visible rendered row text only and only recognizes rows with a five-digit CRN and explicit open/closed wording.

## Next steps

1. Resolve permission and approved use before considering RMP.
2. Test this flow with first-time students, especially course selection, degree imports, and the ticket-day checklist.
