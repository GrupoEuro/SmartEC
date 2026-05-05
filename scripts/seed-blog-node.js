/**
 * seed-blog-node.js
 * Seeds the tire size guide blog post using google-auth-library + Firestore REST API.
 * No service account key needed — uses Firebase CLI's stored OAuth token.
 */
const { OAuth2Client } = require('google-auth-library');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ID = 'tiendapraxis';

// ── Auth ──────────────────────────────────────────────────────────────────────
const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens = config.tokens;

const client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
client.setCredentials({ refresh_token: tokens.refresh_token, access_token: tokens.access_token });

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Blog post content ─────────────────────────────────────────────────────────
const content = `
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
      <tr><td><strong>R</strong></td><td>Construcción radial (ZR = alto rendimiento)</td><td>Radial</td></tr>
      <tr><td><strong>17</strong></td><td>Diámetro del aro en pulgadas</td><td>Aro de 17 pulgadas</td></tr>
    </tbody>
  </table>
</div>

<p>Hay llantas que no llevan la "R" como <strong>110/90-17</strong>. Eso indica construcción <em>bias</em> (diagonal), el tipo convencional. Las radiales ofrecen mejor estabilidad a alta velocidad; las bias son más económicas y resistentes al impacto.</p>

<h2>¿Qué significa la "Z" en ZR?</h2>

<p>Cuando ves <strong>ZR</strong> en lugar de simplemente <strong>R</strong>, significa que la llanta está homologada para velocidades superiores a 240 km/h. Para motos deportivas de alta cilindrada esto es relevante. Para uso urbano, no hace ninguna diferencia práctica.</p>

<h2>¿Cómo encontrar la talla correcta para tu moto?</h2>

<p>Hay tres formas infalibles:</p>

<h3>1. Lee el lateral de tu llanta actual</h3>
<p>La talla está grabada en relieve en el lateral de tu llanta. Es la fuente más confiable porque ya sabes que esa talla funcionó en tu moto.</p>

<figure class="article-figure">
  <img src="/assets/blog/guia-tallas-hero.jpg" alt="Número de talla 120/70R17 grabado en el lateral de una llanta de moto" width="800" height="800" loading="lazy">
  <figcaption>La talla siempre está grabada en el lateral de la llanta. En este caso, 120/70ZR17.</figcaption>
</figure>

<h3>2. Consulta el manual del propietario</h3>
<p>El manual incluye las especificaciones técnicas con la talla delantera y trasera recomendada por el fabricante.</p>

<figure class="article-figure">
  <img src="/assets/blog/guia-tallas-manual.jpg" alt="Manual del propietario de motocicleta abierto en la sección de especificaciones de llantas" width="800" height="800" loading="lazy">
  <figcaption>El manual del propietario siempre especifica la talla de llanta recomendada por el fabricante.</figcaption>
</figure>

<h3>3. Contacta a un asesor</h3>
<p>Si no tienes el manual, escríbenos por <a href="https://wa.me/524441946502" target="_blank" rel="noopener">WhatsApp al +52 444 194 6502</a>. Con el modelo y año de tu moto te decimos exactamente qué talla necesitas.</p>

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

<p>En teoría sí, pero <strong>no lo recomendamos</strong> sin conocimiento técnico avanzado. Cambiar a una talla diferente puede afectar: la lectura del velocímetro, la geometría de manejo, el espacio en el chasis y la carga máxima homologada.</p>

<h2>¿Qué pasa si mezclo llantas radiales y bias?</h2>

<p>Esto es algo que <strong>no debes hacer nunca</strong>. Mezclar construcciones genera un comportamiento impredecible. Siempre usa el mismo tipo de construcción en ambas ruedas.</p>

<h2>¿Cada cuánto debo cambiar las llantas?</h2>

<ul>
  <li><strong>Llantas de uso urbano (Praxis Urban):</strong> 15,000 – 25,000 km</li>
  <li><strong>Llantas deportivas (Praxis Raptor):</strong> 10,000 – 18,000 km</li>
  <li><strong>Regla del tiempo:</strong> aunque no alcances el kilometraje, cambia las llantas si tienen más de 5 años — el caucho envejece y pierde agarre incluso sin desgaste visible.</li>
</ul>

<div class="article-cta-box">
  <h3>¿Necesitas llantas para tu moto?</h3>
  <p>Tenemos el catálogo completo de llantas Praxis en stock para envío inmediato a toda la República Mexicana.</p>
  <a href="/catalogo" class="article-cta-btn">Ver catálogo de llantas →</a>
</div>

<h2>Conclusión</h2>

<p>Leer una talla de llanta es más sencillo de lo que parece: el número antes de la barra es el ancho en mm, el de después es el perfil en porcentaje, la letra indica la construcción y el último número es el diámetro del aro. Siempre respeta la talla del fabricante y, ante cualquier duda, consulta con un especialista.</p>

<p>En Importadora Eurollantas llevamos más de 20 años ayudando a motociclistas en México a encontrar la llanta correcta. Si tienes preguntas, escríbenos — estamos para ayudarte.</p>

</article>
`;

// ── Firestore document ────────────────────────────────────────────────────────
const doc = {
  fields: {
    slug:       { stringValue: 'guia-tallas-llanta-moto' },
    title:      { stringValue: '¿Cómo leer la talla de una llanta de moto? Guía completa 2026' },
    excerpt:    { stringValue: 'Aprende a interpretar el código de talla de tu llanta: qué significan los números como 120/70R17, cómo encontrar la talla correcta para tu moto y qué errores debes evitar al cambiar llantas.' },
    content:    { stringValue: content },
    coverImage: { stringValue: '/assets/blog/guia-tallas-hero.jpg' },
    date:       { timestampValue: '2026-05-02T01:00:00Z' },
    category:   { stringValue: 'Consejos' },
    readTime:   { integerValue: '7' },
    author: {
      mapValue: {
        fields: {
          name:   { stringValue: 'Equipo Eurollantas' },
          avatar: { stringValue: '/assets/images/euro-logo-new.png' },
          role:   { stringValue: 'Especialistas en Llantas para Moto' }
        }
      }
    },
    tags: {
      arrayValue: {
        values: [
          { stringValue: 'tallas de llanta' },
          { stringValue: 'guía' },
          { stringValue: 'llantas moto México' },
          { stringValue: 'cómo elegir llanta' },
          { stringValue: 'Praxis' },
          { stringValue: '120/70R17' }
        ]
      }
    }
  }
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { token } = await client.getAccessToken();
  console.log('✅ Got access token');

  // Check if slug already exists
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'blog_posts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'slug' },
          op: 'EQUAL',
          value: { stringValue: 'guia-tallas-llanta-moto' }
        }
      },
      limit: 1
    }
  };

  const results = await request(
    'POST',
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    query,
    token
  );

  let existingName = null;
  for (const r of results) {
    if (r.document) { existingName = r.document.name; break; }
  }

  let result;
  if (existingName) {
    console.log('⚠️  Post already exists — updating...');
    result = await request('PATCH', `/v1/${existingName}`, doc, token);
  } else {
    console.log('📝 Creating new blog post...');
    result = await request(
      'POST',
      `/v1/projects/${PROJECT_ID}/databases/(default)/documents/blog_posts`,
      doc,
      token
    );
  }

  const id = result.name.split('/').pop();
  console.log(`✅ Blog post seeded! Firestore ID: ${id}`);
  console.log(`🔗 https://importadoraeuro.com/blog/guia-tallas-llanta-moto`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
