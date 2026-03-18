# Phase 5 Runbook - ACRCloud Ingestion

Phase 5 adds ACRCloud Broadcast Monitoring callback ingestion to `Radiant API`.

## Endpoint added

- `POST /v1/acrcloud/callback` (internal ingestion endpoint)

## Callback security

- Required header: `X-ACR-SECRET`
- API env: `ACRCLOUD_CALLBACK_SECRET`
- Alternative auth (recommended for ACRCloud callbacks): query token `?token=...`
- API env: `ACRCLOUD_CALLBACK_TOKEN`

If callback auth does not match (header or query token), the endpoint returns `401`.

## Environment variables

- `ACRCLOUD_CALLBACK_SECRET`
- `ACRCLOUD_CALLBACK_TOKEN`
- `ACRCLOUD_DEDUPE_SECONDS` (default: `120`)
- `ACRCLOUD_EXPECTED_PROJECT_ID` (set to your stream id, e.g. `s-xxxxxxx`)

## Ingestion behavior

- Accepts BM callback payloads with `data.metadata.music`.
- Uses first music match for ingestion.
- Writes songs only to `playlist_tracks` (never schedule fallback states).
- Maps confidence from ACR score: `score / 100`.
- Applies confidence threshold using existing `NOW_PLAYING_CONFIDENCE_MIN`.
- Deduplicates same artist/title within `ACRCLOUD_DEDUPE_SECONDS`.
- Links show by resolving schedule at callback timestamp.

## Set callback URL in ACRCloud

Set results callback URL to:

- `https://kaad-api.tjackson.me/v1/acrcloud/callback?token=<ACRCLOUD_CALLBACK_TOKEN>`

Recommended BM callback settings:

- `result_callback_result_type = 0` (RealTime)
- `result_callback_send_noresult = 1` if you want explicit no-result notifications (status `0` payloads)

## Local callback smoke test

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/acrcloud/callback \
  -H "Content-Type: application/json" \
  -H "X-ACR-SECRET: $ACRCLOUD_CALLBACK_SECRET" \
  -d '{
    "stream_id": "s-xxxxxxx",
    "data": {
      "metadata": {
        "timestamp_utc": "2026-03-18 06:40:00",
        "music": [
          {
            "title": "Sample Song",
            "score": 98,
            "acrid": "sample-acrid-1",
            "album": {"name": "Sample Album"},
            "artists": [{"name": "Sample Artist"}]
          }
        ]
      }
    }
  }'
```

Then verify:

```bash
curl -sS "http://127.0.0.1:3000/v1/playlist/recent?limit=5"
curl -sS "http://127.0.0.1:3000/v1/now-playing"
```

## Notes

- ACRCloud Console API bearer token should be treated as secret and rotated if exposed.
- No-result callbacks are accepted and logged as no-op with reason `no_music_detected`.
- This phase does not change WordPress-facing endpoint contracts.
