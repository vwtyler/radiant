# Creek Legacy Import (Optional)

This project no longer treats Creek as an ongoing dependency.

Use the importer only for one-time migration/bootstrap from legacy data.

## Purpose

- Pull shows/schedule data from existing JSON endpoints
- Populate Directus collections for initial transition
- Help stations move off the legacy platform

## Import script

- `scripts/import_creek_legacy.py`

## Usage

```bash
python3 scripts/import_creek_legacy.py
```

The included script is an example importer that currently targets Creek JSON endpoints.
You can adapt it to your own legacy API/JSON source if needed.

## Important notes

- This is a migration utility, not part of normal Radiant operations.
- After migration, Directus is the source of truth.
- Review imported records in Directus before using in production.
