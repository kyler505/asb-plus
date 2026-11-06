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
- The standalone planner has a four-step flow for course needs, sections, schedule generation, and ticket-day preparation. Course and section selections carry forward in browser storage. Grade and instructor history appear beside section results; degree work is optional.
- Generate and rank every conflict-free combination for selected courses. The browser prunes conflicts as it enumerates; it shows the total and paginates results without truncating the set. Users can compare up to three schedules.
- Each CRN's meeting blocks are checked together. The engine handles weekday overlap, boundary times, time preferences, and TBA meetings. Sections with unknown meeting times remain visible and are labeled as unchecked.
- Schedule ranking is explainable: 2 times mean historical GPA, plus mean historical A/B percent divided by 25, plus public open flags, minus closed flags and hours outside the preferred time window. Missing grades are not scored. Public flag source and update time are shown; numeric seats are never inferred.
- Import weekly ICS/CSV or paste typed schedule blocks to find schedules that fit. Imported meetings and time preferences stay in browser local storage and are not sent to the server. ICS events without weekly recurrence are skipped and reported.
- Local deployment currently indexes 20,703 sections and 5,007 courses. These counts include the supplied Spring 2027 data and a public Howdy refresh.
- No SSO, Duo, credentials, or registration submission. All imported student data stays in the local browser.
- Keep program and catalog-year details, manually entered or CSV/TSV-imported requirement rules, a separate degree plan and audit, and local backups in browser IndexedDB.
- Import plan and audit data from PDF, text, CSV, or TSV. Review each parsed row and confirm it before saving locally. PDF text extraction runs in the browser with vendored PDF.js; scanned or image-only PDFs are not supported.
- Map imported audit rows to requirement rules by explicit confirmation. A row counts only when it is marked Met and matches the rule's entered course, section, attribute, and grade conditions. Plan state and audit completion stay separate.
- Mark a plan approved locally, lock it, and retain an approved snapshot when starting a revision. This is a local note and is not verified by Howdy.
- Find public sections for a confirmed rule using its course codes and entered section constraints. Add matching CRNs to local schedule choices; stale CRNs are reported, not silently replaced.
- Plan, audit, requirement, and profile data stay in IndexedDB. The app does not send these records to its server.
- The unpacked Manifest V3 extension reads public sections, historical course and instructor grades, and instructor data live from the local ASB+ backend at `http://localhost:8000` through the SSH tunnel. A background service worker owns those requests; its host permission is limited to Schedule Builder and loopback. It makes no third-party requests.
- The extension popup connects automatically and shows the backend term and counts. **Find sections** searches live sections by course, instructor, title, or CRN. It shows meeting times, source and freshness, public flags, historical grade context, instructor grade matches, user-clicked RMP search links, requirement fits, and conflicts with saved sections.
- Save sections from the popup or a visible Schedule Builder row. Saved section data is cached in extension-local storage. The Saved view compares meeting-time conflicts and preserves section alerts.
- The in-page overlay adds meeting times, grade and requirement context, instructor grade summaries, a direct RMP search link, a visible status observation, conflict context, and a save action to rows with a visible five-digit CRN. It resolves those CRNs through the backend service worker and falls back to any imported planner data.
- Alerts appear for an observed visible closed/full-to-open change and for public open/closed flag changes on saved CRNs, tracked separately from the cache. The extension does not reload, modify, or submit the Schedule Builder page.
- Importing a planner snapshot is optional and now adds only requirement rules. It does not replace live section data.
- The extension parser requires a visible row with an identifiable five-digit CRN. It recognizes explicit open/closed, full, and available wording. It does not recognize status text it cannot parse, so the overlay can still show section details without a visible status. **Backend and planning data > Check Schedule Builder page** reports detected CRNs, parsed statuses, element classes, and whether a CRN label appears in page text.
- Preflight lets the user enter a registration-window time and IANA time zone. It shows a local countdown, handles elapsed times, and rejects local times that do not exist during a daylight-saving clock change.
- The user can maintain a local Holds/Action Items checklist with editable completion state. ASB+ does not read Howdy to detect or verify holds.
- A ranked schedule can become the primary ordered CRN list. The user can reorder courses, record why the order matters, and add backup CRNs only from generated schedules that fit the other chosen primary sections. Stale backups stay visible and are marked for manual verification.
- The copy action copies primary CRNs only. If clipboard access fails, ASB+ selects the list for manual copying. Howdy and Schedule Builder links open in separate tabs; the app cannot submit enrollment.
- Countdown, checklist, ordered CRNs, ordering reason, and backup CRNs stay in browser local storage and are not sent to the server.

## Verified live integration (Nov 6, 2026)

- Loaded `extension/` unpacked in Chrome for Testing 150 against the ASB+ backend on hp through the `localhost:8000` SSH tunnel.
- The popup connected and showed Spring 2027, 20,703 sections, and 5,007 courses.
- Searched `CSCE 482`: 10 live sections with meeting blocks, `howdy-public` source, mean GPA 3.81, 96.9% A/B, 111 grade records, and anex/registrar-pdf sources.
- Verified on the real signed-in Aggie Schedule Builder in Kyler's own Chrome session. No credentials, SSO, Duo, or cookies were handled.
- The Fall 2026 page was detected as a term mismatch with the Spring 2027 backend. The overlay showed the page term, the backend term, and refused section details. This prevented CRN 53942 from displaying the different Spring 2027 CHEM 258 course.
- On the Spring 2027 CSCE 482 course page, the overlay attached to the live section table. Five visible rows showed live meetings, public flags, mean GPA 3.81, 96.9% A/B, 111 grade records, anex/registrar-pdf sources, instructors, RMP search links, and Save buttons.
- Saved CRNs 37075 and 37077 from the live overlay. Both panels showed the exact meeting-time conflict, and the popup Saved view reported the same conflict. Remove and Save toggles updated the live overlay.
- The overlay scanned on DOM changes, scrolling, and visibility changes. A timer debounce replaced `requestAnimationFrame`, because Chrome throttles rAF in an occluded window and the overlay would otherwise never attach.
- The extension action was pinned in the toolbar (`isOnToolbar: true`), with one Chrome window and one Schedule Builder tab.

## Stubbed or not included

- RMP ratings and reviews are not embedded. The extension only opens an RMP search when the student clicks an instructor link. Automated access and redistribution remain disabled until permission and approved use are resolved.
- The signed-in Schedule Builder table layout is verified for the term and course pages observed on Nov 6. Other terms or a redesigned page may differ; use **Check Schedule Builder page** to diagnose detected CRNs, statuses, and element classes.
- The live section table shows seat counts in a column rather than the words Open/Closed, so those cells are not parsed as a status. The overlay shows the public Howdy flag and labels the visible status as not recognized. It does not turn the visible number into a seat count.
- Section matching requires the Schedule Builder term and the ASB+ term to agree, and the live row text to contain the backend course code. The overlay does not fall back to CRN-only matching across terms, because CRNs are reused.
- The extension's requirement context comes from rules in an optional planner snapshot import. Private plan, audit, and transcript data stay in the planner.
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

Start the ASB+ backend on hp and keep the `localhost:8000` tunnel open. Open the extension popup; it connects automatically. Use **Find sections** to search live sections, save CRNs, and open RMP search links for instructors. Use **Saved** to check meeting-time conflicts. Use **Refresh from ASB+** after refreshing public sections in ASB+, or to reload after the backend data changes. Optionally import a planner snapshot under **Backend and planning data** to add requirement rules; no section snapshot is needed. The extension shows RMP links only; it does not fetch or display ratings.

The signed-in Schedule Builder parser is still unverified. It reads visible rendered row text only and needs a five-digit CRN for each row. Use **Check Schedule Builder page** on the active tab to report what it detects.

## Next steps

1. Verify the parser on a signed-in Schedule Builder page in the student's own browser. Run **Check Schedule Builder page** and adjust selectors or status wording if the real DOM differs.
2. Resolve permission and approved use before considering RMP ratings or reviews.
3. Add a path for the student's requirement rules without a manual planner snapshot export, while keeping private plan, audit, and transcript data out of the extension and server.
