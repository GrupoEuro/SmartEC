#!/usr/bin/env python3
import json, subprocess, urllib.request, math

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
docs = data.get("documents", [])

def market_price(price):
    """Psychologically appealing price — always >= actual, ends in .99 or .95"""
    if price < 200:
        m = math.ceil(price / 10) * 10 - 0.01
    elif price < 600:
        m = math.ceil(price / 50) * 50 - 0.01
    elif price < 1500:
        m = math.ceil(price / 100) * 100 - 0.01
    else:
        m = math.ceil(price / 200) * 200 - 0.01
    return round(max(m, price), 2)  # never less than actual

products = []
for doc in docs:
    f = doc.get("fields", {})
    active = f.get("active", {}).get("booleanValue", None)
    pub    = f.get("publishStatus", {}).get("stringValue", "")
    if active is False or pub != "published":
        continue

    sku     = f.get("sku", {}).get("stringValue", "")
    price_v = f.get("price", {})
    price   = float(price_v.get("doubleValue", 0) or price_v.get("integerValue", 0))
    name_f  = f.get("name", {}).get("mapValue", {}).get("fields", {})
    desc_f  = f.get("description", {}).get("mapValue", {}).get("fields", {})
    name_es = name_f.get("es", {}).get("stringValue", "Sin nombre")
    desc_es = desc_f.get("es", {}).get("stringValue", "—")

    mkt = market_price(price)
    uplift = round((mkt - price) / price * 100, 1) if price > 0 else 0
    products.append((sku, name_es, desc_es, price, mkt, uplift))

products.sort(key=lambda x: x[3])

print(f"\n{'#':<3} {'SKU':<30} {'Actual':>10} {'Mkt Price':>10} {'Uplift':>7}")
print("=" * 68)
for i, (sku, name, desc, price, mkt, up) in enumerate(products, 1):
    print(f"{i:<3} {sku:<30} ${price:>8.2f}  ${mkt:>8.2f}  +{up:>4.1f}%")
    short_name = name[:70]
    print(f"    Nombre: {short_name}")
    short_desc = desc[:90] if desc != "—" else "—"
    print(f"    Desc:   {short_desc}")
    print()

print(f"Total: {len(products)} productos activos publicados")
