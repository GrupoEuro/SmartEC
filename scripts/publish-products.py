#!/usr/bin/env python3
"""Bulk-publish all active non-draft products in Firestore."""
import json, urllib.request, urllib.error, subprocess

# Get token from firebase-tools config
result = subprocess.run(
    ["python3", "-c",
     "import json; d=json.load(open('/Users/SaulFigueroa/.config/configstore/firebase-tools.json')); print(d['tokens']['access_token'])"],
    capture_output=True, text=True
)
TOKEN = result.stdout.strip()
if not TOKEN:
    print("ERROR: No token found"); exit(1)

BASE = "https://firestore.googleapis.com/v1/projects/tiendapraxis/databases/(default)"

def get(url):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    return json.loads(urllib.request.urlopen(req).read())

def patch(doc_name, fields_dict):
    field_mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields_dict)
    url = f"https://firestore.googleapis.com/v1/{doc_name}?{field_mask}"
    body = json.dumps({"fields": fields_dict}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    urllib.request.urlopen(req)

# Fetch all products
data = get(f"{BASE}/documents/products?pageSize=300")
docs = data.get("documents", [])
print(f"Total docs: {len(docs)}\n")

published = 0
skipped   = 0
already   = 0

for doc in docs:
    name   = doc["name"]
    fields = doc.get("fields", {})

    sku    = fields.get("sku",           {}).get("stringValue", "NO-SKU")
    active = fields.get("active",        {}).get("booleanValue", None)  # None = field missing
    pub    = fields.get("publishStatus", {}).get("stringValue", "MISSING")

    # Skip explicitly inactive (test products we just deactivated)
    if active is False:
        skipped += 1
        continue

    if pub == "published":
        print(f"  → Already published: {sku}")
        already += 1
        continue

    # Publish it
    try:
        patch(name, {"publishStatus": {"stringValue": "published"}})
        print(f"  ✓ Published: {sku}")
        published += 1
    except urllib.error.HTTPError as e:
        print(f"  ✗ FAILED {sku}: {e.read().decode()[:120]}")

print(f"\n=== DONE ===")
print(f"  Published now : {published}")
print(f"  Already live  : {already}")
print(f"  Skipped (inactive): {skipped}")
