# Product flow: Schedule Builder workspace

## Goal and boundaries

The extension is the course discovery and planning workspace inside the signed-in Spring 2027 Schedule Builder page. Schedule Builder and Howdy remain authoritative for live availability, eligibility, holds, cart state, and registration.

- Supported scope: Spring 2027 College Station (`202711`) options, Add Courses, and numeric course-detail routes.
- The extension never handles credentials, SSO, Duo, cookies, private cart APIs, registration forms, or enrollment submission.
- RMP is a user-clicked search link only. Plan, audit, transcript, and preference data stay in browser storage.

## 1. Open the workspace

- Start the local ASB+ backend and keep the `localhost:8000` tunnel open.
- Open the signed-in Spring 2027 Schedule Builder planning page. The extension validates the route, visible term when present, native page anchors, backend term, exact CRN lookup, and saved section data before replacing the native main content.
- The native Schedule Builder navigation stays visible. **Use original Schedule Builder** restores the native page and persists the local choice.
- Unsupported routes, mismatched terms, missing backend data, or a later search/ranking failure restore the native page. No retry loop and no stale cache presented as live availability.

## 2. Find and compare sections

- **Find sections** searches course code, title, instructor, five-digit CRN, or section attributes. Search is term-scoped and debounced; public open/closed flags are optional filters.
- Cards show course and section identity, meetings, normalized section details, public Howdy flag, direct visible page status, historical course grades, exact instructor-name grade history, requirement fits from optional planner rules, and saved-section conflicts.
- Numeric seats appear only when a readable visible Schedule Builder `Seats Open` cell contains a numeric value. A public open/closed flag is never a seat count.
- Historical grade terms, samples, sources, and update times are shown when supplied. Missing grades are not zero. RMP opens only when the student clicks an instructor search link.
- Save CRNs locally to compare conflicts across searches. Exact section records are matched by both term and CRN.

## 3. Plan and rank locally

- **Plan & rank** starts with course codes visible on the native Schedule Builder page. Add additional courses from the current search or remove codes locally.
- The browser loads Spring 2027 section candidates and ranks non-conflicting combinations. Available historical GPA and A/B outcomes contribute equally to the score. Public open flags and time preferences are not ranking inputs.
- Search and schedule evaluation are bounded. A schedule run evaluates at most 25,000 combinations and displays up to 12. A capped run is labeled partial.
- Missing meeting data is disclosed and requires manual verification. Separate lecture/lab CRNs are not paired by inference.

## 4. Review CRNs and hand off to the native cart

- **Review CRNs** displays the chosen sections, meeting blocks, conflicts or incomplete checks, public flags, sources, and an exact copyable CRN list. It falls back to saved sections when no ranked set was selected.
- Copy the CRNs, open native **Add Courses**, choose **By CRN**, paste the list, and add the matching native sections to Schedule Builder's own cart. The workspace stays off on this native Add Courses route until Kyler explicitly reopens it.
- Review the native cart, availability, components, eligibility, and holds. Kyler clicks the real **Register** control himself. The extension never adds to the cart or registers automatically.

## Product limits

- The rebuild supports Spring 2027 only. Other terms and page shapes use native Schedule Builder.
- The backend must provide exact term-scoped CRN lookup. Requests batch at most 50 CRNs; unknown CRNs return no section, and malformed terms/lists fail with typed errors.
- Degree requirements remain guidance from optional local planner rules, not official audit data. Confirm rules, prerequisites, restrictions, and eligibility with TAMU.
- Public section flags and grade history are not guarantees of live availability or outcomes. Confirm registration details in Schedule Builder and Howdy.
