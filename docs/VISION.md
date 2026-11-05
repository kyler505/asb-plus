# asb-plus: build it all, better than AggieSB+ (Kyler, Nov 5 2026)

Kyler looked at Aggie Schedule Builder Plus (aggieschedulebuilderplus.vercel.app plus its Chrome/Firefox extension) and doesn't like it. He wants ours to do everything it does, better, plus the parts it lacks. The goal is ONE place that replaces TAMU's scattered tools: Howdy public search, Schedule Builder, anex.us, RMP, the degree planner and audit, holds and action items, and the Canvas advising rules. Speed is a priority (Rust backend). See docs/RESEARCH.md and the gitignored docs/INK-DEGREE-NOTES.md.

## Parity with AggieSB+ (then beat it)
- Course and professor search with GPA, A/B rates, difficulty, and filters.
- Professor insights: ratings, review summaries, would-take-again and similar stats, only professors teaching this term.
- Grade distributions per professor and course, from anex.us (verified working Nov 5: POST https://anex.us/grades/getData/ dept+number returns per-section A-F/Q, prof, year, semester, gpa) plus TAMU registrar grade reports as a fallback.
- Side-by-side comparison of courses and professors.
- Seat alerts on full sections.
- "Fits my schedule": import the current schedule, find core (UCC) or department sections that fit.
- An extension that overlays all of this inside tamu.collegescheduler.com.

## What makes ours better
- Degree planner built in: catalog-year-versioned requirement buckets (core, major, tracked electives with track coverage, writing/UCRT incl. section-number rules, High-Impact, emphasis/minor double count), with a student-controlled import (paste, PDF, or a sheet), and every inferred match shown for confirmation. Locked-plan awareness.
- Requirement-aware section picking: every section shows which bucket it satisfies and why.
- Schedule generator: all conflict-free combos (lecture + lab blocks), ranked by grades, ratings, time preferences, seats, and walking distance if feasible.
- Preflight: holds and action items checklist (e.g. Lab Safety for CSCE 482), time-ticket countdown, ordered CRN list with backups, Howdy links.
- Campus correctness: College Station default; Galveston and study abroad hidden.
- Much faster and cleaner UI than AggieSB+; good instructor-name matching with confidence, never a silent wrong match.
- Privacy-first: degree and audit data stays local in the browser by default. Minimal extension permissions (no blanket `cookies` permission, unlike AggieSB+). No third-party data sharing.

## Hard lines (do not cross)
- Never auto-submit registration. Never handle, collect, or relay NetID passwords, SSO or Duo, or session cookies. Never bypass SSO.
- Live seats only from what the signed-in user's own open Schedule Builder page shows (via the extension) or public open/closed flags. Never invent counts.
- RMP: their terms prohibit automated access and redistribution (see RESEARCH.md). Put RMP behind a swappable adapter with a config flag, cache conservatively, and list it as an open risk in docs for Kyler to decide on. Don't bury it.
- Be polite to Howdy and anex: conservative refresh, caching, backoff.
- Don't commit data/s27.json or docs/INK-DEGREE-NOTES.md.

## How to work
1. First write docs/PLAN.md: architecture (Rust API + DB + web frontend + browser extension), data pipelines, module list, phased milestones, and the differentiators above. Commit and push.
2. Then build in phases, each one working end to end, committed and pushed to origin main: (a) data ingest + search + grades, (b) professor insights + compare, (c) schedule generator + fits-my-schedule, (d) degree planner, (e) extension overlay + seat alerts, (f) preflight/ticket day. Keep docs/SUMMARY.md current.
3. If you hit a real decision only Kyler can make (naming, RMP, hosting/deploy target, accounts), stop and ask in the terminal instead of guessing.
