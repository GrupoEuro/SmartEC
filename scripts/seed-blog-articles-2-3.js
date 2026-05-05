/**
 * seed-blog-articles-2-3.js
 * Seeds articles 2 and 3 using google-auth-library + Firestore REST API.
 * Article 2: Praxis Raptor vs Urban — ¿cuál elegir?
 * Article 3: Llantas Praxis para Italika — guía completa
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
const client = new OAuth2Client(
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  'j9iVZfS8kkqWEntmZJbEhFZQ',
  'urn:ietf:wg:oauth:2.0:oob'
);
client.setCredentials({ refresh_token: config.tokens.refresh_token, access_token: config.tokens.access_token });

// ── HTTP helper ───────────────────────────────────────────────────────────────
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
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function slugExists(slug, token) {
  const results = await request('POST',
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    { structuredQuery: { from: [{ collectionId: 'blog_posts' }], where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } }, limit: 1 } },
    token
  );
  for (const r of results) { if (r.document) return r.document.name; }
  return null;
}

async function upsert(slug, doc, token) {
  const existing = await slugExists(slug, token);
  if (existing) {
    console.log(`⚠️  "${slug}" exists — updating...`);
    await request('PATCH', `/v1/${existing}`, doc, token);
  } else {
    console.log(`📝 Creating "${slug}"...`);
    const result = await request('POST', `/v1/projects/${PROJECT_ID}/databases/(default)/documents/blog_posts`, doc, token);
    console.log(`✅ Created — ID: ${result.name.split('/').pop()}`);
  }
}

// ── ARTICLE 2: Praxis Raptor vs Urban ────────────────────────────────────────
const raptorContent = `
<article>

<p class="article-lead">Si estás buscando llantas Praxis para tu motocicleta y no sabes si elegir el modelo <strong>Raptor</strong> o el <strong>Urban</strong>, esta guía es para ti. Ambas son excelentes, pero están diseñadas para contextos muy diferentes — elegir mal puede costarte kilometraje, seguridad y dinero.</p>

<figure class="article-figure">
  <img src="/assets/blog/raptor-vs-urban-hero.jpg" alt="Llanta Praxis Raptor (deportiva) vs Praxis Urban (urbana) comparación lado a lado" width="800" height="800" loading="lazy">
  <figcaption>Izquierda: Praxis Raptor con tread deportivo. Derecha: Praxis Urban para uso urbano.</figcaption>
</figure>

<h2>Tabla comparativa rápida</h2>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Característica</th><th>🔵 Praxis Raptor</th><th>🔴 Praxis Urban</th></tr>
    </thead>
    <tbody>
      <tr><td>Tipo de uso</td><td>Deportivo / carretera</td><td>Ciudad / diario</td></tr>
      <tr><td>Construcción</td><td>Radial (R)</td><td>Diagonal (bias)</td></tr>
      <tr><td>Perfil del tread</td><td>Agresivo, asimétrico</td><td>Simétrico, continuo</td></tr>
      <tr><td>Kilómetros estimados</td><td>10,000 – 18,000 km</td><td>15,000 – 25,000 km</td></tr>
      <tr><td>Agarre en curvas</td><td>⭐⭐⭐⭐⭐ Excelente</td><td>⭐⭐⭐ Bueno</td></tr>
      <tr><td>Confort urbano</td><td>⭐⭐⭐ Moderado</td><td>⭐⭐⭐⭐⭐ Excelente</td></tr>
      <tr><td>Resistencia al desgaste</td><td>⭐⭐⭐ Moderada</td><td>⭐⭐⭐⭐⭐ Alta</td></tr>
      <tr><td>Precio relativo</td><td>Mayor</td><td>Menor</td></tr>
    </tbody>
  </table>
</div>

<h2>Praxis Raptor: máximo rendimiento deportivo</h2>

<p>El Raptor es la llanta de alto rendimiento de Praxis. Está diseñada para motos deportivas y naked de media y alta cilindrada que se usan en carretera o con un estilo de manejo más dinámico.</p>

<figure class="article-figure">
  <img src="/assets/blog/raptor-tread.jpg" alt="Detalle del tread del Praxis Raptor: bandas asimétricas de alto agarre" width="800" height="800" loading="lazy">
  <figcaption>El diseño de banda de rodadura asimétrico del Raptor maximiza el agarre en curvas cerradas.</figcaption>
</figure>

<h3>¿Para quién es el Raptor?</h3>
<ul>
  <li>Motos deportivas y naked de 250 cc en adelante</li>
  <li>Riders que hacen carretera frecuente o viajes largos</li>
  <li>Quienes priorizan el agarre sobre la durabilidad</li>
  <li>Uso mixto ciudad-carretera con inclinación al rendimiento</li>
</ul>

<h3>Lo que debes saber antes de elegirlo</h3>
<p>El Raptor necesita un periodo de rodaje de <strong>al menos 100 km</strong> antes de explotar su máximo agarre. Durante ese periodo, el caucho nuevo todavía tiene una capa de desmoldante y no está completamente asentado. Maneja con precaución al inicio.</p>

<h2>Praxis Urban: el rey de la ciudad</h2>

<p>El Urban es la llanta optimizada para el uso diario en ciudad. Si tu moto es tu medio de transporte principal, haces entregas, o recorres principalmente calles urbanas con topes y baches, el Urban es tu aliado.</p>

<figure class="article-figure">
  <img src="/assets/blog/urban-commute.jpg" alt="Motociclista en tráfico urbano de México con llanta Praxis Urban en asfalto mojado" width="800" height="800" loading="lazy">
  <figcaption>El Praxis Urban mantiene excelente agarre incluso en asfalto mojado y tráfico denso.</figcaption>
</figure>

<h3>¿Para quién es el Urban?</h3>
<ul>
  <li>Motos de commuting y uso diario en ciudad</li>
  <li>Motos de delivery: rapidez de desgaste = costo mensual directo</li>
  <li>Riders que buscan el mejor costo por kilómetro</li>
  <li>Motos de baja y media cilindrada con uso principalmente urbano</li>
</ul>

<h2>¿Cuál debo elegir? Guía de decisión rápida</h2>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Si tu situación es...</th><th>Elige</th></tr>
    </thead>
    <tbody>
      <tr><td>Uso exclusivo en ciudad, tráfico diario</td><td><strong>Praxis Urban</strong></td></tr>
      <tr><td>Carretera 60%+ del tiempo</td><td><strong>Praxis Raptor</strong></td></tr>
      <tr><td>Moto de delivery o trabajo</td><td><strong>Praxis Urban</strong> (menor costo por km)</td></tr>
      <tr><td>Moto deportiva 400+ cc</td><td><strong>Praxis Raptor</strong></td></tr>
      <tr><td>Presupuesto ajustado, uso mixto</td><td><strong>Praxis Urban</strong></td></tr>
      <tr><td>Viajes frecuentes fuera de ciudad</td><td><strong>Praxis Raptor</strong></td></tr>
    </tbody>
  </table>
</div>

<h2>¿Puedo mezclar Raptor adelante y Urban atrás?</h2>

<p>Técnicamente es posible si ambas son del mismo tipo de construcción (radial o bias) y si las tallas son compatibles. Sin embargo, <strong>no lo recomendamos</strong> porque los compuestos de caucho diferentes reaccionan de forma distinta a la temperatura y la carga. Para uso casual urbano el impacto es mínimo; para carretera o curvas pronunciadas, puede generar comportamientos impredecibles.</p>

<div class="article-cta-box">
  <h3>¿Ya sabes cuál necesitas?</h3>
  <p>Consulta el stock disponible de llantas Praxis Raptor y Praxis Urban en nuestro catálogo. Envíos a toda la República Mexicana en 1–3 días hábiles.</p>
  <a href="/catalogo" class="article-cta-btn">Ver catálogo completo →</a>
</div>

<h2>Conclusión</h2>

<p>No hay una llanta "mejor" en absoluto — hay una llanta mejor para <em>tu</em> uso específico. El Raptor gana en rendimiento deportivo y agarre en carretera. El Urban gana en durabilidad, confort urbano y costo por kilómetro. Analiza dónde manejas más y elige en consecuencia. ¿Tienes dudas? <a href="https://wa.me/524441946502" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> — te asesoramos sin costo.</p>

</article>
`;

const raptorDoc = {
  fields: {
    slug:       { stringValue: 'praxis-raptor-vs-urban' },
    title:      { stringValue: 'Praxis Raptor vs Urban: ¿cuál es la llanta correcta para tu moto?' },
    excerpt:    { stringValue: '¿No sabes si elegir el Praxis Raptor o el Urban? Comparamos ambas llantas en agarre, durabilidad, costo por kilómetro y tipo de uso para ayudarte a tomar la mejor decisión.' },
    content:    { stringValue: raptorContent },
    coverImage: { stringValue: '/assets/blog/raptor-vs-urban-hero.jpg' },
    date:       { timestampValue: '2026-05-07T01:00:00Z' },
    category:   { stringValue: 'Consejos' },
    readTime:   { integerValue: '6' },
    author: { mapValue: { fields: { name: { stringValue: 'Equipo Eurollantas' }, avatar: { stringValue: '/assets/images/euro-logo-new.png' }, role: { stringValue: 'Especialistas en Llantas para Moto' } } } },
    tags: { arrayValue: { values: [
      { stringValue: 'Praxis Raptor' }, { stringValue: 'Praxis Urban' },
      { stringValue: 'comparativa llantas' }, { stringValue: 'qué llanta elegir' },
      { stringValue: 'llantas moto México' }
    ]}}
  }
};

// ── ARTICLE 3: Llantas Praxis para Italika ───────────────────────────────────
const italikaContent = `
<article>

<p class="article-lead">Italika es la marca de motocicletas más vendida en México, con millones de unidades circulando por todo el país. Si tienes una Italika y necesitas cambiar llantas, esta guía te dice exactamente qué tallas necesitas para cada modelo popular, y por qué Praxis es la opción más inteligente.</p>

<figure class="article-figure">
  <img src="/assets/blog/italika-hero.jpg" alt="Motocicleta Italika FT150 en calle mexicana mostrando llanta delantera" width="800" height="800" loading="lazy">
  <figcaption>La Italika FT150, una de las motos más populares de México, con llantas en perfecto estado para ciudad.</figcaption>
</figure>

<h2>Tallas de llanta para Italika por modelo</h2>

<p>A continuación encontrarás las tallas de llanta delantera y trasera recomendadas para los modelos Italika más comunes en México:</p>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Modelo Italika</th><th>Llanta Delantera</th><th>Llanta Trasera</th></tr>
    </thead>
    <tbody>
      <tr><td><strong>FT125 / FT150</strong></td><td>70/90-17</td><td>80/90-17</td></tr>
      <tr><td><strong>FT180 / FT200</strong></td><td>80/90-17</td><td>100/90-17</td></tr>
      <tr><td><strong>DM150 / DM200</strong></td><td>70/90-17</td><td>90/90-17</td></tr>
      <tr><td><strong>TC200 (Enduro)</strong></td><td>70/100-21</td><td>100/90-18</td></tr>
      <tr><td><strong>WS150</strong></td><td>100/80-17</td><td>130/70-17</td></tr>
      <tr><td><strong>CS125 / CS150 (Scooter)</strong></td><td>110/90-12</td><td>110/90-12</td></tr>
      <tr><td><strong>AT110 / AT125</strong></td><td>2.50-17</td><td>2.75-17</td></tr>
      <tr><td><strong>GS150 / GS200</strong></td><td>90/90-18</td><td>110/90-17</td></tr>
    </tbody>
  </table>
</div>

<p><strong>Nota importante:</strong> siempre confirma la talla leyendo el lateral de tu llanta actual o consultando el manual de tu moto. Los modelos de año reciente pueden tener especificaciones ligeramente diferentes.</p>

<h2>¿Por qué elegir Praxis para tu Italika?</h2>

<p>Las Italika vienen de fábrica con llantas de origen chino de calidad básica. Son funcionales para el periodo de garantía, pero los motociclistas con experiencia suelen reportar que se desgastan rápido y pierden agarre en mojado antes de llegar a los 8,000 km.</p>

<p>Praxis resuelve exactamente esos problemas:</p>

<ul>
  <li><strong>Mayor durabilidad:</strong> 15,000–25,000 km estimados en uso urbano</li>
  <li><strong>Mejor agarre en mojado:</strong> diseño de banda de rodadura optimizado para lluvia</li>
  <li><strong>Manejo más estable:</strong> compuesto de caucho de mayor calidad = menos movimiento en curvas</li>
  <li><strong>Precio competitivo:</strong> mejor costo por kilómetro vs llantas de origen</li>
</ul>

<figure class="article-figure">
  <img src="/assets/blog/italika-tire-fit.jpg" alt="Mecánico instalando llanta Praxis en aro de motocicleta Italika en taller" width="800" height="800" loading="lazy">
  <figcaption>La instalación de llantas Praxis es estándar — cualquier taller de motocicletas en México puede montarlas.</figcaption>
</figure>

<h2>¿Qué modelo Praxis le queda a mi Italika?</h2>

<p>Para la mayoría de los modelos Italika de uso urbano, el <strong>Praxis Urban</strong> es la opción ideal: máxima durabilidad, agarre urbano excelente y el mejor costo por kilómetro del mercado.</p>

<p>Si tu Italika es una naked o deportiva (WS150, GS200) y la usas para carretera o rutas interurbanas, considera el <strong>Praxis Raptor</strong> para mejor estabilidad a velocidades más altas.</p>

<div class="info-table-wrapper">
  <table class="info-table">
    <thead>
      <tr><th>Modelo Italika</th><th>Praxis recomendado</th></tr>
    </thead>
    <tbody>
      <tr><td>FT125 / FT150 / FT200 (trabajo / ciudad)</td><td>Praxis Urban</td></tr>
      <tr><td>DM150 / DM200 (trabajo)</td><td>Praxis Urban</td></tr>
      <tr><td>CS125 / CS150 (scooter)</td><td>Praxis Urban</td></tr>
      <tr><td>AT110 / AT125 (trabajo)</td><td>Praxis Urban</td></tr>
      <tr><td>WS150 (naked sport)</td><td>Praxis Raptor</td></tr>
      <tr><td>GS150 / GS200 (sport)</td><td>Praxis Raptor</td></tr>
    </tbody>
  </table>
</div>

<h2>Preguntas frecuentes</h2>

<h3>¿Puedo instalar llantas Praxis yo mismo?</h3>
<p>No lo recomendamos. La instalación de llantas requiere herramientas especializadas (desmontadoras) y el balanceo posterior es indispensable para evitar vibraciones. El costo de instalación en un taller es de aprox. $100–200 MXN por llanta en la mayoría de las ciudades de México — una inversión pequeña que protege tu seguridad.</p>

<h3>¿Cuánto cuesta un cambio de llantas para mi Italika?</h3>
<p>En general:</p>
<ul>
  <li><strong>Llantas Praxis:</strong> desde ~$400 MXN por pieza (varía por modelo y talla)</li>
  <li><strong>Instalación + balanceo:</strong> $100–200 MXN por rueda</li>
  <li><strong>Total estimado para ambas ruedas:</strong> $1,000–1,500 MXN</li>
</ul>

<h3>¿Con qué presión debo inflar las llantas de mi Italika?</h3>
<p>Consulta siempre el manual de tu moto. Como referencia general para modelos de 125–200 cc:</p>
<ul>
  <li><strong>Delantera:</strong> 28–30 PSI (sin pasajero)</li>
  <li><strong>Trasera:</strong> 32–36 PSI (sin pasajero) / 36–40 PSI (con pasajero o carga)</li>
</ul>
<p>Verifica la presión en frío, antes de arrancar, al menos una vez por semana.</p>

<div class="article-cta-box">
  <h3>¿Listo para mejorar las llantas de tu Italika?</h3>
  <p>Consulta disponibilidad y precios de llantas Praxis para tu modelo exacto. Envíos a toda la República en 1–3 días hábiles.</p>
  <a href="/catalogo" class="article-cta-btn">Ver llantas disponibles →</a>
</div>

<h2>Conclusión</h2>

<p>Cambiar las llantas de fábrica de tu Italika por Praxis es una de las mejores mejoras que puedes hacer a tu moto: más agarre, más kilómetros y más seguridad por un precio accesible. Usa la tabla de tallas de esta guía, elige el modelo Praxis correcto para tu uso y confía la instalación a un taller de confianza.</p>

<p>¿Tienes dudas sobre tu modelo específico? <a href="https://wa.me/524441946502" target="_blank" rel="noopener">Contáctanos por WhatsApp</a> — somos especialistas y te orientamos sin costo.</p>

</article>
`;

const italikaDoc = {
  fields: {
    slug:       { stringValue: 'llantas-praxis-para-italika' },
    title:      { stringValue: 'Llantas Praxis para Italika: guía completa de tallas y modelos 2026' },
    excerpt:    { stringValue: 'Encuentra la talla exacta de llanta para tu Italika FT150, DM200, WS150 y más. Comparamos qué modelo Praxis le queda mejor a cada moto y cómo sacarle el mayor provecho.' },
    content:    { stringValue: italikaContent },
    coverImage: { stringValue: '/assets/blog/italika-hero.jpg' },
    date:       { timestampValue: '2026-05-12T01:00:00Z' },
    category:   { stringValue: 'Consejos' },
    readTime:   { integerValue: '8' },
    author: { mapValue: { fields: { name: { stringValue: 'Equipo Eurollantas' }, avatar: { stringValue: '/assets/images/euro-logo-new.png' }, role: { stringValue: 'Especialistas en Llantas para Moto' } } } },
    tags: { arrayValue: { values: [
      { stringValue: 'llantas Italika' }, { stringValue: 'Italika FT150' },
      { stringValue: 'Praxis Urban' }, { stringValue: 'talla llanta Italika' },
      { stringValue: 'llantas moto México' }, { stringValue: 'cambio de llantas' }
    ]}}
  }
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { token } = await client.getAccessToken();
  console.log('✅ Got access token\n');
  await upsert('praxis-raptor-vs-urban', raptorDoc, token);
  await upsert('llantas-praxis-para-italika', italikaDoc, token);
  console.log('\n🔗 https://importadoraeuro.com/blog/praxis-raptor-vs-urban');
  console.log('🔗 https://importadoraeuro.com/blog/llantas-praxis-para-italika');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
