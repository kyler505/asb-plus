# ASB+

Local, read-only registration planning prototype for Spring 2027 at Texas A&M College Station.

## Run

Requires Rust and Cargo. Keep the provided `data/s27.json` and `data/s27_watch_state.json` files in `data/` (the full section dump is intentionally gitignored).

```sh
cargo run --release
```

Open <http://127.0.0.1:8000>. The app indexes the local JSON data at startup, then serves the interface and course data locally. Stop it with Ctrl+C.

For a development build, use `cargo run`.

## Prototype scope

- **Plan:** six requested courses, default picks, and available sections for changing the planned section.
- **Sections:** course search, a College Station filter, meeting details, and coarse public seat data with an eligibility warning.
- **Schedules:** checks preferred section picks for time overlaps and ranks conflict-free schedules without 8 AM starts first, then by reported positive public seats.
- **Ticket day:** preflight checklist saved in the browser, Howdy link, ordered CRNs, and copy action.

This app does not submit registration, access an account, bypass SSO/Duo, determine eligibility, refresh data, or claim live seat availability. The registration countdown is a static date label. The local data files are required; the large section dump is not committed.
