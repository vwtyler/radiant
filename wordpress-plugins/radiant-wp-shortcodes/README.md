# Radiant WP Shortcodes

WordPress plugin that renders data from Radiant API endpoints using shortcodes.

## Included shortcodes

- `[radiant_schedule_grid]` (admin-style read-only scheduler)
- `[radiant_current_show]`
- `[radiant_now_playing]` (alias of current show)
- `[radiant_schedule_day]`
- `[radiant_schedule_week]`
- `[radiant_playlist_recent]`

All shortcodes work with defaults. Attributes are optional.

## Optional attributes

- `radiant_schedule_grid`
  - `view="week"` (`week` or `day`, default `week`)
  - `tz="America/Los_Angeles"`
  - `show_toggle="1"`
  - `show_live="1"`
- `radiant_current_show`
  - `tz="America/Los_Angeles"`
  - `show_track="1"`
  - `show_artwork="0"`
- `radiant_schedule_day`
  - `day="today"` (`today`, weekday name, or 1-7)
  - `tz="America/Los_Angeles"`
  - `show_overrides="1"`
- `radiant_schedule_week`
  - `tz="America/Los_Angeles"`
  - `show_empty="1"`
- `radiant_playlist_recent`
  - `limit="10"`

## Setup

1. Install and activate plugin.
2. Go to `Settings -> Radiant`.
3. Set `API Base URL` (for example: `https://api.kaad-lp.org`).
4. Save settings.

## Notes

- Data is cached via WP transients (`Cache TTL` in settings).
- Default plugin CSS can be disabled in settings if you want full theme control.
- `radiant_schedule_grid` is read-only and includes click-through modal details (show, DJs, recent airings, and per-airing playlists).
