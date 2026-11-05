# asb-plus implementation plan

## Product boundary

Build a local-first planning hub that combines public course data, historical outcomes, user-confirmed degree progress, schedule options, and registration preflight. Keep Howdy and Schedule Builder as the final authority for current availability, eligibility, and enrollment. No credentials, cookies, SSO/Duo flows, or automated registration. Degree/audit imports stay in the browser by default. Do not commit `data/s27.json` or `docs/INK-DEGREE-NOTES.md`.

## Architecture

- **Rust modular monolith:** Axum HTTP API, Tokio runtime, SQLx with SQLite. Move the current single-file HTTP server to typed request/response models, versioned migrations, repositories, and domain services. Bind to localhost by default.
- **Database:** SQLite stores public term/catalog snapshots and grade aggregates with source, term, and retrieval timestamps. Suggested tables: `terms`, `courses`, `sections`, `meetings`, `instructors`, `section_instructors`, `grade_observations`, `catalog_programs`, `requirement_rules`, and `source_runs`. Keep user plan, transcript, audit, holds, and preferences in browser IndexedDB, not the server database.
- **Plain web frontend:** Retain and evolve the existing HTML/CSS/JavaScript app. Screens call the local API for public data; browser modules handle user-owned imports and private state. No third-party analytics or remote data sharing.
- **Data adapters:** Separate Howdy public sections, TAMU Registrar historical grade reports, anex.us, TAMU catalog, and a disabled-by-default RMP provider. Persist provenance and freshness; add bounded concurrency, deduplication, caching, timeouts, and backoff. Start with manual refresh; cap full Howdy refresh at one request per six hours and keep last-known good snapshots on failure.
- **Instructor matching:** Normalize display names, use school and department as evidence, store match confidence and source, and require a person to resolve ambiguous matches. No rating badge for a low-confidence match.
- **Extension:** Manifest V3, narrow host permission for `tamu.collegescheduler.com`, content script that reads only visible rendered text/DOM, and `storage` for local preferences. No `cookies` permission, hidden endpoint calls, background session polling, page reloads, or write actions. Communicate only with localhost when the user opts in.
- **Schedule engine:** Represent each lecture/lab meeting separately; detect overlapping intervals by weekday; rank only from available evidence (grade outcomes, permitted instructor stats, user time preferences, user-observed seat status, and walking time when building/location data supports it). Explain every score component.
- **Degree model:** Version rules by catalog year and program. Parse user-pasted text, PDF, or CSV in the browser, preview extracted courses/rules, and require confirmation for each inferred match. Treat advisor/department overrides and section attributes as explicit, sourced rules rather than guesses.

## Module map

`src/api/` routes and DTOs; `src/db/` migrations and queries; `src/domain/sections.rs`, `grades.rs`, `instructors.rs`, `schedule.rs`, `degree.rs`, and `preflight.rs`; `src/ingest/howdy.rs`, `registrar.rs`, `anex.rs`, `catalog.rs`, and `rmp.rs`; `static/` screen modules and local import UI; `extension/` manifest, content reader, and preferences. Keep source-specific parsing out of routes and keep private student imports out of Rust/server APIs.

## Delivery phases

Every phase must run end to end, update `docs/SUMMARY.md`, pass the focused smoke scenario and relevant regression checks, and be committed and pushed before starting the next phase.

### A. Data ingest, search, and grades

- Replace startup-only JSON parsing with SQLite migrations and a reproducible importer for local section dumps.
- Add conservative, user-triggered public Howdy refresh; parse section meetings, instructor display names, site, attributes, and source timestamps. Expose open flags distinctly from numeric seats; show `unknown` rather than fabricate counts.
- Import course/instructor grade distributions from the verified anex endpoint and provide a Registrar report fallback. Retain course, instructor, section, term, and A-F/Q outcome details; cache requests and preserve source metadata.
- Build searchable course/section and professor discovery with term, campus, subject, time, attributes, instructor, GPA, A/B rate, and difficulty filters.
- **Acceptance:** fresh database can be populated from the local data and source adapters; search returns correct CRNs, meeting blocks, and explicit freshness/unknown-seat status; grade rows retain term and instructor; source failure preserves existing data and produces a recoverable UI message; no registration or auth code exists.

### B. Professor insights and comparison

- Add professor search and profile pages for professors teaching this term, with course/term-filtered grade distributions and, only when permitted, RMP ratings, review insights, would-take-again and related aggregates. Add course and professor side-by-side compare.
- Add confidence-scored instructor resolution and a manual correction workflow.
- **RMP gate:** keep the RMP adapter disabled and make no RMP requests or redistribution by default. RMP's terms prohibit automated access without prior permission. Before enabling or shipping RMP ratings/reviews, stop and ask Kyler whether he has permission or wants RMP limited to profile links. Do not continue that integration without approval and permission.
- **Acceptance:** compare handles multiple instructors and missing data without false zeroes; an ambiguous name is visibly unresolved; RMP remains disabled unless approved; all metrics disclose source and sample size.

### C. Schedule generation and “fits my schedule”

- Enumerate every conflict-free combination across lecture/lab blocks with conflict pruning and incremental ranking; do not silently truncate results. Rank with explainable available grade/rating evidence, time preferences, user-observed seats, and walking distance when reliable location data exists.
- Import current classes from a student-selected ICS/CSV or typed blocks, parse locally, and find core/UCC or departmental options that fit around them.
- Add comparison between alternative schedules and display unscored/missing data explicitly.
- **Acceptance:** test overlaps at boundaries, cross-day meetings, lecture/lab pairs, TBA times, and no-solution cases; a local imported schedule never leaves the browser; schedules with the same inputs rank deterministically; no seat count is inferred from an open flag.

### D. Degree planner and audit

- Add catalog-year/program requirements and student-controlled local import for UGDP plan, audit/PDF text, and CSV/spreadsheet exports. Show parsed content for review before saving locally.
- Add requirement buckets for UCC/core, major, tracked electives and track coverage, writing/UCRT, high-impact, emphasis/minor double counts, prerequisites, and minimum grades when the imported/catalog source specifies them.
- Show requirement matches on courses and sections with a traceable “why,” source, and confidence. Handle a locked plan as an explicit constraint; distinguish plan state, audit result, and Holds/Action Items.
- **Acceptance:** no private file is sent to the server; student can correct or reject every parsed match; catalog year and source remain visible; uncertain rules are not marked satisfied; course-to-section rules preserve section-level attributes; a plan change does not silently rewrite an approval state.

### E. Extension overlay and seat alerts

- Build the minimal-permission extension for Schedule Builder. Overlay section data, grade summaries, professor information (only approved sources), requirement fit, and schedule conflicts on the currently visible course rows.
- Let the student save desired sections and show an alert when the user's open page visibly changes from full/closed to open, or when public open/closed data changes after a manual refresh. Do not poll hidden endpoints or reload authenticated pages in the background.
- **Acceptance:** extension only requests the Schedule Builder host and local storage; it reads rendered data only, labels the source and observation time, never changes page state or submits, and alerts only on an observed state transition.

### F. Preflight and ticket day

- Add a configurable local registration-window countdown, user-maintained Holds/Action Items checklist, ordered CRN paste list, explicit backups, and Howdy links. Keep state in the browser.
- **Acceptance:** countdown handles timezone and expired windows; checklist persists locally and is editable; CRN ordering shows its reason; copy failure gives a manual recovery path; no action can submit enrollment.

## Open risks and decision gates

- **RMP:** licensing permission is unresolved. Keep disabled and ask before integration.
- **Live seats:** public Howdy has `NA` numeric capacity fields; Schedule Builder values are available only in the user's own open authenticated page. Never promise server-side live seats.
- **Degree rules:** catalog, audit, and departmental advising can disagree or be section-specific. Imported audit and student confirmation take precedence for personal progress; label catalog guidance and advisor-only rules.
- **Host/store publishing:** develop for local use and load-unpacked extension tests. Ask Kyler before selecting a public host, store publisher account, or publishing a build.
- **anex terms and availability:** use bounded requests and cache results; re-check endpoint/terms before deployment and preserve Registrar fallback.
