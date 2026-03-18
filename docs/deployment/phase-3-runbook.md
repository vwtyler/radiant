# Phase 3 Runbook - Data Model and Admin Workflow

Phase 3 sets up Directus collections, relations, and seed data using Creek APIs as source of truth.

## Implemented collections

- `djs`
- `shows`
- `schedule_slots`
- `schedule_overrides`
- `playlist_tracks`
- `show_djs`

## Implemented relations

- `schedule_slots.show` -> `shows`
- `schedule_overrides.show` -> `shows`
- `playlist_tracks.show` -> `shows`

## Seed source endpoints

- Shows: `https://kaadlp.studio.creek.org/api/shows`
- Schedule occurrences: `https://embed.creek.org/api/studio/schedule?studioId=28`
- Host attribution page: `https://kaad.creek.fm/shows/schedule`

## Seed command

```bash
python3 scripts/phase3_seed_directus.py
```

## What the seed does

- Creates/updates schema and fields if missing.
- Upserts shows from Creek `api/shows` by `source_show_id`.
- Creates missing shows that appear only in schedule occurrences.
- Builds recurring `schedule_slots` baseline from most common show per weekday/time block.
- Creates `schedule_overrides` for alternating/special occurrences (`specialRule` and non-baseline slots).
- Parses host/profile links from `kaad.creek.fm` schedule page and seeds `djs` + `show_djs` links.

## Current expected results

- Shows seeded: `71`
- DJs seeded: `18`
- Show-DJ links seeded: `21`
- Schedule slots: `92`
- Schedule overrides: `17`

## Notes and caveats

- Creek `api/shows` payload currently has no show-to-DJ user data (`users` arrays are empty), so host mapping is sourced from `kaad.creek.fm/shows/schedule`.
- Alternating and monthly programming is represented as `schedule_overrides` so the weekly baseline remains stable.
- Re-running the seed is safe and idempotent for shows; schedule slots/overrides are rebuilt from source each run.
