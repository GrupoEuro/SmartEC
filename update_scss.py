import re

with open('projects/internal-app/src/app/pages/operations/metrics/meli-full/meli-full-report.component.scss', 'r') as f:
    content = f.read()

# 1. Update Tabs
content = re.sub(
    r'\/\* ── Tabs ──[\s\S]*?\/\* ── KPI Grid',
    '''/* ── Tabs ─────────────────────────────────────────────────────────────────── */
.melf-tabs {
    display: inline-flex; gap: .25rem; margin-bottom: 1.5rem;
    background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-radius: 99px; padding: .35rem;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 12px rgba(0, 0, 0, 0.2);
}
.melf-tab {
    display: inline-flex; align-items: center; gap: .4rem;
    padding: .5rem 1.25rem; border-radius: 99px; font-size: .8125rem; font-weight: 600;
    color: #94a3b8; background: transparent; border: none; cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative; overflow: hidden;
}
.melf-tab:hover  { color: #e2e8f0; background: rgba(255,255,255,.05); }
.melf-tab.active { 
    color: #fff; background: rgba(99, 102, 241, 0.2); 
    box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.5), 0 0 12px rgba(99, 102, 241, 0.3);
    text-shadow: 0 0 8px rgba(255,255,255,0.3);
}
.tab-badge-alert {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    background: linear-gradient(135deg, #ef4444, #b91c1c); 
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
    color: #fff; font-size: .65rem; font-weight: 800;
    margin-left: 0.25rem;
}

/* ── KPI Grid''',
    content
)

# 2. Update KPI Grid
content = re.sub(
    r'\/\* ── KPI Grid ──[\s\S]*?\/\* ── Cards',
    '''/* ── KPI Grid ─────────────────────────────────────────────────────────────── */
.melf-kpi-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;
}
.melf-kpi {
    display: flex; flex-direction: column;
    background: linear-gradient(145deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 4px 20px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.05);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-radius: 1rem; padding: 1.25rem 1.5rem; transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    position: relative; overflow: hidden;
}
.melf-kpi::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    opacity: 0; transition: opacity 0.3s;
}
.melf-kpi:hover { 
    border-color: rgba(255,255,255,.15); 
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.1);
}
.melf-kpi:hover::before { opacity: 1; }

.mkpi-label { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; margin-bottom: .5rem; }
.mkpi-value { font-size: 1.5rem; font-weight: 800; color: #f8fafc; text-align: right; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }

/* KPI Color Variants using radial gradients for glow effects */
.melf-kpi.orange  { background: radial-gradient(circle at top right, rgba(249, 115, 22, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.orange  .mkpi-value { color: #fdba74; text-shadow: 0 0 12px rgba(249, 115, 22, 0.4); }

.melf-kpi.emerald { background: radial-gradient(circle at top right, rgba(16, 185, 129, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.emerald .mkpi-value { color: #6ee7b7; text-shadow: 0 0 12px rgba(16, 185, 129, 0.4); }

.melf-kpi.indigo  { background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.indigo  .mkpi-value { color: #a5b4fc; text-shadow: 0 0 12px rgba(99, 102, 241, 0.4); }

.melf-kpi.violet  { background: radial-gradient(circle at top right, rgba(139, 92, 246, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.violet  .mkpi-value { color: #c4b5fd; text-shadow: 0 0 12px rgba(139, 92, 246, 0.4); }

.melf-kpi.blue    { background: radial-gradient(circle at top right, rgba(59, 130, 246, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.blue    .mkpi-value { color: #93c5fd; text-shadow: 0 0 12px rgba(59, 130, 246, 0.4); }

.melf-kpi.green   { background: radial-gradient(circle at top right, rgba(34, 197, 94, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.green   .mkpi-value { color: #86efac; text-shadow: 0 0 12px rgba(34, 197, 94, 0.4); }

.melf-kpi.yellow  { background: radial-gradient(circle at top right, rgba(234, 179, 8, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.yellow  .mkpi-value { color: #fde047; text-shadow: 0 0 12px rgba(234, 179, 8, 0.4); }

.melf-kpi.red     { background: radial-gradient(circle at top right, rgba(239, 68, 68, 0.15), transparent 60%), linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); }
.melf-kpi.red     .mkpi-value { color: #fca5a5; text-shadow: 0 0 12px rgba(239, 68, 68, 0.4); }

/* ── Cards''',
    content
)

# 3. Update Cards
content = re.sub(
    r'\/\* ── Cards ──[\s\S]*?\/\* ── Listings Table',
    '''/* ── Cards ────────────────────────────────────────────────────────────────── */
.melf-card {
    background: rgba(15, 23, 42, 0.6); 
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 8px 32px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.05);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-radius: 1.25rem; padding: 1.5rem; margin-bottom: 1.5rem;
    transition: box-shadow 0.3s;
}
.melf-card:hover { box-shadow: 0 12px 40px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.08); }
.melf-card-full { width: 100%; }
.melf-card-header { margin-bottom: 1.25rem; display: flex; flex-direction: column; gap: 0.25rem; }
.melf-card-title {
    display: flex; align-items: center; gap: .6rem;
    font-size: 1.05rem; font-weight: 700; color: #f8fafc; margin: 0;
    letter-spacing: 0.01em;
}
.melf-card-sub { font-size: .8rem; color: #94a3b8; margin: 0; font-weight: 400; }
.melf-chart-wrap { height: 280px; position: relative; margin-top: 1rem; }

/* ── Listings Table''',
    content
)

# 4. Update Tables
content = re.sub(
    r'\/\* ── Listings Table ──[\s\S]*?\/\* ── Inventory',
    '''/* ── Listings Table ───────────────────────────────────────────────────────── */
.melf-table-wrap { overflow-x: auto; border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.05); }
.melf-table {
    width: 100%; border-collapse: separate; border-spacing: 0; font-size: .85rem;
}
.melf-table thead { background: rgba(0,0,0,0.2); }
.melf-table thead th {
    padding: .75rem 1rem; color: #94a3b8; font-weight: 700;
    font-size: .7rem; text-transform: uppercase; letter-spacing: .08em;
    border-bottom: 1px solid rgba(255,255,255,.08); white-space: nowrap;
}
.melf-row td {
    padding: .85rem 1rem; border-bottom: 1px solid rgba(255,255,255,.03);
    vertical-align: middle; transition: background 0.2s;
}
.melf-row:last-child td { border-bottom: none; }
.melf-row:hover td { background: rgba(255,255,255,.03); }

.listing-thumb { width: 44px; height: 44px; object-fit: contain; border-radius: .5rem; margin-right: .75rem; vertical-align: middle; background: #0f172a; border: 1px solid rgba(255,255,255,0.1); padding: 2px;}
.listing-title-wrap { display: inline-flex; flex-direction: column; vertical-align: middle; max-width: 320px; }
.listing-title { font-size: .85rem; font-weight: 600; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.listing-sku   { font-size: .7rem; color: #64748b; font-family: 'JetBrains Mono', monospace; margin-top: 0.2rem;}

.health-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 38px; border-radius: 99px; padding: .2rem .5rem; font-size: .75rem; font-weight: 800; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.health-green  { background: linear-gradient(135deg, #10b981, #059669); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.3);}
.health-yellow { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.3);}
.health-red    { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.3);}

.net-pct { display: block; font-size: .8rem; font-weight: 800; color: #34d399; }
.net-amt { display: block; font-size: .7rem; color: #94a3b8; margin-top: 0.15rem; font-family: 'JetBrains Mono', monospace;}

.win-gap-pos { color: #34d399; font-weight: 700; background: rgba(52, 211, 153, 0.1); padding: 0.2rem 0.5rem; border-radius: 0.35rem; }
.win-gap-neg { color: #f87171; font-weight: 700; background: rgba(248, 113, 113, 0.1); padding: 0.2rem 0.5rem; border-radius: 0.35rem; }

.text-right    { text-align: right; }
.text-zinc-200 { color: #e2e8f0; font-weight: 600;}
.text-zinc-300 { color: #cbd5e1; }
.text-zinc-400 { color: #94a3b8; }
.text-zinc-500 { color: #64748b; }
.text-zinc-600 { color: #475569; }
.font-medium   { font-weight: 600; }

.melf-link-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: .5rem;
    background: rgba(255,255,255,.05); color: #94a3b8;
    text-decoration: none; font-size: 1rem; transition: all .2s;
    border: 1px solid rgba(255,255,255,0.05);
}
.melf-link-btn:hover { background: rgba(255,255,255,.1); color: #f8fafc; border-color: rgba(255,255,255,0.15); transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.2);}

/* ── Inventory''',
    content
)

# 5. Potential Banner and Health Grid
content = re.sub(
    r'\/\* Potential Sales Value banner[\s\S]*?\/\* Toolbar \*\/',
    '''/* Potential Sales Value banner — sits above the health filter cards */
.inv-potential-banner {
    display: flex; align-items: stretch; gap: 0;
    background: linear-gradient(90deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%);
    border: 1px solid rgba(255,255,255,.08);
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    border-radius: 1rem; margin-bottom: 1.5rem; overflow: hidden;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.ipb-stat {
    display: flex; flex-direction: column; gap: .35rem;
    flex: 1; padding: 1.25rem 1.75rem;
    transition: background 0.3s;
}
.ipb-stat:hover { background: rgba(255,255,255,0.02); }
.ipb-label {
    display: flex; align-items: center; gap: .45rem;
    font-size: .7rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .08em; color: #94a3b8;
}
.ipb-value {
    font-size: 1.75rem; font-weight: 800;
    text-align: right; line-height: 1.1; text-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.ipb-value.orange  { color: #fdba74; text-shadow: 0 0 16px rgba(249, 115, 22, 0.4); }
.ipb-value.emerald { color: #6ee7b7; text-shadow: 0 0 16px rgba(16, 185, 129, 0.4); }
.ipb-value.violet  { color: #c4b5fd; text-shadow: 0 0 16px rgba(139, 92, 246, 0.4); }
.ipb-sub {
    font-size: .7rem; color: #64748b;
    text-align: right; font-weight: 500;
}
.ipb-divider {
    width: 1px; background: linear-gradient(to bottom, transparent, rgba(255,255,255,.1), transparent); flex-shrink: 0;
}

.inv-health-grid {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem;
    margin-bottom: 1.5rem;
}
.inv-health-card {
    display: flex; flex-direction: column; align-items: center; gap: .35rem;
    padding: 1.25rem 1rem; border-radius: 1rem; cursor: pointer; border: 1px solid rgba(255,255,255,0.05);
    background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(8px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative; overflow: hidden;
}
.inv-health-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    opacity: 0.6; transition: height 0.3s, opacity 0.3s;
}
.inv-health-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.inv-health-card:hover::before { height: 4px; opacity: 1; }

.inv-health-card.ok::before       { background: linear-gradient(90deg, #10b981, #059669); }
.inv-health-card.low::before      { background: linear-gradient(90deg, #f59e0b, #d97706); }
.inv-health-card.critical::before { background: linear-gradient(90deg, #ef4444, #dc2626); }
.inv-health-card.stockout::before { background: linear-gradient(90deg, #64748b, #475569); }
.inv-health-card.all::before      { background: linear-gradient(90deg, #6366f1, #4f46e5); }

.inv-health-card.active { background: rgba(30, 41, 59, 0.8); border-color: rgba(255,255,255,0.15); transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
.inv-health-card.active.ok       { box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2); border-color: rgba(16, 185, 129, 0.4); }
.inv-health-card.active.low      { box-shadow: 0 8px 24px rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); }
.inv-health-card.active.critical { box-shadow: 0 8px 24px rgba(239, 68, 68, 0.2);  border-color: rgba(239, 68, 68, 0.4); }
.inv-health-card.active.stockout { box-shadow: 0 8px 24px rgba(100, 116, 139, 0.2); border-color: rgba(100, 116, 139, 0.4); }
.inv-health-card.active.all      { box-shadow: 0 8px 24px rgba(99, 102, 241, 0.2);  border-color: rgba(99, 102, 241, 0.4); }

.ihc-count { font-size: 1.8rem; font-weight: 800; color: #f8fafc; line-height: 1; }
.ihc-label { font-size: .8rem; font-weight: 700; color: #e2e8f0; margin-top: 0.25rem;}
.ihc-sub   { font-size: .7rem; color: #94a3b8; font-weight: 500; }

/* Toolbar */''',
    content
)

# 6. Scenarios Section - Price Simulator
content = re.sub(
    r'\/\* ── Scenarios ──[\s\S]*?\/\* ── v2 Scenarios',
    '''/* ── Scenarios ────────────────────────────────────────────────────────────── */
.scenarios-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem; }
.scenario-card .melf-card-sub { margin-bottom: 1.25rem; font-size: 0.85rem;}

.scenario-controls { display: flex; flex-direction: column; gap: 1rem; }
.sc-label { font-size: .75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; }

.sc-select, .sc-input {
    background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,.1);
    border-radius: .75rem; color: #f8fafc; font-size: .85rem; font-weight: 500;
    padding: .65rem 1rem; outline: none; transition: border-color .2s, box-shadow .2s;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
}
.sc-select { width: 100%; }
.sc-select:focus, .sc-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.2), inset 0 2px 4px rgba(0,0,0,0.1); }

/* Custom Slider */
.sc-slider-wrap { display: flex; align-items: center; gap: 1rem; background: rgba(0,0,0,0.15); padding: 0.75rem 1rem; border-radius: 99px; border: 1px solid rgba(255,255,255,0.05); }
.sc-slider-min, .sc-slider-max { font-size: .75rem; font-weight: 700; color: #94a3b8; }
.sc-slider { 
    flex: 1; -webkit-appearance: none; appearance: none; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; cursor: pointer; outline: none;
}
.sc-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%;
    background: #6366f1; border: 3px solid #fff; box-shadow: 0 0 10px rgba(99,102,241,0.6);
    cursor: grab; transition: transform 0.1s;
}
.sc-slider::-webkit-slider-thumb:hover { transform: scale(1.1); }
.sc-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(0.95); }
.sc-pct-display { text-align: center; font-size: 1.5rem; font-weight: 800; color: #818cf8; text-shadow: 0 2px 10px rgba(99,102,241,0.3); margin-top: 0.5rem;}
.sc-pct-display.sc-pct-down { color: #34d399; text-shadow: 0 2px 10px rgba(52,211,153,0.3); }
.sc-pct-display.sc-pct-up   { color: #f87171; text-shadow: 0 2px 10px rgba(248,113,113,0.3); }

.sc-num-wrap { display: flex; align-items: center; gap: .75rem; }
.sc-input    { width: 120px; text-align: right; font-family: 'JetBrains Mono', monospace;}
.sc-unit     { font-size: .85rem; font-weight: 600; color: #64748b; }

.scenario-results { 
    display: flex; flex-direction: column; gap: .75rem; padding: 1.25rem; 
    background: linear-gradient(145deg, rgba(30, 41, 59, 0.4), rgba(15, 23, 42, 0.6)); 
    border-radius: 1rem; border: 1px solid rgba(255,255,255,0.05); 
    box-shadow: inset 0 2px 10px rgba(0,0,0,0.1);
}
.sr-row     { display: flex; justify-content: space-between; align-items: center; font-size: .85rem; }
.sr-label   { color: #94a3b8; font-weight: 600;}
.sr-value   { font-weight: 800; color: #f8fafc; font-size: 1rem; }
.sr-value.orange  { color: #fdba74; }
.sr-value.emerald { color: #6ee7b7; }
.sr-value.red     { color: #fca5a5; }

/* ── v2 Scenarios''',
    content
)

# 7. Update Scenarios Tables and Badges
content = re.sub(
    r'\/\* Context panel[\s\S]*?\/\* ── Recovery',
    '''/* Context panel */
.context-panel {
    display: flex; align-items: flex-start; gap: 1.5rem;
    margin-top: 1rem; padding-top: 1rem;
    border-top: 1px solid rgba(255,255,255,.08);
    flex-wrap: wrap;
}
.cp-thumb {
    width: 80px; height: 80px; object-fit: contain;
    border-radius: .75rem; flex-shrink: 0; background: #0f172a; border: 1px solid rgba(255,255,255,0.1); padding: 4px;
}
.cp-title-col { display: flex; flex-direction: column; gap: .35rem; min-width: 200px; flex: 1; }
.cp-title     { font-size: .95rem; font-weight: 700; color: #f8fafc; margin: 0; line-height: 1.4; }
.cp-sku       { font-size: .75rem; color: #64748b; font-family: 'JetBrains Mono', monospace;}
.cp-ml-link   { font-size: .8rem; font-weight: 600; color: #818cf8; text-decoration: none; margin-top: .35rem; display: inline-flex; align-items: center; gap: 0.25rem;}
.cp-ml-link:hover { color: #a5b4fc; text-decoration: underline; }

.cp-stats-grid {
    display: flex; flex-wrap: wrap; gap: .75rem; flex: 2;
}
.cp-stat {
    display: flex; flex-direction: column; gap: .25rem;
    background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,.06);
    border-radius: .75rem; padding: .65rem 1rem; min-width: 120px;
    box-shadow: inset 0 1px 2px rgba(255,255,255,0.02), 0 2px 4px rgba(0,0,0,0.1);
}
.cp-stat-label { font-size: .65rem; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; font-weight: 700; }
.cp-stat-val   { font-size: .95rem; font-weight: 800; color: #f8fafc; }
.cp-stat-val.orange  { color: #fdba74; }
.cp-stat-val.emerald { color: #6ee7b7; }
.cp-stat-val.red     { color: #fca5a5; }
.cp-stat-val.yellow  { color: #fde047; }
.cp-stat-val.violet  { color: #c4b5fd; }

/* Slider colors */
.sc-minus { color: #6ee7b7; }
.sc-plus  { color: #fca5a5; }

/* Win badge */
.win-badge-row { display: flex; justify-content: center; margin-top: 0.5rem; margin-bottom: 0.5rem;}
.win-badge {
    display: inline-flex; align-items: center; gap: .5rem;
    padding: .5rem 1.25rem; border-radius: 99px; font-size: .85rem; font-weight: 800;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); letter-spacing: 0.02em;
}
.win-badge.win-winning { background: linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.2)); color: #34d399; border: 1px solid rgba(16,185,129,.4); }
.win-badge.win-close   { background: linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.2));  color: #fbbf24; border: 1px solid rgba(245,158,11,.4); }
.win-badge.win-losing  { background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.2));   color: #f87171; border: 1px solid rgba(239,68,68,.4); }

/* Break-even */
.breakeven-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: .75rem 1rem; background: rgba(30,41,59,.6); border: 1px solid rgba(255,255,255,0.05);
    border-radius: .75rem; font-size: .85rem; margin-top: 0.5rem; margin-bottom: 0.5rem;
}
.be-label { color: #94a3b8; font-weight: 600; }
.be-val   { font-weight: 800; display: flex; flex-direction: column; align-items: flex-end; gap: .25rem; font-size: 1rem;}
.be-warn  { font-size: .75rem; font-weight: 700; color: #fca5a5; background: rgba(239,68,68,0.15); padding: 0.15rem 0.5rem; border-radius: 0.35rem;}

/* Profitability table */
.profit-table {
    background: rgba(15,23,42,.4); border: 1px solid rgba(255,255,255,.08);
    border-radius: .875rem; overflow: hidden; margin-top: 0.5rem; margin-bottom: 0.5rem;
}
.pt-row {
    display: grid; grid-template-columns: 1fr auto auto;
    gap: .75rem; padding: .65rem 1rem; font-size: .82rem;
    border-bottom: 1px solid rgba(255,255,255,.05);
}
.pt-row:last-child { border-bottom: none; }
.pt-header { color: #94a3b8; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; background: rgba(0,0,0,.2); }
.pt-deduct { color: #94a3b8; }
.pt-label  { color: #cbd5e1; font-weight: 500;}
.pt-total  { font-weight: 800; border-top: 1px solid rgba(255,255,255,.1) !important; background: rgba(255,255,255,0.02);}
.pt-row .text-right { text-align: right; min-width: 80px; font-family: 'JetBrains Mono', monospace;}

/* Delta chips */
.sr-delta {
    display: inline-flex; align-items: center; justify-content: center; font-size: .75rem; font-weight: 800;
    margin-left: .5rem; padding: 0.15rem 0.4rem; border-radius: 0.35rem; background: rgba(255,255,255,0.1);
    font-family: 'JetBrains Mono', monospace;
}
.emerald .sr-delta { background: rgba(16,185,129,0.15); color: #6ee7b7;}
.red .sr-delta { background: rgba(239,68,68,0.15); color: #fca5a5;}

/* Replenishment table */
.replenish-table-wrap { overflow-x: auto; max-height: 380px; overflow-y: auto; border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.05); background: rgba(15,23,42,0.3);}
.replenish-table {
    width: 100%; border-collapse: separate; border-spacing: 0; font-size: .82rem;
}
.replenish-table thead th {
    position: sticky; top: 0; z-index: 1;
    padding: .65rem .85rem;
    background: rgba(15,23,42,.95); backdrop-filter: blur(8px);
    color: #94a3b8; font-weight: 700; font-size: .7rem; text-transform: uppercase;
    letter-spacing: .08em; border-bottom: 1px solid rgba(255,255,255,.08); white-space: nowrap;
}
.replenish-active td { background: rgba(16,185,129,.08) !important; }

.alert-dot {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,0.5);
}
.alert-dot.alert-ok       { background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.6); }
.alert-dot.alert-low      { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.6); }
.alert-dot.alert-critical { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.6); }
.alert-dot.alert-stockout { background: #64748b; }

.replenish-qty-input {
    width: 76px; text-align: right;
    background: rgba(15,23,42,.6); border: 1px solid rgba(255,255,255,.15);
    border-radius: .5rem; color: #f8fafc; font-size: .85rem; font-weight: 700;
    padding: .35rem .6rem; outline: none; transition: all .2s;
    font-family: 'JetBrains Mono', monospace;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
}
.replenish-qty-input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.2), inset 0 2px 4px rgba(0,0,0,0.1); }

.replenish-cost { color: #93c5fd; font-weight: 800; font-size: .85rem; font-family: 'JetBrains Mono', monospace;}

/* Replenishment footer */
.replenish-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.25rem 0 0; margin-top: 1.25rem;
    border-top: 1px solid rgba(255,255,255,.08); flex-wrap: wrap; gap: 1rem;
}
.rf-stats { display: flex; gap: 2rem; }
.rf-stat  { display: flex; flex-direction: column; gap: .25rem; }
.rf-label { font-size: .7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
.rf-val   { font-size: 1.15rem; font-weight: 800; color: #f8fafc; }
.rf-val.orange { color: #fdba74; }

.sc-export-btn {
    display: inline-flex; align-items: center; gap: .5rem;
    padding: .65rem 1.25rem; border-radius: .75rem;
    background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.25)); border: 1px solid rgba(16,185,129,.4);
    color: #6ee7b7; font-size: .85rem; font-weight: 800; cursor: pointer;
    transition: all .2s; box-shadow: 0 4px 12px rgba(16,185,129,0.1);
}
.sc-export-btn:hover:not(:disabled) { background: linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.35)); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16,185,129,0.2);}
.sc-export-btn:disabled { opacity: .4; cursor: not-allowed; filter: grayscale(1); }

/* Opportunity Matrix */
.matrix-legend {
    display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem; background: rgba(0,0,0,0.1); padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.05);
}
.ml-item { font-size: .78rem; color: #cbd5e1; font-weight: 500; display: flex; align-items: center; gap: 0.3rem;}

.matrix-wrap { height: 360px; margin-top: 1rem;}

/* Color helpers used in context panel */
.orange { color: #fdba74; }
.emerald { color: #6ee7b7; }
.red    { color: #fca5a5; }
.yellow { color: #fde047; }
.violet { color: #c4b5fd; }
.font-medium { font-weight: 600; }

/* ── Recovery''',
    content
)

with open('projects/internal-app/src/app/pages/operations/metrics/meli-full/meli-full-report.component.scss', 'w') as f:
    f.write(content)

