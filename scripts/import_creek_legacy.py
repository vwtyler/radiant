#!/usr/bin/env python3

"""Legacy migration importer from Creek APIs into Directus.

This script is intended for one-time bootstrap/migration work only.
Radiant's ongoing source of truth is Directus-managed data.
"""

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from html import unescape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def read_env(path):
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = read_env(ENV_PATH)

DIRECTUS_BASE = ENV.get("ADMIN_PUBLIC_URL", "http://127.0.0.1:1337")
if DIRECTUS_BASE.startswith("https://"):
    DIRECTUS_BASE = "http://127.0.0.1:1337"


def api_request(method, path, token=None, payload=None, query=None):
    url = DIRECTUS_BASE + path
    if query:
        url = url + "?" + urllib.parse.urlencode(query, doseq=True)
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            if not body:
                return resp.status, {}
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body}
        return err.code, parsed


def login():
    email = ENV["DIRECTUS_ADMIN_EMAIL"]
    password = ENV["DIRECTUS_ADMIN_PASSWORD"]
    status, out = api_request("POST", "/auth/login", payload={"email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"Directus login failed ({status}): {out}")
    data = out.get("data", {}) if isinstance(out, dict) else {}
    token = data.get("access_token") if isinstance(data, dict) else None
    if not token:
        raise RuntimeError(f"Directus login missing token: {out}")
    return token


def slugify(value):
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"(^-|-$)", "", value)
    return value or "untitled"


def classify_show_type(title):
    t = title.lower()
    talk_words = [
        "democracy now",
        "book talk",
        "scribe",
        "storytellers",
        "children",
        "double takes",
        "cheese loves wine",
        "garden gate",
        "talk",
    ]
    mixed_words = ["music talks", "specials"]
    if any(w in t for w in mixed_words):
        return "mixed"
    if any(w in t for w in talk_words):
        return "talk"
    return "music"


def ensure_collection(token, collection, icon, note):
    status, _ = api_request("GET", f"/collections/{collection}", token=token)
    if status == 200:
        return
    payload = {
        "collection": collection,
        "meta": {
            "icon": icon,
            "note": note,
            "hidden": False,
            "singleton": False,
        },
        "schema": {"name": collection},
    }
    status, out = api_request("POST", "/collections", token=token, payload=payload)
    if status != 200:
        raise RuntimeError(f"Failed creating collection {collection}: {status} {out}")


def ensure_field(token, collection, field, ftype, interface=None, display=None, required=False, schema=None):
    status, _ = api_request("GET", f"/fields/{collection}/{field}", token=token)
    if status == 200:
        return
    meta = {}
    if interface:
        meta["interface"] = interface
    if display:
        meta["display"] = display
    if required:
        meta["required"] = True
    payload = {
        "field": field,
        "type": ftype,
        "meta": meta,
    }
    if schema:
        payload["schema"] = schema
    status, out = api_request("POST", f"/fields/{collection}", token=token, payload=payload)
    if status != 200:
        raise RuntimeError(f"Failed creating field {collection}.{field}: {status} {out}")


def ensure_relation(token, collection, field, related_collection):
    payload = {
        "collection": collection,
        "field": field,
        "related_collection": related_collection,
        "schema": {"on_delete": "SET NULL"},
        "meta": {
            "many_collection": collection,
            "many_field": field,
            "one_collection": related_collection,
            "one_deselect_action": "nullify",
        },
    }
    status, out = api_request("POST", "/relations", token=token, payload=payload)
    if status in (200, 201):
        return
    message = json.dumps(out)
    if "already exists" in message.lower() or "duplicate" in message.lower():
        return
    if status == 400 and "INVALID_PAYLOAD" in message and "already" in message.lower():
        return
    raise RuntimeError(f"Failed creating relation {collection}.{field}: {status} {out}")


def ensure_schema(token):
    ensure_collection(token, "djs", "person", "Radio DJs and hosts")
    ensure_collection(token, "shows", "podcasts", "Radio programs")
    ensure_collection(token, "schedule_slots", "calendar_month", "Recurring weekly schedule")
    ensure_collection(token, "schedule_overrides", "event_repeat", "Date-specific overrides")
    ensure_collection(token, "playlist_tracks", "queue_music", "Recognized songs history")
    ensure_collection(token, "show_djs", "link", "Show to DJ mapping")

    ensure_field(token, "djs", "name", "string", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "djs", "slug", "string", "input", required=True, schema={"is_nullable": False, "is_unique": True})
    ensure_field(token, "djs", "bio", "text", "input-multiline")
    ensure_field(token, "djs", "image_url", "string", "input")
    ensure_field(token, "djs", "links", "json", "input-code")
    ensure_field(token, "djs", "roles", "json", "tags")
    ensure_field(token, "djs", "is_active", "boolean", "boolean", schema={"is_nullable": False, "default_value": True})

    ensure_field(token, "shows", "title", "string", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "shows", "slug", "string", "input", required=True, schema={"is_nullable": False, "is_unique": True})
    ensure_field(token, "shows", "description", "text", "input-multiline")
    ensure_field(token, "shows", "artwork_url", "string", "input")
    ensure_field(token, "shows", "show_type", "string", "select-dropdown", required=True, schema={"is_nullable": False, "default_value": "music"})
    ensure_field(token, "shows", "source_show_id", "integer", "input", schema={"is_nullable": True, "is_unique": True})
    ensure_field(token, "shows", "is_active", "boolean", "boolean", schema={"is_nullable": False, "default_value": True})

    ensure_field(token, "schedule_slots", "slot_key", "string", "input", required=True, schema={"is_nullable": False, "is_unique": True})
    ensure_field(token, "schedule_slots", "weekday", "integer", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_slots", "start_time", "string", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_slots", "end_time", "string", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_slots", "timezone", "string", "input", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_slots", "show", "integer", "select-dropdown-m2o")
    ensure_field(token, "schedule_slots", "source_time_id", "integer", "input")
    ensure_field(token, "schedule_slots", "special_rule", "string", "input")
    ensure_field(token, "schedule_slots", "is_active", "boolean", "boolean", schema={"is_nullable": False, "default_value": True})

    ensure_field(token, "schedule_overrides", "start_at", "timestamp", "datetime", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_overrides", "end_at", "timestamp", "datetime", required=True, schema={"is_nullable": False})
    ensure_field(token, "schedule_overrides", "override_type", "string", "select-dropdown", required=True, schema={"is_nullable": False, "default_value": "replacement"})
    ensure_field(token, "schedule_overrides", "show", "integer", "select-dropdown-m2o")
    ensure_field(token, "schedule_overrides", "note", "text", "input-multiline")
    ensure_field(token, "schedule_overrides", "priority", "integer", "input", schema={"is_nullable": False, "default_value": 100})
    ensure_field(token, "schedule_overrides", "source_time_id", "integer", "input")
    ensure_field(token, "schedule_overrides", "is_active", "boolean", "boolean", schema={"is_nullable": False, "default_value": True})

    ensure_field(token, "playlist_tracks", "played_at", "timestamp", "datetime")
    ensure_field(token, "playlist_tracks", "artist", "string", "input")
    ensure_field(token, "playlist_tracks", "title", "string", "input")
    ensure_field(token, "playlist_tracks", "album", "string", "input")
    ensure_field(token, "playlist_tracks", "artwork_url", "string", "input")
    ensure_field(token, "playlist_tracks", "confidence", "float", "input")
    ensure_field(token, "playlist_tracks", "provider", "string", "input")
    ensure_field(token, "playlist_tracks", "provider_ref", "string", "input")
    ensure_field(token, "playlist_tracks", "show", "integer", "select-dropdown-m2o")

    ensure_field(token, "show_djs", "show", "integer", "select-dropdown-m2o", required=True, schema={"is_nullable": False})
    ensure_field(token, "show_djs", "dj", "integer", "select-dropdown-m2o", required=True, schema={"is_nullable": False})
    ensure_field(token, "show_djs", "role", "string", "input")

    ensure_relation(token, "schedule_slots", "show", "shows")
    ensure_relation(token, "schedule_overrides", "show", "shows")
    ensure_relation(token, "playlist_tracks", "show", "shows")
    ensure_relation(token, "show_djs", "show", "shows")
    ensure_relation(token, "show_djs", "dj", "djs")


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def fetch_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read().decode("utf-8", errors="replace")


def get_items(token, collection, fields=None):
    all_items = []
    offset = 0
    while True:
        query = {"limit": 200, "offset": offset}
        if fields:
            query["fields"] = fields
        status, out = api_request("GET", f"/items/{collection}", token=token, query=query)
        if status != 200:
            raise RuntimeError(f"Failed listing {collection}: {status} {out}")
        rows = out.get("data", [])
        all_items.extend(rows)
        if len(rows) < 200:
            break
        offset += 200
    return all_items


def clear_collection(token, collection):
    rows = get_items(token, collection, fields=["id"])
    for row in rows:
        row_id = row.get("id")
        if row_id is None:
            continue
        api_request("DELETE", f"/items/{collection}/{row_id}", token=token)


def seed_shows(token, shows_payload):
    existing = get_items(token, "shows", fields=["id", "source_show_id", "slug"])
    by_source = {row.get("source_show_id"): row for row in existing if row.get("source_show_id") is not None}

    source_to_directus = {}
    created = 0
    updated = 0

    for show in shows_payload["data"]:
        src_id = show["id"]
        slug = show.get("name") or slugify(show["title"])
        image = show.get("image") or {}
        description = (show.get("summary") or "").strip() or (show.get("description") or "").strip()
        payload = {
            "title": show["title"],
            "slug": slug,
            "description": description,
            "artwork_url": image.get("url"),
            "show_type": classify_show_type(show["title"]),
            "source_show_id": src_id,
            "is_active": not show.get("is_retired", False),
        }

        if src_id in by_source:
            directus_id = by_source[src_id]["id"]
            status, out = api_request("PATCH", f"/items/shows/{directus_id}", token=token, payload=payload)
            if status == 400 and "RECORD_NOT_UNIQUE" in json.dumps(out):
                payload["slug"] = f"{slug}-{src_id}"
                status, out = api_request("PATCH", f"/items/shows/{directus_id}", token=token, payload=payload)
            if status != 200:
                raise RuntimeError(f"Failed updating show {show['title']}: {status} {out}")
            updated += 1
            source_to_directus[src_id] = directus_id
        else:
            status, out = api_request("POST", "/items/shows", token=token, payload=payload)
            if status == 400 and "RECORD_NOT_UNIQUE" in json.dumps(out):
                payload["slug"] = f"{slug}-{src_id}"
                status, out = api_request("POST", "/items/shows", token=token, payload=payload)
            if status != 200:
                raise RuntimeError(f"Failed creating show {show['title']}: {status} {out}")
            created += 1
            new_data = out.get("data", {}) if isinstance(out, dict) else {}
            new_id = new_data.get("id") if isinstance(new_data, dict) else None
            if new_id is None:
                raise RuntimeError(f"Show create succeeded but no id returned for {show['title']}: {out}")
            source_to_directus[src_id] = new_id

    return source_to_directus, created, updated


def seed_missing_schedule_shows(token, source_to_directus, schedule_occurrences):
    created = 0

    def find_existing(filter_key, filter_value):
        status, out = api_request(
            "GET",
            "/items/shows",
            token=token,
            query={f"filter[{filter_key}][_eq]": filter_value, "fields": ["id", "source_show_id", "slug"], "limit": 1},
        )
        if status != 200:
            return None
        rows = out.get("data", []) if isinstance(out, dict) else []
        if not rows:
            return None
        row = rows[0]
        if isinstance(row, dict):
            return row.get("id")
        return None

    for occ in schedule_occurrences:
        show = occ.get("time", {}).get("show", {})
        src_id = show.get("id")
        if src_id is None or src_id in source_to_directus:
            continue
        title = show.get("title") or f"Show {src_id}"
        slug_base = show.get("name") or slugify(title)
        payload = {
            "title": title,
            "slug": slug_base,
            "description": (show.get("summary") or "").strip(),
            "artwork_url": (show.get("image") or {}).get("url"),
            "show_type": classify_show_type(title),
            "source_show_id": src_id,
            "is_active": not show.get("is_retired", False),
        }
        status, out = api_request("POST", "/items/shows", token=token, payload=payload)
        if status == 400 and "source_show_id" in json.dumps(out):
            existing_id = find_existing("source_show_id", src_id)
            if existing_id is not None:
                source_to_directus[src_id] = existing_id
                continue
        if status == 400 and "RECORD_NOT_UNIQUE" in json.dumps(out):
            payload["slug"] = f"{slug_base}-{src_id}"
            status, out = api_request("POST", "/items/shows", token=token, payload=payload)
        if status == 400 and "RECORD_NOT_UNIQUE" in json.dumps(out):
            existing_id = find_existing("source_show_id", src_id)
            if existing_id is None:
                existing_id = find_existing("slug", payload.get("slug"))
            if existing_id is not None:
                source_to_directus[src_id] = existing_id
                continue
        if status == 400 and "source_show_id" in json.dumps(out):
            existing_id = find_existing("source_show_id", src_id)
            if existing_id is not None:
                source_to_directus[src_id] = existing_id
                continue
        if status != 200:
            raise RuntimeError(f"Failed creating missing schedule show {title}: {status} {out}")
        data = out.get("data", {}) if isinstance(out, dict) else {}
        show_id = data.get("id") if isinstance(data, dict) else None
        if show_id is None:
            raise RuntimeError(f"Missing id for created schedule show {title}: {out}")
        source_to_directus[src_id] = show_id
        created += 1
    return created


def build_schedule(schedule_occurrences):
    groups = defaultdict(list)
    for occ in schedule_occurrences:
        key = (
            occ.get("localWeekdayNum"),
            occ.get("startTimeString"),
            occ.get("endTimeString"),
            occ.get("time", {}).get("timezone") or "America/Los_Angeles",
        )
        groups[key].append(occ)

    slots = []
    overrides = []

    for key, occurrences in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1])):
        weekday, start_time, end_time, timezone = key
        show_counter = Counter()
        for occ in occurrences:
            show_id = occ.get("time", {}).get("show", {}).get("id")
            if show_id is not None:
                show_counter[show_id] += 1
        if not show_counter:
            continue
        baseline_show_id, _ = sorted(show_counter.items(), key=lambda x: (-x[1], x[0]))[0]

        source_time_ids = [o.get("time", {}).get("id") for o in occurrences if o.get("time", {}).get("id") is not None]
        slot = {
            "slot_key": f"{weekday}-{start_time}-{end_time}",
            "weekday": weekday,
            "start_time": start_time,
            "end_time": end_time,
            "timezone": timezone,
            "source_time_id": source_time_ids[0] if source_time_ids else None,
            "special_rule": None,
            "source_show_id": baseline_show_id,
            "is_active": True,
        }
        slots.append(slot)

        for occ in occurrences:
            show_id = occ.get("time", {}).get("show", {}).get("id")
            special_rule = occ.get("specialRule")
            is_override = (show_id != baseline_show_id) or (special_rule is not None)
            if not is_override:
                continue
            note_parts = []
            if special_rule:
                note_parts.append(f"special_rule={special_rule}")
            note_parts.append("seeded from Creek schedule occurrence")
            overrides.append(
                {
                    "start_at": occ.get("startDate"),
                    "end_at": occ.get("endDate"),
                    "override_type": "replacement",
                    "priority": 100,
                    "source_time_id": occ.get("time", {}).get("id"),
                    "source_show_id": show_id,
                    "note": "; ".join(note_parts),
                    "is_active": True,
                }
            )

    return slots, overrides


def seed_schedule(token, source_to_directus, slots, overrides):
    clear_collection(token, "schedule_overrides")
    clear_collection(token, "schedule_slots")

    slot_created = 0
    for slot in slots:
        show_fk = source_to_directus.get(slot.pop("source_show_id"))
        payload = dict(slot)
        payload["show"] = show_fk
        status, out = api_request("POST", "/items/schedule_slots", token=token, payload=payload)
        if status != 200:
            raise RuntimeError(f"Failed creating schedule slot {slot['slot_key']}: {status} {out}")
        slot_created += 1

    override_created = 0
    for ov in overrides:
        show_fk = source_to_directus.get(ov.pop("source_show_id"))
        payload = dict(ov)
        payload["show"] = show_fk
        status, out = api_request("POST", "/items/schedule_overrides", token=token, payload=payload)
        if status != 200:
            raise RuntimeError(f"Failed creating schedule override {ov['start_at']}: {status} {out}")
        override_created += 1

    return slot_created, override_created


def parse_schedule_hosts(schedule_html):
    mappings = defaultdict(set)
    block_pattern = re.compile(r"<td[^>]*class=\"[^\"]*cell-program[^\"]*\"[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
    show_link_pattern = re.compile(r'href="/shows/([^"#?]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
    host_link_pattern = re.compile(r'href="/profiles/([^"#?]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)

    for block in block_pattern.findall(schedule_html):
        show_hits = show_link_pattern.findall(block)
        host_hits = host_link_pattern.findall(block)
        if not show_hits or not host_hits:
            continue

        show_slugs = []
        for slug, _title in show_hits:
            s = slug.strip().strip("/")
            if s and s not in show_slugs:
                show_slugs.append(s)

        for _profile_slug, host_name in host_hits:
            clean = re.sub(r"<[^>]+>", "", host_name)
            clean = unescape(clean).strip()
            if not clean:
                continue
            if clean.lower() == "prx":
                continue
            for show_slug in show_slugs:
                mappings[show_slug].add(clean)

    return mappings


def seed_djs_and_links(token, schedule_host_map):
    existing_djs = get_items(token, "djs", fields=["id", "slug", "name"])
    dj_by_slug = {row.get("slug"): row for row in existing_djs if row.get("slug")}

    shows = get_items(token, "shows", fields=["id", "slug", "title"])
    show_by_slug = {row.get("slug"): row for row in shows if row.get("slug")}

    dj_created = 0
    dj_updated = 0
    unresolved_show_slugs = []

    def ensure_dj(name):
        nonlocal dj_created, dj_updated
        slug = slugify(name)
        row = dj_by_slug.get(slug)
        payload = {
            "name": name,
            "slug": slug,
            "is_active": True,
            "roles": ["host"],
        }
        if row:
            status, out = api_request("PATCH", f"/items/djs/{row['id']}", token=token, payload=payload)
            if status != 200:
                raise RuntimeError(f"Failed updating DJ {name}: {status} {out}")
            dj_updated += 1
            return row["id"]
        status, out = api_request("POST", "/items/djs", token=token, payload=payload)
        if status == 400 and "RECORD_NOT_UNIQUE" in json.dumps(out):
            payload["slug"] = f"{slug}-host"
            status, out = api_request("POST", "/items/djs", token=token, payload=payload)
        if status != 200:
            raise RuntimeError(f"Failed creating DJ {name}: {status} {out}")
        data = out.get("data", {}) if isinstance(out, dict) else {}
        dj_id = data.get("id") if isinstance(data, dict) else None
        if dj_id is None:
            raise RuntimeError(f"Missing id for created DJ {name}: {out}")
        dj_by_slug[payload["slug"]] = {"id": dj_id, "slug": payload["slug"], "name": name}
        dj_created += 1
        return dj_id

    clear_collection(token, "show_djs")

    links_created = 0
    for show_slug, host_names in schedule_host_map.items():
        show = show_by_slug.get(show_slug)
        if not show:
            unresolved_show_slugs.append(show_slug)
            continue
        for host_name in sorted(host_names):
            dj_id = ensure_dj(host_name)
            payload = {"show": show["id"], "dj": dj_id, "role": "host"}
            status, out = api_request("POST", "/items/show_djs", token=token, payload=payload)
            if status != 200:
                raise RuntimeError(f"Failed creating show_dj link {show_slug}->{host_name}: {status} {out}")
            links_created += 1

    return {
        "dj_created": dj_created,
        "dj_updated": dj_updated,
        "show_dj_links_created": links_created,
        "unresolved_show_slugs": sorted(set(unresolved_show_slugs)),
    }


def main():
    token = login()
    ensure_schema(token)

    shows_payload = fetch_json("https://kaadlp.studio.creek.org/api/shows")
    schedule_occurrences = fetch_json("https://embed.creek.org/api/studio/schedule?studioId=28")
    schedule_html = fetch_text("https://kaad.creek.fm/shows/schedule")

    source_to_directus, shows_created, shows_updated = seed_shows(token, shows_payload)
    missing_shows_created = seed_missing_schedule_shows(token, source_to_directus, schedule_occurrences)
    slots, overrides = build_schedule(schedule_occurrences)
    slot_count, override_count = seed_schedule(token, source_to_directus, slots, overrides)
    schedule_host_map = parse_schedule_hosts(schedule_html)
    dj_stats = seed_djs_and_links(token, schedule_host_map)

    print("Phase 3 seed complete")
    print(f"shows_created={shows_created}")
    print(f"shows_updated={shows_updated}")
    print(f"shows_created_from_schedule={missing_shows_created}")
    print(f"schedule_slots={slot_count}")
    print(f"schedule_overrides={override_count}")
    print(f"djs_created={dj_stats['dj_created']}")
    print(f"djs_updated={dj_stats['dj_updated']}")
    print(f"show_dj_links_created={dj_stats['show_dj_links_created']}")
    print(f"unresolved_show_slug_count={len(dj_stats['unresolved_show_slugs'])}")
    if dj_stats["unresolved_show_slugs"]:
        print("unresolved_show_slugs=" + ",".join(dj_stats["unresolved_show_slugs"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
