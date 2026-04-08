#!/usr/bin/env python3
import json, subprocess, urllib.request

result = subprocess.run(
    ["python3", "-c",
     "import json; d=json.load(open('/Users/SaulFigueroa/.config/configstore/firebase-tools.json')); print(d['tokens']['access_token'])"],
    capture_output=True, text=True
)
TOKEN = result.stdout.strip()

req = urllib.request.Request(
    "https://firestore.googleapis.com/v1/projects/tiendapraxis/databases/(default)/documents/products?pageSize=300"
)
req.add_header("Authorization", f"Bearer {TOKEN}")
data = json.loads(urllib.request.urlopen(req).read())

for doc in data.get("documents", []):
    f = doc.get("fields", {})
    active = f.get("active", {}).get("booleanValue", None)
    pub    = f.get("publishStatus", {}).get("stringValue", "")
    if active is False or pub != "published":
        continue
    slug = f.get("slug", {}).get("stringValue", "")
    name = f.get("name", {}).get("mapValue", {}).get("fields", {}).get("es", {}).get("stringValue", "")
    print(f"{slug}\t{name}")
