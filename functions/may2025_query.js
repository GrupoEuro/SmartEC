const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'tiendapraxis' });
const db = admin.firestore();

async function main() {
    const NON_REVENUE = ['pending_payment', 'payment_failed', 'cancelled', 'refunded', 'returned'];
    const MAY_START = new Date('2025-05-01T06:00:00Z');
    const MAY_END   = new Date('2025-06-01T05:59:59Z');
    const HOT_START = new Date('2025-05-26T06:00:00Z');

    // ── analytics_daily (pre-aggregated, most reliable) ──────────────────────
    const adMay = await db.collection('analytics_daily')
        .where('date','>=','2025-05-01').where('date','<=','2025-05-31')
        .orderBy('date').get();

    const channels = {
        MELI_FULL:    { rev:0, ord:0, u:0, hotRev:0, hotOrd:0, hotU:0, normRev:0, normOrd:0, normU:0 },
        MELI_CLASSIC: { rev:0, ord:0, u:0, hotRev:0, hotOrd:0, hotU:0, normRev:0, normOrd:0, normU:0 },
    };

    const rows = []; // for daily table

    for (const d of adMay.docs) {
        const data = d.data();
        const date = data.date;
        const isHot = date >= '2025-05-26';
        const row = { date, isHot };

        for (const ch of ['MELI_FULL','MELI_CLASSIC']) {
            const c = data.byChannel?.[ch] ?? {};
            const rev = c.revenue ?? 0;
            const ord = c.orders  ?? 0;
            const u   = c.units   ?? 0;
            channels[ch].rev += rev;
            channels[ch].ord += ord;
            channels[ch].u   += u;
            if (isHot) {
                channels[ch].hotRev += rev; channels[ch].hotOrd += ord; channels[ch].hotU += u;
            } else {
                channels[ch].normRev += rev; channels[ch].normOrd += ord; channels[ch].normU += u;
            }
            row[ch] = { rev, ord, u };
        }
        rows.push(row);
    }

    const mxn  = n  => '$' + Math.round(n).toLocaleString('es-MX');
    const pct  = (a,b) => b > 0 ? `${((a/b-1)*100).toFixed(0)}%` : '—';
    const normD = rows.filter(r => !r.isHot).length || 1;
    const hotD  = rows.filter(r =>  r.isHot).length || 1;

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log('  MeLi Full vs MeLi Classic — Mayo 2025');
    console.log('  Source: analytics_daily  |  ' + adMay.size + ' days');
    console.log('══════════════════════════════════════════════════════════════════');

    for (const [label, ch] of [['MELI FULL', channels.MELI_FULL], ['MELI CLASSIC', channels.MELI_CLASSIC]]) {
        const fullMult = ch.normU/normD > 0 ? (ch.hotU/hotD) / (ch.normU/normD) : 1;
        console.log(`\n  ── ${label} ─────────────────────────────────────────────────`);
        console.log(`  Total Revenue   : ${mxn(ch.rev)}`);
        console.log(`  Total Orders    : ${ch.ord}`);
        console.log(`  Total Units     : ${ch.u}`);
        console.log(`  Avg Ticket      : ${mxn(ch.ord > 0 ? ch.rev/ch.ord : 0)}`);
        console.log(`  Normal (1-25)   : ${mxn(ch.normRev)}  |  ${ch.normOrd} orders  |  ${ch.normU} u  |  avg ${mxn(ch.normRev/normD)}/day`);
        console.log(`  Hot Sale (26-31): ${mxn(ch.hotRev)}  |  ${ch.hotOrd} orders  |  ${ch.hotU} u  |  avg ${mxn(ch.hotRev/hotD)}/day`);
        console.log(`  HS Multiplier   : ×${fullMult.toFixed(2)}  (units/day)`);
    }

    // Combined total
    const full = channels.MELI_FULL, clas = channels.MELI_CLASSIC;
    const totalRev = full.rev + clas.rev;
    const totalOrd = full.ord + clas.ord;
    const totalU   = full.u   + clas.u;
    console.log(`\n  ── COMBINED MeLi (Full + Classic) ──────────────────────────────`);
    console.log(`  Total Revenue   : ${mxn(totalRev)}`);
    console.log(`  Total Orders    : ${totalOrd}`);
    console.log(`  Total Units     : ${totalU}`);
    console.log(`  Full share      : ${(full.rev/totalRev*100).toFixed(1)}% revenue  /  ${(full.u/totalU*100).toFixed(1)}% units`);
    console.log(`  Classic share   : ${(clas.rev/totalRev*100).toFixed(1)}% revenue  /  ${(clas.u/totalU*100).toFixed(1)}% units`);

    // ── Daily table ────────────────────────────────────────────────────────────
    console.log('\n  ── Daily Breakdown ──────────────────────────────────────────────');
    console.log('  Date        Full Rev.   Full U    Classic Rev.  Classic U   HS?');
    console.log('  ─────────────────────────────────────────────────────────────────');
    for (const r of rows) {
        const hs = r.isHot ? ' 🔥' : '';
        const f  = r['MELI_FULL']    ?? { rev:0, u:0 };
        const c  = r['MELI_CLASSIC'] ?? { rev:0, u:0 };
        console.log(
            `  ${r.date}` +
            `   ${mxn(f.rev).padStart(10)}  ${String(f.u).padStart(5)}` +
            `     ${mxn(c.rev).padStart(10)}  ${String(c.u).padStart(5)}` +
            hs
        );
    }

    // Totals row
    console.log('  ─────────────────────────────────────────────────────────────────');
    console.log(
        `  TOTAL       ` +
        `   ${mxn(full.rev).padStart(10)}  ${String(full.u).padStart(5)}` +
        `     ${mxn(clas.rev).padStart(10)}  ${String(clas.u).padStart(5)}`
    );
    console.log('\n══════════════════════════════════════════════════════════════════\n');
}
main().catch(console.error).finally(()=>process.exit());
