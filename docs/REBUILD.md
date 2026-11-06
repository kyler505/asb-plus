# Schedule Builder rebuild plan

## Goal and hard boundary

Make the extension the primary course discovery, comparison, and schedule-planning workspace inside the signed-in Schedule Builder page. Reduce switching between Schedule Builder, ASB+, and the planner. Schedule Builder/Howdy remain the authority for registration eligibility, current availability, holds, and enrollment.

The extension must never auto-register, submit a registration request, handle NetID passwords, SSO, Duo, or cookies, or call hidden Schedule Builder registration/cart APIs. RMP remains user-clicked links only. Degree plan, audit, transcript, and student preferences remain local to the planner/browser; do not send them to hp. Use only the signed-in page the student opened and authorized.

## Schedule Builder screens and flows

| Surface | Rebuild treatment | Boundary |
| --- | --- | --- |
| Build Schedule / options home | Replace the primary planning workspace | Keep the native route and term/session state detectable. Show term, course search, chosen courses, schedule constraints, saved choices, and result ranking in one workspace. |
| Add Courses | Replace the By Subject / By Section Attributes / By Instructor / By CRN discovery flow | Provide one search across course, title, instructor, CRN, and attributes; show results with filters and source/freshness. Reuse equivalent capability, not TAMU's private UI or API. |
| Course and section details | Replace section discovery and comparison | Inline meeting blocks, observed page status/seats when readable, public availability flag, historical grades, instructor grade match, user-clicked RMP search link, requirement fit, and conflict explanation. Keep lecture/lab components distinct; never infer pairings. |
| Schedule generation/results | Replace the planning results and comparison surface | Rank conflict-free choices with explainable factors and let the student pin, compare, and revise alternatives. Show missing data as unknown, not zero. Personal constraints/rules stay local. |
| Shopping Cart | Leave the native cart intact for the handoff | The extension may show a preflight summary and exact CRNs, but it must not call cart APIs or synthesize cart state. Kyler reviews and uses Schedule Builder's real Send to Cart / cart controls. |
| Current Schedule and registration | Leave the native current-schedule, Register-by-CRN, edit, registration-instructions, and result screens intact | These are TAMU-owned authenticated/transactional flows. Kyler clicks the real Register control and completes any official steps. Extension never submits or impersonates that action. |
| Term/session selection, sign-in, help, sign-out, official eligibility/holds | Leave native | Do not replace authentication, official notices, term selection, eligibility, holds, or registration outcomes. Detect the selected term and return to the original page on mismatch or uncertainty. |

The live Spring 2027 inspection confirmed native Build Schedule, Add Courses (Subject/Attributes/Instructor/CRN/Degree Planner), Shopping Cart, and Current Schedule entry points. The inspected Spring 2027 cart and current schedule were empty; this plan does not assume or alter a non-empty cart flow.

## In-page UI and data flow

1. A Manifest V3 content script runs only on `https://tamu.collegescheduler.com/*`. It mounts one isolated Shadow DOM root under `document.body`; the shadow root owns styles, event handlers, and the rebuilt workspace. Do not add a UI framework just to restyle the existing React app.
2. Start in additive mode: show a small ASB+ entry point and leave the original page visible. Parse the visible term and visible course/section text only. Ask the local background service worker for public data from `http://localhost:8000`; use a bounded cache. Never make authenticated page requests or inspect hidden app state.
3. Replace a supported planning route only after the health check has found a known route, selected term, course/section anchors, and readable row content. Keep the Schedule Builder DOM mounted; do not overwrite its React root. Apply a scoped `asb-rebuild-active` class only after the replacement view has rendered successfully. The extension owns the overlay DOM; it does not patch the site's React components or internal state.
4. Keep an always-visible **Show Schedule Builder** control. It removes the active class and overlay, restores the original DOM and scroll position, and leaves the route and term unchanged. Route changes, page errors, or failed data/DOM checks also return to the native page.
5. Each section view joins backend records only when term and course code match the visible page row. CRNs can be reused across terms. Include the backend term, visible page term, source, and observation time. If term/course cannot be established, show no backend section details and disable saving that row. Public open/closed flags and visible seat cells are separate facts; numeric seats are shown only if directly present in a readable, current source.
6. Compute meeting conflicts and requirement fits locally. Keep private degree/audit data out of messages to the background worker and backend. Historical grade outcomes and instructor matching must disclose term, sample size, source, and unmatched/ambiguous status. RMP opens a user-clicked search link only.

## Native cart and registration handoff

The rebuilt workspace is a planning surface, not a registration client. On **Review in Schedule Builder**, show a preflight with selected course, section, CRN, meeting blocks, conflicts, unknown data, and a copyable ordered CRN list. Then restore the native page and navigate to the corresponding real Schedule Builder course/section or cart route without submitting a form or calling a private endpoint. The student chooses/adds sections and clicks the native Send to Cart/cart controls. From the native cart, Kyler reviews and clicks the real Register control himself; any registration-by-CRN or waitlist action stays in Schedule Builder's native Current Schedule flow.

Never auto-click a native Add, Send to Cart, Register, Submit, or confirmation button. Never write into Schedule Builder's internal React store, call its cart/registration network operations, inject CRNs into a registration form, or claim the plan is registered. If there is no stable, visible native route/control for a selected section, stop at the CRN handoff and ask Kyler to continue manually.

## DOM-change fallback and kill switch

Fail open: the extension must not hide or disable the original Schedule Builder page until a complete health check and a rendered replacement view both succeed. Maintain a versioned selector/route adapter for each supported page shape. Validate required anchors, readable visible rows, term parsing, and expected native controls on initial load and route/DOM changes.

If any required selector disappears, a parser throws, the page term is unknown, or the adapter sees an unsupported shape:

- Remove `asb-rebuild-active`, detach the extension overlay, and restore original visibility/focus/scroll.
- Show a small, non-blocking notice that the rebuild is unavailable and Schedule Builder is unchanged; do not retry-loop.
- Record only local diagnostic facts (route class, adapter version, missing selector names, timestamp); never record page text containing personal data or credentials.
- Offer **Use original Schedule Builder** as a persistent local kill switch. It disables replacement mode until the student explicitly turns it back on. A development-only query flag can force native mode for support.

The native-page fallback must work when the backend is offline. In that case retain cached public data only with an explicit stale label; disable any action that depends on unverified section matching. Never leave a blank shell or partially hidden native page.

## Performance and accessibility goals

- No blocking work in the page's critical rendering path; mount only after `document_idle` and yield enrichment work to idle time.
- Additive entry point visible within 100 ms of content-script start; supported route replacement within 300 ms after the required DOM is available. No blank transition and no measurable layout shift in native fallback.
- Search input responds immediately; debounce requests by 150 ms; target local-backend search p95 under 200 ms and render the first page within 100 ms after response.
- No polling. Observe only the relevant page root with a debounced `MutationObserver`; avoid full-page `innerText` rescans. Target under 1% CPU while idle and under 50 ms main-thread work per update on a 20-row view.
- Keep a bounded result/cache footprint; virtualize lists above 100 rows. Do not prefetch all term sections into extension storage.
- Keyboard navigation, visible focus, semantic labels, screen-reader status announcements, reduced-motion support, and usable zoom/reflow are required. Color is never the only availability/conflict signal.
- Measure route mount, search, render, and fallback with local Performance API marks during smoke testing. No analytics or remote telemetry.

## Backend work requested from hp/t12

The extension must use typed public data from the localhost service worker bridge. No endpoint may accept student plans, audit/transcript content, credentials, or registration actions.

1. **Term contract:** return canonical term code, display label, campus, and data freshness from `/api/terms` and `/api/summary`. The client must request a term explicitly and reject mismatches. Current backend observations were Spring 2027 while the signed-in page initially showed Fall 2026; this is a correctness blocker for a full live replacement.
2. **Search contract:** support one paginated section/course query by term, course code, title, instructor, CRN, and section attributes, with filters for campus, meeting days/time, public open flag, GPA/A/B history, and instruction mode. Return total count, stable sort/pagination, and normalized section/course identity. Existing `/api/sections` can be extended if its contract remains clear.
3. **Exact/batch lookup:** add a term-scoped exact section lookup and a batch lookup for selected CRNs, with bounded request size. CRN alone is not a key. Return enough data for meeting conflicts and visible comparison without downloading all sections.
4. **Section DTO:** expose normalized meetings, section component/type, instructor display names and match confidence, attributes, prerequisites/restrictions when sourced, public open/closed flag, data source, and per-record updated time. Keep numeric seats/capacity/enrollment `null` unless a verified source supplies those exact values; never convert public flags into counts.
5. **Grades:** support course and instructor historical distributions with term/sample count/source; distinguish no records from zero outcomes. Return ambiguous or absent instructor matches explicitly, not as a guessed professor profile.
6. **Freshness and errors:** include source/update timestamps, stale status, request term, and backend term in responses. Preserve last-known-good data on ingest failure and return typed errors/rate limits so the extension can show cached/stale/offline states honestly.
7. **Schedule computation:** please advise whether hp wants the extension to keep combination/ranking computation client-side (private constraints stay local) or add a stateless public-section candidate endpoint. Do not accept or persist private preferences or requirement rules. A backend endpoint is optional only if it returns raw candidates and preserves local ranking/explanation.
8. **Data coverage question:** can hp ingest the current Fall 2026 term as well as Spring 2027, with per-term refresh and source freshness? If not, return an explicit unavailable-term response; never serve Spring 2027 sections for a Fall 2026 page.

RMP ingestion/ratings, user-plan storage, holds, authentication, and registration/cart operations are explicitly out of scope. hp/t12 should reply with which contracts/data coverage it can support, likely endpoint/DTO shapes, and any source/permission blockers before implementation begins.

## Decisions needed before implementation

- Confirm that the replacement scope above is acceptable, especially leaving native cart/current schedule/registration screens intact.
- Confirm whether course/component selection should only prepare a CRN handoff or whether any native, user-clicked Add-to-Cart control may be surfaced in place. Default: no programmatic control activation; Kyler operates native controls.
- Confirm whether Fall 2026 must be supported in addition to Spring 2027 and which section source may supply it.
- Confirm whether schedule generation/ranking remains in the extension so private time preferences stay local.
- Confirm what exact layout/route shapes are in scope after the signed-in DOM is inspected; selectors observed on one term are not a compatibility guarantee.
