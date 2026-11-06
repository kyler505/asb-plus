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
- The popup remains available for extension-local data and backend settings. On supported signed-in Spring 2027 College Station options, Add Courses, and course routes, the in-page workspace replaces the native main content after route, term, backend, exact-lookup, and saved-data checks; native navigation remains visible.
- Find sections searches course, title, instructor, five-digit CRN, or attributes. Cards show section meetings and details, public flags, readable page status, historical grade context, requirement fits, saved conflicts, and source/update information. Numeric seats are shown only from a visible numeric `Seats Open` cell.
- Exact CRN requests use `/api/sections?term=202711&crns=...`, in batches of at most 50. Returned term and CRNs are validated. Unknown CRNs produce no section.
- Plan & rank computes combinations locally using historical GPA and A/B data. Evaluation is capped at 25,000 combinations and 12 displayed options; incomplete meeting data is labeled. Public flags and time preferences are not ranking inputs.
- Review CRNs shows selected section details, meeting conflicts or unknowns, public flags, and exact copyable CRNs. Kyler chooses By CRN in native Add Courses, uses the native cart, and clicks Register himself. The handoff link leaves Add Courses native until he explicitly reopens the workspace; no cart or registration API is called.
- Unsupported routes, term/backend mismatch, or later data/search/ranking failures restore the native page. **Use original Schedule Builder** is a persistent local kill switch. Optional planner snapshot import adds only requirement rules; private plan, audit, and transcript data stay local.
- Preflight lets the user enter a registration-window time and IANA time zone. It shows a local countdown, handles elapsed times, and rejects local times that do not exist during a daylight-saving clock change.
- The user can maintain a local Holds/Action Items checklist with editable completion state. ASB+ does not read Howdy to detect or verify holds.
- A ranked schedule can become the primary ordered CRN list. The user can reorder courses, record why the order matters, and add backup CRNs only from generated schedules that fit the other chosen primary sections. Stale backups stay visible and are marked for manual verification.
- The copy action copies primary CRNs only. If clipboard access fails, ASB+ selects the list for manual copying. Howdy and Schedule Builder links open in separate tabs; the app cannot submit enrollment.
- Countdown, checklist, ordered CRNs, ordering reason, and backup CRNs stay in browser local storage and are not sent to the server.

## Earlier live overlay integration (Nov 6, 2026)

These notes verify the previous row-overlay build. The overlay has since been replaced by the Spring 2027 in-page workspace.

- Loaded `extension/` unpacked in Chrome for Testing 150 against the ASB+ backend on hp through the `localhost:8000` SSH tunnel.
- The popup connected and showed Spring 2027, 20,703 sections, and 5,007 courses.
- Searched `CSCE 482`: 10 live sections with meeting blocks, `howdy-public` source, mean GPA 3.81, 96.9% A/B, 111 grade records, and anex/registrar-pdf sources.
- Verified on the real signed-in Aggie Schedule Builder in Kyler's own Chrome session. No credentials, SSO, Duo, or cookies were handled.
- The Fall 2026 page was detected as a term mismatch with the Spring 2027 backend. The overlay showed the page term, the backend term, and refused section details. This prevented CRN 53942 from displaying the different Spring 2027 CHEM 258 course.
- On the Spring 2027 CSCE 482 course page, the overlay attached to the live section table. Five visible rows showed live meetings, public flags, mean GPA 3.81, 96.9% A/B, 111 grade records, anex/registrar-pdf sources, instructors, RMP search links, and Save buttons.
- Saved CRNs 37075 and 37077 from the live overlay. Both panels showed the exact meeting-time conflict, and the popup Saved view reported the same conflict. Remove and Save toggles updated the live overlay.
- The overlay scanned on DOM changes, scrolling, and visibility changes. A timer debounce replaced `requestAnimationFrame`, because Chrome throttles rAF in an occluded window and the overlay would otherwise never attach.
- The extension action was pinned in the toolbar (`isOnToolbar: true`), with one Chrome window and one Schedule Builder tab.


## Verified live rebuild

- Synced the unpacked extension source to `/Users/kcao/.asb-plus-extension-live/` and reloaded it in the same signed-in live Chrome window.
- On the Spring 2027 College Station options page, the workspace activated after DOM and backend checks; the native navigation remained visible. Header reported term Spring 2027 and 20,703 sections.
- `CSCE 482` search returned 10 sections with meeting blocks and historical grade context. Exact CRN `37075` returned one Spring 2027 CSCE 482 section.
- Attribute search returned 100 results, the public-open filter returned only open-flag sections, and Load more appended 19 more results.
- Ranked the six course codes already on the page: 100 non-conflicting combinations evaluated locally, 12 displayed, and incomplete meeting data explicitly labeled.
- Review CRNs showed section details, exact CRNs, and meeting conflicts. Opening native Add Courses left the native page visible and the cart at 0; no section was added and Register was not clicked.
- Temporarily pointed the extension backend setting at unreachable localhost port 1. The workspace failed open, restored native main visibility, and displayed an explicit backend-unavailable notice. Restored `http://localhost:8000`, reloaded the page, and confirmed the workspace active.
- Disabled the workspace, confirmed the local kill switch remained off after page reload, then explicitly re-enabled it. Final live page is the Spring 2027 options page with the workspace active.

## Stubbed or not included

- RMP ratings and reviews are not embedded. The extension only opens a user-clicked RMP search link; automated access and redistribution remain disabled until permission and approved use are resolved.
- The rebuild supports Spring 2027 College Station only. Other terms and unsupported page routes remain native.
- Live page status and numeric seats depend on readable native DOM. Numeric seats are displayed only from a visible numeric `Seats Open` cell; backend public flags are not counts.
- Selected sections are sent to native Schedule Builder by copying CRNs, not through a cart API. Schedule Builder owns cart state, eligibility, and registration; Kyler clicks Register himself.
- Requirement context comes from rules in an optional planner snapshot. Private plan, audit, and transcript data stay in browser storage.
- Public section data does not reliably link separate lecture and lab CRNs. The extension does not guess those pairings; confirm components in Schedule Builder.
- Built-in catalog program requirements, automatic Howdy UGDP/audit sync, and official audit or eligibility checks are not included. Users must enter or import requirement rules.
- OCR for scanned PDFs is not included. Plan and audit PDF text extraction runs locally in the browser and requires extractable text.
- Holds are not verified, and the user enters ticket times manually. ASB+ does not check holds, determine ticket eligibility, or submit registration.
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

Start the ASB+ backend on hp and keep the `localhost:8000` tunnel open. Open the signed-in Spring 2027 College Station Schedule Builder page. The in-page workspace connects automatically, searches sections, compares saved CRNs, ranks combinations locally, and prepares a native cart handoff. Copy CRNs from **Review CRNs**, use native Add Courses by CRN, then use Schedule Builder's cart and click Register yourself. The popup remains available for backend and planning data settings. Optional planner snapshot import adds only requirement rules; no section snapshot is needed.

The rebuild supports Spring 2027 options, Add Courses, and numeric course-detail routes. Other routes use the original Schedule Builder. If a page, backend, or data check fails, use the native page; **Use original Schedule Builder** disables replacement mode locally.

## Next steps

1. Resolve permission and approved use before considering RMP ratings or reviews.
2. Users who need requirement context must import or enter local planner rules; no official rules or audit data are synced.
