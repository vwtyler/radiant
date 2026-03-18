# Phase 7 Runbook - WordPress Integration

Phase 7 introduces WordPress-facing integration on top of the existing public Radiant API, starting with shortcode-based rendering.

## Goals delivered in this phase

- WordPress shortcode plugin scaffolded and packaged
- Plugin settings page for API base URL/timezone/cache/CSS toggle
- Default shortcodes for on-air state and schedule blocks
- Importable plugin ZIP artifact for wp-admin upload

## Artifacts

- Plugin source: `wordpress-plugins/radiant-wp-shortcodes/`
- Import ZIP: `dist/radiant-wp-shortcodes.zip`

## Included shortcodes

- `[radiant_current_show]`
- `[radiant_now_playing]`
- `[radiant_schedule_day]`
- `[radiant_schedule_week]`
- `[radiant_playlist_recent]`

## Prerequisites

- `radiant-api` publicly reachable from WordPress host
- Public API CORS includes WordPress origin
- WordPress can install custom plugins (zip upload enabled)

## Install / verify

1. In WordPress Admin: Plugins -> Add New -> Upload Plugin
2. Upload `radiant-wp-shortcodes.zip` and activate
3. Go to Settings -> Radiant
4. Set API Base URL (for example `https://api.<your-domain>`)
5. Add test shortcode to a page: `[radiant_current_show]`
6. Publish and verify output on frontend

## Rollback

- Deactivate plugin in wp-admin
- Remove shortcode blocks from pages if needed
- Existing Radiant API/admin services remain unaffected

## Follow-up scope (not yet complete)

- Additional shortcode/components for show and DJ profiles
- Theme-specific markup modes (minimal/semantic variants)
- Optional server-side auth/session strategy for privileged admin-like embeds
