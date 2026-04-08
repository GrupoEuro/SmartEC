#!/usr/bin/env python3
"""
Seed initial tracking config to Firestore config/tracking
with existing GA4 and Clarity IDs already enabled.
All other pixels start disabled until configured in admin.
"""
import json, subprocess, urllib.request, urllib.error

# Get Firebase auth token
result = subprocess.run(
    ["python3", "-c",
     "import json; d=json.load(open('/Users/SaulFigueroa/.config/configstore/firebase-tools.json')); print(d['tokens']['access_token'])"],
    capture_output=True, text=True
)
TOKEN = result.stdout.strip()
PROJECT = "tiendapraxis"

config = {
    "ga4":       { "enabled": True,  "id": "G-DS1P5LCE99" },
    "meta":      { "enabled": False, "id": "" },
    "clarity":   { "enabled": True,  "id": "ur5ya510na" },
    "tiktok":    { "enabled": False, "id": "" },
    "gtm":       { "enabled": False, "id": "" },
    "pinterest": { "enabled": False, "id": "" },
    "snapchat":  { "enabled": False, "id": "" },
    "gads":      { "enabled": False, "id": "" },
    "updatedAt": "2026-04-08T22:30:00Z",
    "updatedBy": "system-seed"
}

def to_firestore_value(v):
    if isinstance(v, bool):  return {"booleanValue": v}
    if isinstance(v, str):   return {"stringValue": v}
    if isinstance(v, dict):  return {"mapValue": {"fields": {k: to_firestore_value(vv) for k, vv in v.items()}}}
    return {"nullValue": None}

fs_fields = {k: to_firestore_value(v) for k, v in config.items()}
body = json.dumps({"fields": fs_fields}).encode()

url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/config/tracking"
req = urllib.request.Request(url, data=body, method="PATCH")
req.add_header("Authorization", f"Bearer {TOKEN}")
req.add_header("Content-Type", "application/json")

try:
    resp = urllib.request.urlopen(req)
    print("✅ config/tracking seeded successfully")
    print(f"   GA4 enabled: G-DS1P5LCE99")
    print(f"   Clarity enabled: ur5ya510na")
    print(f"   All other platforms: disabled (configure in admin /admin/tracking)")
except urllib.error.HTTPError as e:
    print(f"❌ HTTP {e.code}: {e.read().decode()}")
