#!/usr/bin/env python3
"""
migrate_search_collections.py

Migrates existing search_logs and search_clicks documents into the
unified search_events collection with a 'type' discriminator field.

Migration map:
  search_logs/{docId}   → search_events/{docId}  (type = 'query')
  search_clicks/{docId} → search_events/{docId}  (type = 'click')

Uses the Firebase CLI auth token (no service account needed).
Pass --dry-run to preview without writing.
"""

import json, subprocess, urllib.request, urllib.error, sys, time

PROJECT = "tiendapraxis"
BASE    = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

result = subprocess.run(
    ["python3", "-c",
     "import json; d=json.load(open('/Users/SaulFigueroa/.config/configstore/firebase-tools.json')); print(d['tokens']['access_token'])"],
    capture_output=True, text=True
)
TOKEN = result.stdout.strip()
if not TOKEN:
    print("❌ Could not get Firebase auth token. Run: firebase login")
    sys.exit(1)

DRY_RUN = '--dry-run' in sys.argv

MIGRATIONS = [
    ('search_logs',   'query'),
    ('search_clicks', 'click'),
]

# ── REST helpers (same as warehouse migration) ─────────────────────────────────

def fs_list(collection_path):
    docs = []
    page_token = None
    while True:
        url = f"{BASE}/{collection_path}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {TOKEN}")
        try:
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break
            print(f"   ❌ list error: {e.code} {e.read().decode()[:200]}")
            break
        for doc in data.get('documents', []):
            docs.append(doc)
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return docs

def fs_patch(path, body):
    url = f"{BASE}/{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="PATCH")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"   ❌ write error at {path}: {e.code} {e.read().decode()[:300]}")
        return False

def fs_delete(path):
    url = f"{BASE}/{path}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"   ❌ delete error at {path}: {e.code} {e.read().decode()[:200]}")
        return False

# ── Main ──────────────────────────────────────────────────────────────────────

print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Search Collections Migration")
print("=" * 65)

total_migrated = 0

for (old_coll, event_type) in MIGRATIONS:
    print(f"\n→ {old_coll}  →  search_events  (type='{event_type}')")
    docs = fs_list(old_coll)

    if not docs:
        print(f"   (empty — nothing to migrate)")
        continue

    print(f"   {len(docs)} documents found")
    migrated = 0

    for doc in docs:
        doc_id = doc['name'].split('/')[-1]
        fields = doc.get('fields', {})

        # Add the 'type' discriminator field
        new_fields = dict(fields)
        new_fields['type'] = {"stringValue": event_type}

        new_path = f"search_events/{doc_id}"
        old_path = f"{old_coll}/{doc_id}"

        if DRY_RUN:
            print(f"   [DRY] {old_path}  →  {new_path}  (type={event_type})")
            migrated += 1
            continue

        write_ok = fs_patch(new_path, {"fields": new_fields})
        if not write_ok:
            continue

        fs_delete(old_path)
        migrated += 1

        if migrated % 50 == 0:
            print(f"   ... {migrated}/{len(docs)} processed")
            time.sleep(0.2)

    total_migrated += migrated
    if DRY_RUN:
        print(f"   [DRY] Would migrate {migrated} docs")
    else:
        print(f"   ✓ Migrated: {migrated}")

print("\n" + "=" * 65)
if DRY_RUN:
    print(f"DRY RUN — no data changed. Would migrate: {total_migrated} docs")
else:
    print(f"Migration complete. Total migrated: {total_migrated}")
print("=" * 65)
