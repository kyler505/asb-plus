# Schedule Builder rebuild plan

**Implemented scope:** Spring 2027 (term `202711`) on supported signed-in planning routes. Exact CRN lookup, client-side ranking, and manual native-cart handoff are confirmed. Kyler remains responsible for all official registration actions.

## Goal and hard boundary

Make the extension the primary course discovery, comparison, and schedule-planning workspace inside the signed-in Schedule Builder page. Reduce switching between Schedule Builder, ASB+, and the planner. Schedule Builder/Howdy remain the authority for registration eligibility, current availability, holds, and enrollment.

The extension must never auto-register, submit a registration request, handle NetID passwords, SSO, Duo, or cookies, or call hidden Schedule Builder registration/cart APIs. RMP remains user-clicked links only. Degree plan, audit, transcript, and student preferences remain local to the planner/browser; do not send them to hp. Use only the signed-in page the student opened and authorized.

## Schedule Builder screens and flows

| Surface | Rebuild treatment | Boundary |
| --- | --- | --- |
| Build Schedule / options home | Replace the primary planning workspace on Spring 2027 options, Add Courses, and course routes | Show Find sections, Plan & rank, Saved, and Review CRNs together. Keep the native navigation visible and leave the Schedule Builder route and term unchanged. |
| Add Courses | Replace discovery on supported planning routes | Search course, title, instructor, five-digit CRN, or section attributes. Filter public open flags. Exact CRNs use the term-scoped lookup. |
| Course and section details | Compare sections inline | Show meeting blocks, readable page status and exact visible seat cells when present, public availability flag, historical grades, instructor match, user-clicked RMP search, local requirement fits, and conflicts. Never infer lecture/lab pairings. |
| Schedule generation/results | Rank locally in the browser | Rank non-conflicting combinations using available historical GPA and A/B outcomes. Plan state and scores stay local. Unknown meeting data is disclosed; combinations are capped at 25,000 evaluations and 12 displayed results. |
| Shopping Cart | Leave the native cart intact | Review selected section details and exact CRNs, copy the list, then use Schedule Builder's native Add Courses by CRN and cart controls. No cart API or synthetic cart state. |
| Current Schedule and registration | Leave native current-schedule and registration screens intact | Kyler reviews the native cart and clicks the real Register control himself. Extension never submits registration or impersonates that action. |
| Term/session selection, sign-in, help, sign-out, official eligibility/holds | Leave native | Only the Spring 2027 College Station planning routes are supported. Keep term selection, authentication, official notices, eligibility, holds, and registration outcomes native. |

The live Spring 2027 inspection confirmed native Build Schedule, Add Courses (Subject/Attributes/Instructor/CRN/Degree Planner), Shopping Cart, and Current Schedule entry points. The inspected Spring 2027 cart and current schedule were empty; this plan does not assume or alter a non-empty cart flow.

## In-page UI and data flow

1. The Manifest V3 content script runs only on `https://tamu.collegescheduler.com/*`. It mounts one isolated Shadow DOM root under `document.documentElement`. The native navigation remains visible; the native `<main>` is hidden only while the replacement workspace is active.
2. The supported route is Spring 2027 College Station options, Add Courses, or a numeric course-detail route. Check the visible term when present, route, app root, native navigation, and planning heading before replacement. Read only visible page text and elements; never inspect hidden app state or make authenticated page requests.
3. Before hiding the native page, connect to the localhost backend, confirm term `202711`, probe the exact CRN lookup contract, validate saved sections, and render the replacement. Search requests specify the term. Section records are accepted only when term and requested CRN match.
4. **Use original Schedule Builder** restores the native page and is a persistent local kill switch. Unsupported routes, DOM checks, data validation, backend failures, or search/ranking errors restore native visibility without retry loops.
5. A visible CRN is only a local observation. Numeric seats appear only when read directly from a visible `Seats Open` cell. Public open/closed flags are separate; no page or backend value is represented as a live seat count.
6. Compute conflicts and schedule ranking in the browser. Private plan state never reaches the backend. The ranking uses historical GPA and A/B data only; no server ranking endpoint or private preferences are involved.

## Native cart and registration handoff

The rebuilt workspace's **Review CRNs** view shows the chosen sections, meeting blocks, conflicts or incomplete data, public flags, and exact copyable CRNs. Its native Add Courses link closes the workspace and keeps that Add Courses route native until Kyler explicitly reopens ASB+. Kyler chooses By CRN, pastes the list, selects matching native sections, and uses Schedule Builder's own cart controls. Kyler reviews the native cart and clicks Register himself. No automatic Add, Send to Cart, Register, form fill, or private endpoint call.

## DOM-change fallback and kill switch

Fail open: the extension hides no native content until route, term, backend, exact lookup, saved data, and replacement rendering checks succeed. The native Schedule Builder DOM remains mounted and is never patched.

On unsupported routes or failed DOM/data checks, backend errors, or an exception during search or ranking:

- Remove `data-asb-rebuild-active`, detach the workspace, and restore the native page.
- Show a non-blocking local notice with the reason; do not retry-loop.
- Keep **Use original Schedule Builder** as a persistent local kill switch. Re-enabling is explicit.
- Never leave a blank shell or partially hidden native page.

The native-page fallback works when the backend is offline. This build restores the original page instead of presenting stale cached section data as current. Cached records remain local and carry their source/update time when the workspace is available.

## Performance and accessibility goals

- No blocking work in the page's critical rendering path; mount only after `document_idle` and yield enrichment work to idle time.
- Additive entry point visible within 100 ms of content-script start; supported route replacement within 300 ms after the required DOM is available. No blank transition and no measurable layout shift in native fallback.
- Search input responds immediately; debounce requests by 150 ms; target local-backend search p95 under 200 ms and render the first page within 100 ms after response.
- No polling. Observe only the relevant page root with a debounced `MutationObserver`; avoid full-page `innerText` rescans. Target under 1% CPU while idle and under 50 ms main-thread work per update on a 20-row view.
- Keep a bounded result/cache footprint; virtualize lists above 100 rows. Do not prefetch all term sections into extension storage.
- Keyboard navigation, visible focus, semantic labels, screen-reader status announcements, reduced-motion support, and usable zoom/reflow are required. Color is never the only availability/conflict signal.
- Measure route mount, search, render, and fallback with local Performance API marks during smoke testing. No analytics or remote telemetry.

## Backend contract confirmed with hp/t12

The extension uses typed public data from the localhost service worker bridge. No endpoint accepts student plans, audit/transcript content, credentials, or registration actions.

1. **Term:** the extension requires Spring 2027 term `202711`, checks the backend summary, and rejects a different term. No Fall 2026 or other-term fallback is supported.
2. **Search:** `/api/sections` supports term-scoped search, pagination, course/title/instructor queries, attributes, and public open filters. The client bounds results and validates every returned section's term.
3. **Exact/batch CRN lookup:** hp/t12 added `GET /api/sections?term=202711&crns=37075,37077` in commit `51bd00f`. The contract is exact term plus five-digit CRNs, maximum 50 per request, empty results for unknown CRNs, and typed HTTP 400 errors for invalid term or CRN lists. The extension batches larger lists and validates every returned term and CRN.
4. **Section data:** normalized records include meetings, section identity and type, instructors, attributes, public open/closed flag, source, update time, and historical grade context. Numeric seats remain unknown unless directly present in a readable native `Seats Open` cell.
5. **Grades:** course and exact normalized-name instructor history expose available samples, terms, sources, and update times. Missing data is not treated as a zero outcome; uncertain instructor matches are not guessed.
6. **Offline behavior:** failed required checks or later search/ranking requests restore the native page. The extension does not use stale cache to imply current availability.
7. **Schedule computation:** ranking is confirmed client-side. The backend provides section candidates only; private plan data and preferences stay in the browser.

RMP ingestion/ratings, user-plan storage, holds, authentication, and registration/cart operations are explicitly out of scope.

## Decisions confirmed

- Scope is Spring 2027 only.
- Native Schedule Builder owns Add Courses, the cart, and registration. The extension hands off CRNs; Kyler clicks Register himself.
- Schedule ranking remains client-side.
- Keep the fail-open native fallback and persistent kill switch.
