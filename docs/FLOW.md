# ASB+ guided planning flow

## First-time Spring 2027 walkthrough

I followed the app in a clean browser with Spring 2027 selected. I searched for CSCE 482, opened its grade data, then tried to add it to a schedule.

1. The first screen starts with a large filter form and 100 sections, not a planning question. Five navigation links look like five separate screens, but they jump through one long page. There is no progress indicator or next step.
2. The course form shows many choices at once: subject, instructor, day/time, attributes, GPA, difficulty, and A/B rate. The meaning of several choices is not clear to a student who only wants a required course.
3. Search results show course grades and instructors, but do not let the student choose a section or add a course to a schedule. The separate grade dialog has many historical rows and no next action.
4. Professor insights is another independent search even though section results already show instructor names. The student must search again to see an instructor profile. Course and professor comparison are separate destinations too.
5. The schedule screen asks for course codes again. After searching for CSCE 482, the schedule course field was blank. The student must copy or remember the code, then re-enter it.
6. The schedule screen mixes course entry, an advanced ranking formula, calendar import, degree-specific CRN choices, extension export, schedule results, and ticket-day tools. It gives no clear order for these tasks.
7. Degree planning is a separate, empty screen with many controls. The student must add program details and enter or import requirement rules before requirement picking can help. The difference between a plan, audit, rule, and official degree decision is easy to miss.
8. Degree-specific section picking is separate from the course search and schedule builder. The student has to understand CRNs and connect a selected rule to schedule choices without a guided handoff.
9. Ticket-day tools sit after all schedule results. In the walkthrough, the preflight section was thousands of pixels below the schedule controls. There is no clear handoff from a chosen schedule to the final ticket checklist.
10. Terms such as CRN, UCC, UCRT, UGDP, A/B rate, mean GPA, and open flag appear without a simple explanation at the decision point. The schedule score formula adds more jargon before the student sees an option.
11. The same course or instructor can be typed in different places. Some choices persist in browser storage, but search input, generated results, degree data, and schedule choices have different save behavior. The flow does not show what is saved or carried forward.

## New path: four guided steps

Keep one flow from degree needs to a Howdy handoff. Use a visible four-step progress bar. Each step has one main action, a Back action, and one clear Continue action. Continue preserves state. A student can return to an earlier step to change choices.

### 1. What do you need?

- Show Spring 2027 as the selected term.
- Let the student enter course codes or start from imported degree-plan courses and confirmed requirement rules.
- Keep degree plan, audit, and rule imports optional and local. Explain that no official rules are preloaded and that this is not an official audit.
- Show a short course list to carry into section picking. Allow the student to continue with course codes even without degree data.
- Next action: **Choose sections**.

### 2. Choose sections

- Show sections for the carried course list. Keep search and less-used filters available without putting every filter in the first view.
- Each section shows its meeting times, public open/closed flag and source, course grade summary, instructor name and available instructor history, and any confirmed requirement fit with a short reason.
- Make section selection the action that adds its CRN to the shared schedule list. Show the selected list and its remove controls on this step.
- Offer requirement-based section picking inline when the student has confirmed rules. Do not send the student to a separate professor screen to understand an instructor.
- Next action: **Build schedule**.

### 3. Build schedule

- Start with the same course and CRN selections from step 2. Do not ask the student to retype them.
- Put time preferences and an imported weekly schedule behind a clear optional control.
- Generate conflict-free schedules. Show grade and requirement context beside each ranked option, with a plain-language reason for its rank. Keep comparison inside these options.
- Let the student choose one schedule as the primary ticket-day list. Do not copy backups into the primary list.
- Next action: **Prepare for ticket day**.

### 4. Ticket day

- Keep the local time-ticket countdown, user-maintained Holds/Action Items, chosen CRN order, reason, and compatible backup CRNs together.
- Copy only primary CRNs. If clipboard access fails, show a selected, manual-copy list.
- End with a clear handoff to Howdy or Schedule Builder. Registration, eligibility, and holds remain the student's responsibility in Howdy.

## Hard lines

- Keep degree plans, audits, checklists, time tickets, and preferences in browser storage. Never send private student data to the server by default.
- Never handle credentials, SSO, Duo, or cookies. Never submit registration or bypass login.
- Show only public open/closed flags or visible status from the student's own open Schedule Builder page. Never invent seat counts.
- Keep RMP disabled until permission and approved use are resolved.
- Keep course and instructor data sources visible. Make no silent instructor match or requirement match.
