#!/usr/bin/env python3
"""
Seed blog post to Firestore via REST API using Firebase CLI OAuth tokens.
No service account key needed.
"""

import json, urllib.request, urllib.parse, os, time, sys

HOME = os.path.expanduser("~")
FIREBASE_CONFIG_PATH = f"{HOME}/.config/configstore/firebase-tools.json"
PROJECT_ID = "tiendapraxis"

# ── 1. Get a fresh access token using the stored refresh token ────────────────
with open(FIREBASE_CONFIG_PATH) as f:
    config = json.load(f)

tokens = config['tokens']
refresh_token = tokens['refresh_token']

# Refresh via Google OAuth2
CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
CLIENT_SECRET = "j9iVZfS8kkqWEntmZJbEhFZQ"

data = urllib.parse.urlencode({
    'grant_type': 'refresh_token',
    'refresh_token': refresh_token,
    'client_id': CLIENT_ID,
    'client_secret': CLIENT_SECRET,
}).encode()

req = urllib.request.Request(
    'https://oauth2.googleapis.com/token',
    data=data,
    headers={'Content-Type': 'application/x-www-form-urlencoded'}
)

with urllib.request.urlopen(req) as resp:
    token_data = json.loads(resp.read())

access_token = token_data['access_token']
print(f"✅ Got fresh access token (expires in {token_data.get('expires_in','?')}s)")

# ── 2. Build the blog post Firestore document ─────────────────────────────────
NOW = "2026-05-02T01:00:00Z"

content_html = """
<article>

<p class="article-lead">¿Alguna vez has visto los números <strong>120/70R17</strong> grabados en el lateral de tu llanta y no has sabido qué significan? No estás solo. Esta guía te explica todo lo que necesitas saber sobre las tallas de llantas de motocicleta, sin tecnicismos innecesarios.</p>

<figure class="article-figure">
  <img src="/assets/blog/guia-tallas-diagram.jpg" alt="Diagrama de secciones de una llanta de moto: ancho, perfil y diámetro" width="800" height="800" loading="lazy">
  <figcaption>Las tres medidas fundamentales de cualquier llanta de motocicleta.</figcaption>
</figure>

<h2>¿Qué significan los números en una llanta de moto?</h2>

<p>El código de una llanta de moto parece complicado, pero sigue un formato estándar internacional muy lógico. Tomemos como ejemplo <strong>120/70R17</strong>:</p>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Número</th><th>Qué representa</th><th>Ejemplo</th></tr>
    </thead>
    <tbody>
      <tr><td><strong>120</strong></td><td>Ancho de la llanta en milímetros</td><td>120 mm de ancho</td></tr>
      <tr><td><strong>70</strong></td><td>Perfil (% del ancho que es la altura del flanco)</td><td>70% de 120 = 84 mm de flanco</td></tr>
      <tr><td><strong>R</strong></td><td>Construcción radial (ZR = radial de alto rendimiento)</td><td>Radial</td></tr>
      <tr><td><strong>17</strong></td><td>Diámetro del aro en pulgadas</td><td>Aro de 17 pulgadas</td></tr>
    </tbody>
  </table>
</div>

<p>Hay llantas que no llevan la "R" (o llevan un guión), como <strong>110/90-17</strong>. Eso indica construcción <em>bias</em> (diagonal), tipo convencional. Las radiales ofrecen mejor estabilidad a alta velocidad; las bias son más económicas y resistentes al impacto.</p>

<h2>¿Qué significa la "Z" en ZR?</h2>

<p>Cuando ves <strong>ZR</strong> en lugar de simplemente <strong>R</strong>, significa que la llanta está homologada para velocidades superiores a 240 km/h. Para motos deportivas de alta cilindrada esto es relevante. Para uso urbano, no hace ninguna diferencia práctica.</p>

<h2>¿Cómo encontrar la talla correcta para tu moto?</h2>

<p>Hay tres formas infalibles:</p>

<h3>1. Lee el lateral de tu llanta actual</h3>
<p>La talla está grabada en relieve en el lateral de tu llanta actual. Es la fuente más confiable porque ya sabes que esa talla funcionó en tu moto.</p>

<figure class="article-figure">
  <img src="/assets/blog/guia-tallas-hero.jpg" alt="Número de talla 120/70R17 grabado en el lateral de una llanta de moto" width="800" height="800" loading="lazy">
  <figcaption>La talla siempre está grabada en el lateral de la llanta. En este caso, 120/70ZR17.</figcaption>
</figure>

<h3>2. Consulta el manual del propietario</h3>
<p>El manual de tu moto incluye las especificaciones técnicas. Ahí encontrarás la talla delantera y trasera recomendada por el fabricante.</p>

<figure class="article-figure">
  <img src="/assets/blog/guia-tallas-manual.jpg" alt="Manual del propietario de motocicleta abierto en la sección de especificaciones de llantas" width="800" height="800" loading="lazy">
  <figcaption>El manual del propietario siempre especifica la talla de llanta recomendada por el fabricante.</figcaption>
</figure>

<h3>3. Contacta a un asesor</h3>
<p>Si no tienes el manual o la llanta está muy desgastada para leer el número, escríbenos por <a href="https://wa.me/524441946502" target="_blank" rel="noopener">WhatsApp al +52 444 194 6502</a>. Con el modelo y año de tu moto te decimos exactamente qué talla necesitas.</p>

<h2>Tallas de llanta más comunes por tipo de moto</h2>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Tipo de moto</th><th>Delantera común</th><th>Trasera común</th></tr>
    </thead>
    <tbody>
      <tr><td>Deportiva / Naked 150–300 cc</td><td>110/70-17</td><td>130/70-17</td></tr>
      <tr><td>Deportiva / Naked 400–600 cc</td><td>120/70R17</td><td>160/60R17</td></tr>
      <tr><td>Supersport 600–1000 cc</td><td>120/70R17</td><td>180/55R17 o 190/50R17</td></tr>
      <tr><td>Touring / Adventure</td><td>110/80R19</td><td>150/70R17</td></tr>
      <tr><td>Scooter 125–150 cc</td><td>90/90-12 o 100/80-16</td><td>100/90-10 o 110/90-12</td></tr>
      <tr><td>Moto de trabajo / Delivery</td><td>70/90-17 o 80/90-17</td><td>100/90-17</td></tr>
    </tbody>
  </table>
</div>

<h2>¿Puedo poner una talla diferente a la especificada?</h2>

<p>En teoría sí, pero <strong>no lo recomendamos</strong> a menos que tengas conocimiento técnico avanzado. Cambiar a una talla más ancha puede afectar: la lectura del velocímetro, la geometría de manejo, el espacio en el chasis y la carga máxima homologada.</p>

<h2>¿Qué pasa si mezclo llantas radiales y bias?</h2>

<p>Esto es algo que <strong>no debes hacer nunca</strong>. Mezclar construcciones genera un comportamiento impredecible. Siempre usa el mismo tipo en ambas ruedas.</p>

<h2>¿Cada cuánto debo cambiar las llantas?</h2>

<ul>
  <li><strong>Llantas de uso urbano (Praxis Urban):</strong> 15,000 – 25,000 km</li>
  <li><strong>Llantas deportivas (Praxis Raptor):</strong> 10,000 – 18,000 km</li>
  <li><strong>Regla del tiempo:</strong> aunque no alcances el kilometraje, cambia las llantas si tienen más de 5 años. El caucho envejece y pierde agarre incluso sin desgaste visible.</li>
</ul>

<div class="article-cta-box">
  <h3>¿Necesitas llantas para tu moto?</h3>
  <p>Tenemos el catálogo completo de llantas Praxis disponibles en stock para envío inmediato a toda la República Mexicana.</p>
  <a href="/catalogo" class="article-cta-btn">Ver catálogo de llantas →</a>
</div>

<h2>Conclusión</h2>

<p>Leer una talla de llanta es más sencillo de lo que parece. El número antes de la barra es el ancho en milímetros, el de después es el perfil en porcentaje, la letra indica la construcción y el último número es el diámetro del aro en pulgadas. Siempre respeta la talla del fabricante y, ante cualquier duda, consulta con un especialista.</p>

<p>En Importadora Eurollantas llevamos más de 20 años ayudando a motociclistas en México a encontrar la llanta correcta. Si tienes preguntas, escríbenos — estamos para ayudarte.</p>

</article>
"""

# Firestore REST API document format
doc = {
    "fields": {
        "slug": {"stringValue": "guia-tallas-llanta-moto"},
        "title": {"stringValue": "¿Cómo leer la talla de una llanta de moto? Guía completa 2026"},
        "excerpt": {"stringValue": "Aprende a interpretar el código de talla de tu llanta: qué significan los números como 120/70R17, cómo encontrar la talla correcta para tu moto y qué errores debes evitar al cambiar llantas."},
        "content": {"stringValue": content_html},
        "coverImage": {"stringValue": "/assets/blog/guia-tallas-hero.jpg"},
        "date": {"timestampValue": NOW},
        "category": {"stringValue": "Consejos"},
        "readTime": {"integerValue": "7"},
        "author": {
            "mapValue": {
                "fields": {
                    "name": {"stringValue": "Equipo Eurollantas"},
                    "avatar": {"stringValue": "/assets/images/euro-logo-new.png"},
                    "role": {"stringValue": "Especialistas en Llantas para Moto"}
                }
            }
        },
        "tags": {
            "arrayValue": {
                "values": [
                    {"stringValue": "tallas de llanta"},
                    {"stringValue": "guía"},
                    {"stringValue": "llantas moto México"},
                    {"stringValue": "cómo elegir llanta"},
                    {"stringValue": "Praxis"},
                    {"stringValue": "120/70R17"}
                ]
            }
        }
    }
}

# ── 3. Check if post already exists (query by slug) ───────────────────────────
query_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:runQuery"
query_body = {
    "structuredQuery": {
        "from": [{"collectionId": "blog_posts"}],
        "where": {
            "fieldFilter": {
                "field": {"fieldPath": "slug"},
                "op": "EQUAL",
                "value": {"stringValue": "guia-tallas-llanta-moto"}
            }
        },
        "limit": 1
    }
}

headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

req = urllib.request.Request(
    query_url,
    data=json.dumps(query_body).encode(),
    headers=headers
)

with urllib.request.urlopen(req) as resp:
    results = json.loads(resp.read())

existing_doc_name = None
for result in results:
    if 'document' in result:
        existing_doc_name = result['document']['name']
        break

# ── 4. Create or update the document ─────────────────────────────────────────
if existing_doc_name:
    # PATCH existing doc
    update_url = f"https://firestore.googleapis.com/v1/{existing_doc_name}"
    req = urllib.request.Request(update_url, data=json.dumps(doc).encode(), headers=headers, method='PATCH')
    print(f"⚠️  Post already exists — updating...")
else:
    # POST new doc
    create_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/blog_posts"
    req = urllib.request.Request(create_url, data=json.dumps(doc).encode(), headers=headers, method='POST')
    print("📝 Creating new blog post...")

with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
    doc_name = result.get('name', '')
    doc_id = doc_name.split('/')[-1] if doc_name else 'unknown'

print(f"✅ Blog post seeded! Firestore ID: {doc_id}")
print(f"🔗 URL: https://importadoraeuro.com/blog/guia-tallas-llanta-moto")
