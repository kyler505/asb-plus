# Prototype summary

## What works

- Rust server loads and indexes the local Spring 2027 section dump; measured startup indexed the 19 sections for the six planned courses in 0.32 seconds.
- Plan screen shows section choices and instructor names.
- Sections screen filters by College Station, course, instructor, or CRN; it shows meeting data and labels seat data as coarse.
- Schedules screen checks preferred picks for time overlaps, treats each CSCE 482 meeting block separately, and ranks schedules by avoiding 8 AM starts then favoring reported positive public seats.
- Ticket day shows the registration window, a browser-persisted preflight checklist, ordered CRNs, a copy action, and alternate CSCE 482 CRNs.
- The app is local and read-only. It does not sign in, submit registration, or bypass SSO/Duo.

## Stubbed or not included

- Seat counts can be NA or stale; no live Schedule Builder connection or refresh is implemented.
- Eligibility and prerequisites are not determined. Confirm them in Howdy.
- Registration countdown is a fixed date label, not a live timer. Howdy checklist links lead to the general portal.
- Schedule choices use preferred section flags. Seat ranking uses only the provided coarse public snapshot. No degree-plan import, grades, RMP, alerts, or live seat ranking.
- The local `data/s27.json` and `data/s27_watch_state.json` files are required. `data/s27.json` is gitignored; the personalized watch-state file is local-only and is not included in the commit.

## Run

Requires Rust and Cargo. Place both provided JSON files in `data/`, then run:

```sh
cargo run --release
```

Open <http://127.0.0.1:8000>. The server indexes the section data at launch. Stop it with Ctrl+C. See `README.md` for screen details.

## Next steps

1. Verify eligibility and restrictions using explicit user-entered completed courses and authoritative catalog data.
2. Add a controlled refresh path and live seat source only with the user's authorized access.
3. Improve ranked schedule alternatives and include broader section combinations.
4. Import degree-planner and tracked-elective data.
