# Product flow: one course workspace

## Why the guided wizard missed the goal

The four-step flow treated planning as separate destinations. That did not make Schedule Builder, grade history, instructor information, and requirement matches feel like one tool.

1. The student starts in the standalone planner, then opens Schedule Builder and separately installs or opens the extension.
2. The extension reads public section, grade, and instructor data live from the local ASB+ backend. A planner snapshot is optional and only adds requirement rules.
3. Finding a course, saving its section, and comparing it with other sections happen in different places.
4. Grade and instructor context is not the same as Anex.US section history, and the RMP area only said that ratings were disabled.
5. The student must leave the section decision to search RMP, with no direct path from the instructor name.
6. A degree plan or audit is private, and its local requirement matches are not automatically carried into the extension.
7. Open/closed status is easy to mistake for live seats unless the source and limitation appear beside it.

## New path: Schedule Builder plus a saved-section workspace

Treat the browser extension as the main course comparison surface, like UT Registration Plus. Keep Howdy and Schedule Builder as the registration systems. The extension adds local course, grade, professor, and requirement context without changing the registration page.

### 1. Load course context

- Keep the ASB+ backend running on hp and the localhost:8000 tunnel open. The extension popup connects automatically and shows the term and section count.
- **Find sections** searches live public sections, historical grades, and instructor context from the backend. Results also show requirement fits when planning rules are present.
- Optionally import a planner snapshot under **Backend and planning data**. It adds the student's requirement rules and stays in extension-local storage. It does not contain the degree plan, audit, transcript, numeric seats, or RMP data, and it does not replace live section data.
- The extension requests only the local ASB+ backend. It sends no degree, audit, or transcript data and makes no third-party requests.
- Next action: search a course, instructor, title, or CRN under **Find sections**.

### 2. Compare a section where the choice happens

- In the extension popup or visible Schedule Builder row, show section number, CRN, meeting times, public status and source, historical course grade summary, instructor grade match, and any requirement fit with its reason.
- The extension shows a **Search RMP for [instructor]** link. It does not fetch, cache, display, or redistribute RMP ratings or reviews without the permission required by `docs/VISION.md`.
- Use **Save section** to keep a CRN in the local workspace. Label public open/closed flags as flags, not seat counts. Show a user's own visible status only when the extension can read it on the open page.
- Next action: save a section or compare another search result.

### 3. Check the saved schedule

- The **Saved** view lists each saved CRN with its meeting times, grade context, public flag, instructor link, and requirement fit.
- Compare saved meeting blocks and report exact overlaps. If any meeting time is missing, say that the check is incomplete and ask the student to confirm it in Schedule Builder.
- Refresh with **Refresh from ASB+** after the backend updates public sections. A public-flag alert appears when a saved CRN's observed flag changes; a visible-status alert appears only after the student's open page visibly changes from closed to open.
- Next action: resolve any conflict or copy the saved CRNs manually for a Howdy handoff.

### 4. Register in Howdy

- Open Howdy or Schedule Builder in a separate tab and confirm live availability, holds, eligibility, and course components.
- The extension never handles credentials, SSO, Duo, cookies, registration forms, or registration submission. It does not import a cart or promise a CRN deep link.
- Next action: complete registration yourself in Howdy.

## Product limits and next work

- This is not a replacement for Howdy registration or authenticated Schedule Builder actions.
- RMP ratings and reviews remain off until written permission and approved use are confirmed. A user-clicked search link is the only RMP integration in this flow.
- Public section data now arrives live from the local backend. Requirement rules still need an optional planner snapshot export and import.
- Degree plan and audit imports stay in the planner's local browser storage. Only rule definitions and rule-based requirement matches reach the extension.
- The extension has not been validated against the signed-in Schedule Builder DOM. Only inspect an authenticated page in the student's own browser with their explicit authorization. Never sign in, handle credentials, or reuse their cookies on their behalf.
