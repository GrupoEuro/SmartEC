#!/usr/bin/env python3
"""
migrate_warehouse_collections.py

Migrates existing Firestore data from 6 root-level warehouse collections
to subcollections under warehouses/{warehouseId}/.

Migration map:
  warehouse_zones          → warehouses/{warehouseId}/zones
  warehouse_structures     → warehouses/{warehouseId}/structures
  warehouse_locations      → warehouses/{warehouseId}/locations
  warehouse_obstacles      → warehouses/{warehouseId}/obstacles
  warehouse_doors          → warehouses/{warehouseId}/doors
  warehouse_scale_markers  → warehouses/{warehouseId}/scaleMarkers

Uses the Firebase CLI token (no service account file needed).
"""

import json, subprocess, urllib.request, urllib.error, sys, time

# ── Config ────────────────────────────────────────────────────────────────────

PROJECT = "tiendapraxis"
BASE    = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

# Get auth token from firebase-tools config
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
    ('warehouse_zones',         'zones'),
    ('warehouse_structures',    'structures'),
    ('warehouse_locations',     'locations'),
    ('warehouse_obstacles',     'obstacles'),
    ('warehouse_doors',         'doors'),
    ('warehouse_scale_markers', 'scaleMarkers'),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def fs_get(path):
    """GET a Firestore document or collection."""
    url = f"{BASE}/{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return None

def fs_list(collection):
    """List all documents in a collection (handles pagination)."""
    docs = []
    page_token = None
    while True:
        url = f"{BASE}/{collection}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {TOKEN}")
        try:
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            print(f"   ❌ list error: {e.code} {e.read().decode()[:200]}")
            break
        for doc in data.get('documents', []):
            docs.append(doc)
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return docs

def extract_string_field(fields, key):
    """Extract a string value from Firestore field map."""
    field = fields.get(key, {})
    return field.get('stringValue') or field.get('referenceValue', '').split('/')[-1] or None

def fs_patch(path, body):
    """Write/overwrite a Firestore document."""
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
    """Delete a Firestore document."""
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

print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Warehouse Collection Migration")
print("=" * 65)
print(f"Project: {PROJECT}")
print()

total_migrated = 0
total_deleted  = 0
total_skipped  = 0

for (old_coll, sub_name) in MIGRATIONS:
    print(f"→ {old_coll}  →  warehouses/{{warehouseId}}/{sub_name}")
    docs = fs_list(old_coll)

    if not docs:
        print(f"   (empty — nothing to migrate)\n")
        continue

    print(f"   {len(docs)} documents found")
    migrated = 0
    skipped  = 0

    for doc in docs:
        # Extract document ID from the full resource name
        doc_id = doc['name'].split('/')[-1]
        fields = doc.get('fields', {})

        # Get warehouseId from the document fields
        warehouse_id = extract_string_field(fields, 'warehouseId')
        if not warehouse_id:
            print(f"   ⚠  '{doc_id}' has no warehouseId field — skipping")
            skipped += 1
            continue

        new_path = f"warehouses/{warehouse_id}/{sub_name}/{doc_id}"
        old_path = f"{old_coll}/{doc_id}"

        if DRY_RUN:
            print(f"   [DRY] {old_path}  →  {new_path}")
            migrated += 1
            continue

        # Write to new location (preserve all fields exactly)
        write_ok = fs_patch(new_path, {"fields": fields})
        if not write_ok:
            skipped += 1
            continue

        # Delete old document
        fs_delete(old_path)
        migrated += 1

        # Small delay to avoid rate limits on large collections
        if migrated % 50 == 0:
            print(f"   ... {migrated}/{len(docs)} processed")
            time.sleep(0.3)

    total_migrated += migrated
    total_skipped  += skipped
    if DRY_RUN:
        print(f"   [DRY] Would migrate {migrated} docs")
    else:
        print(f"   ✓ Migrated: {migrated}  |  Skipped: {skipped}")
    print()

# ── Summary ───────────────────────────────────────────────────────────────────

print("=" * 65)
if DRY_RUN:
    print(f"DRY RUN complete — no data was changed.")
    print(f"  Would migrate: {total_migrated} documents")
else:
    print(f"Migration complete.")
    print(f"  Documents migrated : {total_migrated}")
    print(f"  Documents skipped  : {total_skipped}")
print("=" * 65)
