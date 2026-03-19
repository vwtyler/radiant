# Alternating Schedule Plan

## Goal

Make alternating shows date-aware and deterministic so `now-playing` and schedule APIs always resolve the correct show for the correct day.

## Current gap

- Admin UI currently uses `slot_key` metadata (`altgrp:`) for display/conflict handling only.
- API live resolver does not evaluate alternating groups.
- When two same-time slots exist, selection can be order-based rather than date-based.

## Proposed approach

Treat alternating assignments as a first-class scheduling rule and materialize date-specific outcomes into `schedule_overrides`.

- Keep weekly slots as baseline structure.
- Generate dated overrides from alternation rules.
- Continue using override precedence in resolver (`resolveLiveSchedule`) so date-specific winner is explicit.

## Data model

Add `schedule_alternations` with fields similar to:

- `group_key`
- `weekday`, `start_time`, `end_time`, `timezone`
- `rule_type` (start with `weekly_alternate`)
- `anchor_date_local` (rotation start)
- roster/phase order (Show A, Show B, etc.)
- optional `active_from`, `active_to`

## Resolver behavior

- `resolveLiveSchedule` remains override-first.
- For alternating windows, generated overrides determine the active show for a date.
- `/v1/now-playing` and `/v1/schedule` inherit correct date-specific show through existing override logic.

## Generation lifecycle

- On alternation create/update/delete:
  - regenerate overrides for a rolling horizon (e.g. 180 days).
- Scheduled roll-forward task:
  - extend future overrides nightly/weekly.
- Use idempotent keys to avoid duplicate overrides.

## Admin UX changes

- Replace implicit `altgrp` textbox with an Alternation Rule editor:
  - participating shows
  - anchor date
  - cadence
  - preview of upcoming dates
- Keep visual side-by-side schedule rendering as a UI aid only.

## Migration plan

For existing `altgrp:` usage:

- detect paired alternating slots in same weekday/time window
- prompt for anchor date
- create alternation rule
- generate dated overrides
- preserve legacy slot records for audit/back-compat until cleanup phase

## Validation and tests

- Unit tests:
  - weekly rotation correctness
  - DST/timezone boundaries
  - midnight/end-of-day handling
- Integration tests:
  - `/v1/now-playing` resolves correct show on alternating weeks
  - `/v1/schedule` output matches generated override pattern

## Decision to lock first

Recommended initial cadence:

- every-other-week rotation anchored to local `anchor_date_local`
- anchor week = phase A, following week = phase B, then repeat

Future extensions can add:

- custom cycle lengths
- monthly patterns (e.g. 1st/3rd Mondays)
- holiday exceptions
