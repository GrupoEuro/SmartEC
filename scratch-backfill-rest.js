/**
 * scratch-backfill-rest.js
 * Backfills forecastRevenue for each day of the current month
 * using the firebase-tools stored OAuth token (no service account needed).
 * 
 * Usage: node scratch-backfill-rest.js
 */
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Auth ───────────────────────────────────────────────────────────────────
const configPath = path.join(process.env.HOME, '.config/configstore/firebase-tools.json');
const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tokens     = config.tokens;

const PROJECT  = 'tiendapraxis';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Helper: refresh OAuth token if needed
function refreshAccessToken(refreshToken) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            client_id:     '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
            client_secret: 'j9iVZfS8zyPyOgRXQE7zKoZ_',
            refresh_token: refreshToken,
            grant_type:    'refresh_token',
        }).toString();

        const options = {
            hostname: 'oauth2.googleapis.com',
            path:     '/token',
            method:   'POST',
            headers:  {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try   { resolve(JSON.parse(data)); }
                catch { reject(new Error('Bad token response: ' + data)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Helper: Firestore REST GET (runQuery)
function firestoreQuery(token, query) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(query);
        const options = {
            hostname: 'firestore.googleapis.com',
            path:     `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            method:   'POST',
            headers:  {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try   { resolve(JSON.parse(data)); }
                catch { reject(new Error('Bad query response: ' + data.slice(0, 300))); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Helper: Firestore REST PATCH (merge update)
function firestorePatch(token, docPath, fields) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ fields });
        // Firestore REST requires repeated params: updateMask.fieldPaths=f1&updateMask.fieldPaths=f2
        const maskParams = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
        const options = {
            hostname: 'firestore.googleapis.com',
            path:     `/v1/projects/${PROJECT}/databases/(default)/documents/${docPath}?${maskParams}`,
            method:   'PATCH',
            headers:  {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error(`PATCH ${docPath}: ${res.statusCode} ${data.slice(0, 200)}`));
                else resolve();
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Helper: Firestore value helpers
function num(n)  { return { doubleValue: n }; }
function int(n)  { return { integerValue: String(Math.round(n)) }; }
function str(s)  { return { stringValue: s }; }

// Extract a number from a Firestore field value
function getNum(field) {
    if (!field) return 0;
    if (field.doubleValue  !== undefined) return field.doubleValue;
    if (field.integerValue !== undefined) return Number(field.integerValue);
    return 0;
}

// Query analytics_daily for a date range
async function queryDailyRange(token, from, to) {
    const result = await firestoreQuery(token, {
        structuredQuery: {
            from: [{ collectionId: 'analytics_daily' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: str(from) } },
                        { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL',    value: str(to)   } },
                    ],
                },
            },
            orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }],
        },
    });
    return Array.isArray(result) ? result.filter(r => r.document) : [];
}

// ── Holt-Winters ───────────────────────────────────────────────────────────
function hwTriple(series, m = 7, alpha = 0.3, beta = 0.1, gamma = 0.2, periods = 31) {
    if (series.length < m * 2) {
        const avg = series.reduce((a, b) => a + b, 0) / Math.max(series.length, 1);
        return new Array(periods).fill(avg);
    }
    let L = series.slice(0, m).reduce((a, b) => a + b, 0) / m;
    let T = 0;
    for (let i = 0; i < m; i++) T += (series[m + i] - series[i]) / m;
    T /= m;
    const S = [];
    for (let i = 0; i < m; i++) {
        const mean = L || 1;
        S.push((series[i] || 0) / mean);
    }
    for (let t = m; t < series.length; t++) {
        const st = series[t] || 0;
        const si = S[t % m] || 1;
        const newL = alpha * (st / Math.max(si, 0.01)) + (1 - alpha) * (L + T);
        const newT = beta * (newL - L) + (1 - beta) * T;
        S[t % m] = gamma * (st / Math.max(newL, 1)) + (1 - gamma) * si;
        T = newT;
        L = newL;
    }
    const fc = [];
    for (let h = 1; h <= periods; h++) {
        fc.push(Math.max(0, (L + h * T) * (S[(series.length + h - 1) % m] || 1)));
    }
    return fc;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function run() {
    console.log('\n🔑  Reading cached firebase-tools access token...');
    // Use the access_token directly — firebase-tools refreshes it automatically
    // when you run any CLI command. If this fails with 401, run:
    //   npx firebase-tools@latest login
    const token = tokens.access_token;
    if (!token) {
        console.error('❌  No access_token in firebase-tools config. Run: npx firebase-tools@latest login');
        process.exit(1);
    }
    console.log('   Token found ✓');

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const mon   = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();

    console.log(`\n🔄  Backfilling forecasts for ${year}-${mon} (${daysInMonth} days)...`);

    // Load LY data
    const lyYear = year - 1;
    const lyFrom = `${lyYear}-${mon}-01`;
    const lyTo   = `${lyYear}-${mon}-${String(daysInMonth).padStart(2, '0')}`;
    console.log(`   Loading LY (${lyYear}-${mon}) from analytics_daily...`);
    const lyRows = await queryDailyRange(token, lyFrom, lyTo);
    const lySeries = new Array(daysInMonth).fill(0);
    lyRows.forEach(r => {
        const fields = r.document.fields || {};
        const date   = fields.date?.stringValue || '';
        const day    = parseInt(date.split('-')[2], 10);
        if (day >= 1 && day <= daysInMonth) lySeries[day - 1] = getNum(fields.totalRevenue);
    });
    const lyTotal = lySeries.reduce((a, b) => a + b, 0);
    console.log(`   LY days with data: ${lySeries.filter(v => v > 0).length}, total: $${lyTotal.toFixed(0)}`);

    // Load CY actuals
    const cyFrom = `${year}-${mon}-01`;
    const cyTo   = `${year}-${mon}-${String(daysInMonth).padStart(2, '0')}`;
    console.log(`   Loading CY actuals...`);
    const cyRows = await queryDailyRange(token, cyFrom, cyTo);
    const cyMap  = new Map();
    cyRows.forEach(r => {
        const fields = r.document.fields || {};
        const date   = fields.date?.stringValue || '';
        cyMap.set(date, {
            rev:    getNum(fields.totalRevenue),
            orders: getNum(fields.totalOrders),
            units:  getNum(fields.totalUnits),
            hasForecast: getNum(fields.forecastRevenue) > 0,
        });
    });
    console.log(`   CY days loaded: ${cyMap.size}`);

    // Velocity multiplier
    const todayDay = now.getDate();
    let cySales = 0, lySalesMTD = 0;
    cyMap.forEach(v => { cySales += v.rev; });
    for (let i = 0; i < todayDay - 1; i++) lySalesMTD += lySeries[i];
    const velocityMult = lySalesMTD > 0 ? cySales / lySalesMTD : 1;
    console.log(`   Velocity: ${velocityMult.toFixed(4)}x (CY $${cySales.toFixed(0)} / LY $${lySalesMTD.toFixed(0)})`);

    // ── 7-day trailing SMA (most honest retroactive forecast) ───────────────
    // For past day D: forecast = avg of CY actuals for the 7 days before D.
    // This only uses information that existed at the time — no future leakage.
    // For future days: LY[D] × velocity of the last 7 completed CY days.

    // Build a sorted array of CY actuals by day index
    const cyByDay = new Array(daysInMonth + 1).fill(0); // 1-indexed
    cyMap.forEach((v, dateStr) => {
        const day = parseInt(dateStr.split('-')[2], 10);
        cyByDay[day] = v.rev;
    });

    // Compute last-7-days velocity for future day projection
    const lastDayIdx    = todayDay; // last day with actual data
    const lookback      = Math.min(7, lastDayIdx);
    let cyLast7 = 0, lyLast7 = 0;
    for (let d = lastDayIdx - lookback + 1; d <= lastDayIdx; d++) {
        cyLast7 += cyByDay[d] || 0;
        lyLast7 += lySeries[d - 1] || 0;
    }
    const futureVelocity = lyLast7 > 0 ? cyLast7 / lyLast7 : velocityMult;
    console.log(`   Last-7-day velocity (for future projection): ${futureVelocity.toFixed(3)}x (CY $${cyLast7.toFixed(0)} / LY $${lyLast7.toFixed(0)})`);

    // Write forecasts
    const dailyAvgFallback = cySales / Math.max(todayDay - 1, 1);
    let written = 0;

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr  = `${year}-${mon}-${String(day).padStart(2, '0')}`;
        const actual   = cyByDay[day] || 0;
        const isPast   = actual > 0;

        let forecastRevenue;

        if (isPast || day <= todayDay) {
            // Past day: 7-day trailing SMA of CY actuals ending the day before
            const windowEnd   = day - 1;
            const windowStart = Math.max(1, day - 7);
            let sum = 0, count = 0;
            for (let d = windowStart; d <= windowEnd; d++) {
                if (cyByDay[d] > 0) { sum += cyByDay[d]; count++; }
            }

            if (count > 0) {
                forecastRevenue = sum / count;
            } else if (day === 1) {
                // Day 1: no prior history — use LY[1] × overall velocity as cold start
                forecastRevenue = (lySeries[0] || 0) * velocityMult;
            } else {
                forecastRevenue = dailyAvgFallback;
            }
        } else {
            // Future day: continue the 7-day CY SMA trend.
            // Using LY × velocity risks inheriting LY anomalies (spikes/dips).
            // The SMA of the most recent 7 CY days is the most reliable forward estimate.
            const windowEnd   = todayDay;
            const windowStart = Math.max(1, todayDay - 6);
            let sum = 0, count = 0;
            for (let d = windowStart; d <= windowEnd; d++) {
                if (cyByDay[d] > 0) { sum += cyByDay[d]; count++; }
            }
            forecastRevenue = count > 0 ? sum / count : dailyAvgFallback;
        }

        forecastRevenue = Math.max(0, forecastRevenue);
        const forecastOrders = Math.round(forecastRevenue / 850);
        const forecastUnits  = Math.round(forecastRevenue / 550);

        await firestorePatch(token, `analytics_daily/${dateStr}`, {
            date:            str(dateStr),
            forecastRevenue: num(forecastRevenue),
            forecastOrders:  int(forecastOrders),
            forecastUnits:   int(forecastUnits),
            forecastMethod:  str('trailing-sma7-v3-backfill'),
        });
        written++;

        const lyVal = lySeries[day - 1] || 0;
        const err = actual > 0 ? (((forecastRevenue - actual) / actual) * 100).toFixed(1) + '%' : '(future)';
        console.log(`   ${dateStr}: SMA7=$${forecastRevenue.toFixed(0)}  actual=$${actual.toFixed(0)}  LY=$${lyVal.toFixed(0)}  err=${err}`);

        await new Promise(r => setTimeout(r, 50));
    }

    console.log(`\n✅  Done — ${written} days rewritten with trailing-SMA7 model`);
    process.exit(0);
}

run().catch(err => {
    console.error('\n❌  Backfill error:', err.message || err);
    process.exit(1);
});

