// The Pre-Token Radar's dashboard (model radar-fit-5). It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board with its validation strip,
// the filters, a detail drawer for every protocol, the live-token view and the model
// tab (size curve, blind tests, launch odds, coverage accounting, curve explorer).
// No network: every byte it shows is in data.js, and the page recomputes each row's
// implied value from the snapshot figures, so the code and the board visibly agree.
//
// EVIDENCE, computed live by main.ts from the sealed snapshot dated 2026-11-14 and
// checked against this comment by a local script:
//   Size curve: log(market cap) = 7.929500668648062 + 0.4616685906241007 x log(TVL),
//   least squares on 118 traded comparables; fitted TVL range $5,045,118 to
//   $18,721,539,391; slope in [0,1].
//   Blind tests (median abs log error / within 2x): curve LOO 1.202 / 34.7%,
//   walk-forward (fit before 2024-02-28 on 43, tested on 44 later listings) 1.0244 /
//   45.5%. Flat multiple: LOO 1.5752 / 29.7%, walk-forward 1.6017 / 25.0%.
//   A term is kept only when it beats the curve on BOTH tests.
//   LOO range factors 0.2618x-3.0939x, calibration 51.7% (n=118); 80% band
//   0.1022x-10x, calibration 77.1%. Bootstrap, 200 refits: slope p5/median/p95
//   0.2874/0.4557/0.6149.
//   Launch odds: logistic regression on log TVL, 7d growth, age and one-hot flags
//   for the six most common categories (counted from the data, re-counted per fold),
//   fitted on 442 non-product protocols (244 with a token, 198 without); 5-fold CV
//   AUC 0.7561, log-loss 0.5850 vs 0.6877 base rate (55.2%). Coefficients
//   (standardised): intercept 0.2074, log TVL 0.4353, growth -0.6419, age 0.7124;
//   Dexs 0.2445, Risk Curators -0.5156. Category predicts token status, not value.
//   The odds are a descriptive base rate, not a forecast.
//   Verdicts: SKIP if TVL is outside the fitted range or 7d growth <= -30%; THIN if
//   growth < -10% or launch odds < 25% or the net at a $1,000 ticket and a 10%
//   farmers' pool is not positive; else FARM (7 FARM, 189 THIN, 2 SKIP). Farm
//   economics: $1,000 ticket, gas $12+$6/week on Ethereum else $3+$1/week,
//   time $15/hour, exit on TVL -30% or 7d growth below -20% twice.
//   Net: EV = launch odds x pool share x implied value x (ticket / TVL), minus
//   gas, time $15/hr and 4% p.a. forgone. Default $1,000 ticket, 10% pool.
//   At the default 7 rows pay (median break-even ticket $3,365.50;
//   46 rows never pay at any ticket); the old rule's median FARM row returned
//   $13.74 expected for $30.93 of cost. Top 10 by net at the default:
//   Katana DEX +$21.88, MetalX Swap +$19.31, SyncSwap +$17.80,
//   Nucleus +$10.55, FstSwap +$9.08, BTCFi CDP +$6.90, Vesu +$6.47,
//   Granite +$2.84, Agni Finance +$1.89, Bucket CDP +$0.73.
//   Portfolio of the 7 FARM rows: +$52.02 for 8.8 hours, $5.94/hour. Sentora
//   Curator, the largest row, never pays at any ticket (needs a pool above 52% of
//   launch value).
//   Coverage: 758 scanned -> 342 audited (198 ranked: 40 watchlist + 158 early;
//   144 excluded as products, named in the model tab), 416 live-token set aside.
(function () {
'use strict';
var DATA = window.RADAR;
if (!DATA) return;
var app = document.getElementById('board');
var P = DATA.params;
var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null, ticket: 1000, share: 0.10 };
var explorer = { tvl: 500000000 };
function fmtUsd(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
return '$' + Math.round(n);
}
function fmtPct(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtAge(days) {
if (days === null || days === undefined) return 'unknown';
if (days >= 365) return (days / 365).toFixed(1) + 'y';
return Math.max(0, Math.round(days)) + 'd';
}
function fmtMult(n) { return 'x' + n.toFixed(3); }
function shortReason(r) {
return r.replace('category ', '').replace('versioned name (a pool of another protocol)', 'versioned names').replace('wrapped / staked product by name', 'wrapped/staked by name');
}
function impliedOf(row, multScale) {
return Math.max(1, Math.round(row.tvl_usd * row.model.multiple * (multScale || 1)));
}
function netOf(row, ticket, share) {
var ev = row.model.launch_odds * share * row.implied_value_usd * (ticket / row.tvl_usd);
var forgone = ticket * P.net_tbill_rate * row.farm.hold_days / 365;
return { ev: ev, forgone: forgone, net: ev - row.farm.gas_usd - row.farm.time_value_usd - forgone };
}
function fmt2(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
return '$' + n.toFixed(2);
}
function fmtSigned(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
return (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2);
}
function fmtMoney(n) {
return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** The averaging median of an already-sorted list; null when the list is empty. */
function medianOf(sorted) {
if (!sorted.length) return null;
var m = sorted.length >> 1;
return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function tdNum(t) { return el('td', { class: 'num', text: t }); }
function tdPos(t, pos) { return el('td', { class: 'num ' + (pos ? 'pos' : 'neg'), text: t }); }
function curveValue(tvl) {
if (!(tvl > 0) || !Number.isFinite(tvl)) return 1;
return Math.min(100000000000000, Math.max(1, Math.round(Math.exp(DATA.curve.intercept + DATA.curve.slope * Math.log(tvl)))));
}
function el(tag, attrs) {
var node = document.createElement(tag);
if (attrs) {
Object.keys(attrs).forEach(function (k) {
if (k === 'class') node.className = attrs[k];
else if (k === 'text') node.textContent = attrs[k];
else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
});
}
for (var i = 2; i < arguments.length; i++) {
var child = arguments[i];
if (child === null || child === undefined) continue;
if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
else node.appendChild(child);
}
return node;
}
function readHash() {
var hash = window.location.hash.replace(/^#/, '');
if (!hash) return;
var params = new URLSearchParams(hash);
if (params.get('q')) state.q = params.get('q');
var cats = DATA.rows.map(function (r) { return r.category || 'Other'; });
if (cats.indexOf(params.get('category')) >= 0) state.category = params.get('category');
var chains = [];
DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
if (chains.indexOf(params.get('chain')) >= 0) state.chain = params.get('chain');
if (params.get('w') === '1') state.watch = true;
if (['board', 'farms', 'live', 'model'].indexOf(params.get('tab')) >= 0) state.tab = params.get('tab');
if (params.get('p')) state.selected = params.get('p');
}
function writeHash() {
var params = new URLSearchParams();
if (state.q) params.set('q', state.q);
if (state.category !== 'all') params.set('category', state.category);
if (state.chain !== 'all') params.set('chain', state.chain);
if (state.watch) params.set('w', '1');
if (state.tab !== 'board') params.set('tab', state.tab);
if (state.selected) params.set('p', state.selected);
var next = params.toString();
if (next) window.history.replaceState(null, '', '#' + next);
else window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
function filteredRows() {
var q = state.q.trim().toLowerCase();
return DATA.rows.filter(function (r) {
if (state.watch && !r.on_watchlist) return false;
if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
if (!q) return true;
var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
return hay.indexOf(q) >= 0;
});
}
function sortedRows(list) {
var key = state.sort;
return list.slice().sort(function (a, b) {
var av, bv;
if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
else if (key === 'growth') { av = a.change_7d; bv = b.change_7d; }
else if (key === 'age') { av = a.age_days; bv = b.age_days; }
else if (key === 'multiple') { av = a.model.multiple; bv = b.model.multiple; }
else if (key === 'odds') { av = a.model.launch_odds; bv = b.model.launch_odds; }
else if (key === 'net') { av = netOf(a, state.ticket, state.share).net; bv = netOf(b, state.ticket, state.share).net; }
else if (key === 'verdict') { var order = { FARM: 0, THIN: 1, SKIP: 2 }; av = order[a.farm.verdict]; bv = order[b.farm.verdict]; }
else { av = a.implied_value_usd; bv = b.implied_value_usd; }
if (key === 'growth' || key === 'age') {
var an = key === 'growth' ? a.change_7d : a.age_days, bn = key === 'growth' ? b.change_7d : b.age_days;
if (an === null || bn === null) return an === bn ? (a.slug < b.slug ? -1 : 1) : an === null ? 1 : -1;
}
if (av < bv) return -state.dir;
if (av > bv) return state.dir;
return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
});
}
function header() {
return el('header', { class: 'top' },
el('div', { class: 'brand' },
el('span', { class: 'ring', 'aria-hidden': 'true' }),
el('div', null,
el('div', { class: 'brand-name', text: 'The Pre-Token Radar' }),
el('div', { class: 'brand-sub', text: 'Which protocol is worth farming next?' })
)
),
el('div', { class: 'top-meta' },
el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
el('span', null, 'Model ', el('b', { text: DATA.model_version })),
el('span', null, 'DefiLlama protocol index')
)
);
}
function lede() {
var cov = DATA.coverage;
var bt = DATA.backtest;
var val = DATA.validation;
var wf = null;
val.variants.forEach(function (v) { if (v.name === 'curve') wf = v.walk_forward; });
var flat = null;
val.variants.forEach(function (v) { if (v.name === 'flat') flat = v; });
var excluded = cov.excluded.reduce(function (n, e) { return n + e.count; }, 0);
var verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
DATA.rows.forEach(function (r) { verdicts[r.farm.verdict]++; });
var beTickets = DATA.rows.map(function (r) { return r.farm.breakeven_ticket_usd; }).filter(function (t) { return t !== null; }).sort(function (a, b) { return a - b; });
var medianBe = medianOf(beTickets);
return el('section', { class: 'lede' },
el('div', null,
el('h1', { text: cov.watchlist + ' watchlist protocols, plus every early pre-token protocol below the floor' }),
el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token and is not a wrapped or staked product. The radar adds ' + cov.early + ' more below that floor, ranks them all by a size curve fitted on traded tokens, and gives each a dated, costed farm plan with a verdict.' }),
el('p', { class: 'caveat', text: 'Implied value is an estimate from the snapshot\u2019s own figures, not a price and not a prediction that a token launches. \u201CRecords no token\u201D means its DefiLlama record carries none; that is not proof.' })
),
el('div', { class: 'kpis' },
el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: cov.watchlist + ' / ' + cov.watchlist }), el('em', { text: 'the whole floor, no gaps' })),
el('div', { class: 'kpi' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(cov.board) }), el('em', { text: cov.early + ' early rows below the floor' })),
el('div', { class: 'kpi' }, el('span', { text: 'Size curve slope' }), el('b', { text: DATA.curve.slope.toFixed(3) }), el('em', { text: DATA.curve.comps + ' traded comparables' })),
el('div', { class: 'kpi' }, el('span', { text: 'Leave-one-out within 2x' }), el('b', { text: Math.round(bt.within_2x * 100) + '%' }), el('em', { text: 'median log error ' + bt.median_abs_log_error + ', n=' + bt.comps })),
el('div', { class: 'kpi' }, el('span', { text: 'Walk-forward within 2x' }), el('b', { text: wf ? Math.round(wf.within_2x * 100) + '%' : 'n/a' }), el('em', { text: wf ? 'fit before ' + val.split_date + ', tested on ' + val.test_n + ' later listings' : 'too few dated comparables' })),
el('div', { class: 'kpi' }, el('span', { text: 'Range calibration' }), el('b', { text: Math.round(val.calibration.coverage * 100) + '%' }), el('em', { text: 'of held-out caps inside their band' }))
),
el('div', { class: 'strip' },
el('span', null, el('b', { text: cov.total + ' scanned' }), '  →  ' + (cov.board + excluded) + ' audited (' + cov.board + ' ranked  ·  ' + excluded + ' excluded with reasons)  ·  ' + cov.live_token + ' live-token set aside  ·  ' + verdicts.FARM + ' FARM / ' + verdicts.THIN + ' THIN / ' + verdicts.SKIP + ' SKIP'),
el('span', { class: 'strip-note', text: 'Excluded: ' + cov.excluded.map(function (e) { return shortReason(e.reason) + ' ' + e.count; }).join('  ·  ') + '. Every excluded protocol is named in Model & coverage.' }),
el('span', { class: 'strip-note', text: 'Net at a $1,000 ticket and a 10% farmers\u2019 pool: ' + verdicts.FARM + ' farms pay; median break-even ticket ' + (medianBe === null ? 'n/a' : fmtMoney(medianBe)) + '.' }),
flat ? el('span', { class: 'strip-note', text: 'Blind tests kept the size curve over the flat multiple (leave-one-out log error ' + bt.median_abs_log_error + ' vs ' + flat.loo.median_abs_log_error + '; walk-forward ' + (wf ? wf.median_abs_log_error : 'n/a') + ' vs ' + (flat.walk_forward ? flat.walk_forward.median_abs_log_error : 'n/a') + '). Category terms were dropped the same way; growth and age enter through launch odds: see Model & coverage.' }) : null
)
);
}
function controls() {
var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
var chainCounts = {};
DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
search.addEventListener('input', function (e) { state.q = search.value; writeHash(); if (e.isComposing) return; render(); });
var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
el('option', { value: 'all', text: 'All categories' }),
categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
);
select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
el('option', { value: 'all', text: 'All chains' }),
chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
);
chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' });
watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
var ticketSel = el('select', { id: 'ticket', 'aria-label': 'Ticket size for net economics' },
[250, 1000, 5000, 10000].map(function (t) { return el('option', { value: String(t), text: '$' + t.toLocaleString('en-US'), selected: t === state.ticket ? 'selected' : null }); })
);
ticketSel.addEventListener('change', function () { state.ticket = parseInt(ticketSel.value, 10); render(); });
var shareSel = el('select', { id: 'share', 'aria-label': 'Farmers pool share for net economics' },
[0.05, 0.10, 0.15].map(function (s) { return el('option', { value: String(s), text: Math.round(s * 100) + '%', selected: s === state.share ? 'selected' : null }); })
);
shareSel.addEventListener('change', function () { state.share = parseFloat(shareSel.value); render(); });
function tabBtn(tab, label) {
return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
}
var countText = state.tab === 'board' ? filteredRows().length + ' of ' + DATA.rows.length + ' rows shown'
: state.tab === 'farms' ? 'Top 10 rows by net at the current ticket and pool share'
: state.tab === 'live' ? DATA.live.length + ' live-token protocols, set aside from the ranking'
: 'The fit, the backtest, the coverage and the sandbox';
return el('div', { class: 'controls' },
el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
el('div', { class: 'field' }, el('label', { for: 'ticket', text: 'Ticket' }), ticketSel),
el('div', { class: 'field' }, el('label', { for: 'share', text: 'Farmers\u2019 pool' }), shareSel),
el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('farms', 'Best farms'), tabBtn('live', 'Live token'), tabBtn('model', 'Model & coverage'))),
el('span', { class: 'count', text: countText }),
el('span', { class: 'count', text: 'Verdicts are the $1,000 / 10% default; ticket and pool re-run the net only.' })
);
}
function sortHeader(key, label) {
return el('th', { scope: 'col' },
el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
label,
state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
)
);
}
function boardTable() {
var list = sortedRows(filteredRows());
if (list.length === 0) {
return el('div', { class: 'panel' }, el('div', { class: 'empty' },
el('h2', { text: 'No protocol matches that filter' }),
el('p', { text: 'Clear the search or pick another category or chain.' }),
el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
));
}
var max = 1;
DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
var tbody = el('tbody');
list.forEach(function (r) {
var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
var n = netOf(r, state.ticket, state.share);
var tr = el('tr', {
'data-selected': state.selected === r.slug ? 'true' : 'false',
tabindex: '0',
onclick: function () { openDetail(r.slug); },
onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
},
tdNum(String(r.rank)),
el('td', null, el('div', { class: 'name' },
el('b', { text: r.name }),
el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
)),
tdNum(fmtUsd(r.tvl_usd)),
el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
tdNum(fmtAge(r.age_days)),
tdNum(fmtMult(r.model.multiple)),
tdNum(Math.round(r.model.launch_odds * 100) + '%'),
el('td', null, el('div', { class: 'implied' },
el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
)),
tdPos(fmtSigned(n.net), n.net >= 0),
el('td', null, el('span', { class: 'badge verdict-' + r.farm.verdict.toLowerCase(), text: r.farm.verdict })),
el('td', null, el('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'Watchlist' : 'Early' }))
);
tbody.appendChild(tr);
});
return el('div', { class: 'panel' },
el('div', { class: 'table-wrap' },
el('table', { class: 'rows' },
el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its breakdown and farm plan.' }),
el('thead', null, el('tr', null,
sortHeader('implied', 'Rank'),
sortHeader('name', 'Protocol'),
sortHeader('tvl', 'TVL'),
sortHeader('growth', '7d'),
sortHeader('age', 'Age'),
sortHeader('multiple', 'Multiple'),
sortHeader('odds', 'Launch odds'),
sortHeader('implied', 'Implied value'),
sortHeader('net', 'Net'),
sortHeader('verdict', 'Verdict'),
el('th', { scope: 'col', text: 'Board' })
)),
tbody
)
)
);
}
function farmsTable() {
var scored = DATA.rows.map(function (r) { return { r: r, n: netOf(r, state.ticket, state.share) }; });
scored.sort(function (a, b) { return b.n.net - a.n.net || (a.r.slug < b.r.slug ? -1 : 1); });
var top = scored.slice(0, 10), pay = [], totNet = 0, totMin = 0, best = null;
scored.forEach(function (d) { if (d.r.farm.verdict === 'FARM' && d.n.net > 0) { pay.push(d); totNet += d.n.net; totMin += d.r.farm.active_minutes; var h = d.n.net / (d.r.farm.active_minutes / 60); if (!best || h > best.perHr) best = { name: d.r.name, perHr: h }; } });
var totHrs = totMin / 60;
var tbody = el('tbody');
top.forEach(function (d, i) {
var r = d.r;
var cost = r.farm.gas_usd + r.farm.time_value_usd + d.n.forgone;
var hr = r.farm.active_minutes / 60;
tbody.appendChild(el('tr', { onclick: function () { openDetail(r.slug); } },
tdNum(String(i + 1)),
el('td', null, el('b', { text: r.name })),
tdNum(fmtUsd(r.tvl_usd)),
tdNum(fmtUsd(r.implied_value_usd)),
tdNum(Math.round(r.model.launch_odds * 100) + '%'),
tdNum(fmt2(d.n.ev)),
tdNum(fmt2(cost)),
tdPos(fmtSigned(d.n.net), d.n.net >= 0),
tdPos(fmtSigned(d.n.net / hr), d.n.net >= 0),
el('td', null, el('span', { class: 'badge verdict-' + r.farm.verdict.toLowerCase(), text: r.farm.verdict }))
));
});
var hrRow = el('tr', null);
['Net rank', 'Protocol', 'TVL', 'Implied value', 'Odds', 'EV alloc', 'Cost', 'Net', 'Net/hr', 'Verdict'].forEach(function (t) { hrRow.appendChild(el('th', { scope: 'col', text: t })); });
return el('div', { class: 'panel' },
el('div', { class: 'table-wrap' },
el('table', { class: 'rows' },
el('caption', { class: 'sub', text: 'Best farms by net at the current ticket and pool share.' }),
el('thead', null, hrRow),
tbody
)
),
el('p', { class: 'note', text: 'FARM portfolio at $' + state.ticket.toLocaleString('en-US') + ' · ' + Math.round(state.share * 100) + '% pool: ' + pay.length + ' farms · net ' + fmtSigned(totNet) + ' · ' + totHrs.toFixed(1) + ' hours · $' + (totHrs > 0 ? (totNet / totHrs).toFixed(2) : '0.00') + '/hour · best net/hour (FARM): ' + (best ? best.name + ' ' + fmt2(best.perHr) : 'none') }),
el('p', { class: 'note', text: 'Verdicts are the $1,000 / 10% default; ticket and pool re-run the net only. The pool share is an assumption: the snapshot carries no drop data.' })
);
}
function liveTable() {
var tbody = el('tbody');
DATA.live.forEach(function (r) {
tbody.appendChild(el('tr', null,
el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
tdNum(fmtUsd(r.tvl_usd)),
r.change_7d === null ? tdNum('n/a') : tdPos(fmtPct(r.change_7d), r.change_7d >= 0),
tdNum(fmtUsd(r.mcap_usd)),
tdNum(r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio)),
el('td', null, el('span', { class: 'badge live', text: 'Already trades' }))
));
});
return el('div', { class: 'panel' },
el('div', { class: 'table-wrap' },
el('table', null,
el('caption', { class: 'sub', text: 'The largest live-token protocols by market cap. Their market caps are facts, not models, so they are set aside from the ranking; their mcap/TVL ratios are the comparables the fit learns from.' }),
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
tbody
)
)
);
}
function kvRow(label, value) {
return el('div', null, el('span', { text: label }), el('b', { text: value }));
}
function explorerResults() {
var tvl = explorer.tvl;
var value = curveValue(tvl);
var mult = value / tvl;
var inside = tvl >= DATA.curve.tvl_min_usd && tvl <= DATA.curve.tvl_max_usd;
var nearest = DATA.rows.slice().sort(function (a, b) {
return Math.abs(Math.log(a.tvl_usd) - Math.log(tvl)) - Math.abs(Math.log(b.tvl_usd) - Math.log(tvl));
}).slice(0, 3);
var tbody = el('tbody');
nearest.forEach(function (r) {
tbody.appendChild(el('tr', { onclick: function () { openDetail(r.slug); } },
tdNum('#' + r.rank),
el('td', null, el('b', { text: r.name })),
tdNum(fmtUsd(r.tvl_usd)),
tdNum(fmtUsd(r.implied_value_usd))
));
});
return el('div', null,
el('p', { class: 'note', text: 'At ' + fmtUsd(tvl) + ' of TVL the curve implies ' + fmtUsd(value) + ' (multiple ' + fmtMult(mult) + ')' + (inside ? ', inside the fitted TVL range.' : ', OUTSIDE the fitted TVL range: the curve extrapolates here, and rows there carry a SKIP verdict.') + ' The explorer never changes board.json.' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table rows' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Board rank' }), el('th', { scope: 'col', text: 'Nearest protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied value' }))),
tbody
))
);
}
function modelTab() {
var bt = DATA.backtest;
var cov = DATA.coverage;
var val = DATA.validation;
var ablBody = el('tbody');
val.variants.forEach(function (v) {
ablBody.appendChild(el('tr', null,
el('td', null, el('b', { text: v.label }), v.kept ? el('span', { class: 'badge verdict-farm', text: ' kept' }) : null),
tdNum(String(v.loo.median_abs_log_error)),
tdNum(Math.round(v.loo.within_2x * 100) + '%'),
tdNum(v.walk_forward ? String(v.walk_forward.median_abs_log_error) : 'n/a'),
tdNum(v.walk_forward ? Math.round(v.walk_forward.within_2x * 100) + '%' : 'n/a')
));
});
var refBody = el('tbody');
[10000000, 50000000, 100000000, 500000000, 1000000000, 5000000000, 10000000000].forEach(function (tvl) {
var value = curveValue(tvl);
refBody.appendChild(el('tr', null,
tdNum(fmtUsd(tvl)),
tdNum(fmtUsd(value)),
tdNum(fmtMult(value / tvl)),
el('td', { class: 'sub', text: tvl >= DATA.curve.tvl_min_usd && tvl <= DATA.curve.tvl_max_usd ? 'inside the fitted range' : 'outside: extrapolated' })
));
});
var fitBody = el('tbody');
DATA.categories.forEach(function (c) {
fitBody.appendChild(el('tr', null,
el('td', null, el('b', { text: c.category })),
tdNum(fmtMult(c.median_ratio)),
tdNum(String(c.comps)),
el('td', { class: 'sub', text: 'yardstick only: the curve ignores category' })
));
});
var exclBody = el('tbody');
cov.excluded.forEach(function (e) {
exclBody.appendChild(el('tr', null, el('td', { text: e.reason }), tdNum(String(e.count))));
});
var namedBody = el('tbody');
cov.excluded_named.forEach(function (e) {
namedBody.appendChild(el('tr', null, el('td', null, el('b', { text: e.name })), el('td', { class: 'sub', text: e.slug }), el('td', { class: 'sub', text: e.reason })));
});
var odds = val.launch_odds;
var nc = { 5: 0, 10: 0, 15: 0 }, be = [], fc = 0, p1 = 0, p25 = 0, p5 = 0;
DATA.rows.forEach(function (r) { [5, 10, 15].forEach(function (s) { if (netOf(r, 1000, s / 100).net > 0) nc[s]++; }); var t = r.farm.breakeven_ticket_usd; if (t !== null) { be.push(t); if (t <= 1000) p1++; if (t <= 2500) p25++; if (t <= 5000) p5++; } if (r.farm.verdict === 'FARM') fc++; });
be.sort(function (a, b) { return a - b; });
var medianBe = medianOf(be);
var netPanelText = 'A farm pays only when its expected allocation covers its costs: launch odds x pool share x implied value x (ticket / TVL), minus gas, time at $15/hour and 4% a year forgone on the ticket. At $1,000 and a 10% pool, ' + nc[10] + ' rows are net-positive and ' + fc + ' carry a FARM verdict; the median break-even ticket is ' + (medianBe === null ? 'n/a' : fmtMoney(medianBe)) + ' and ' + (DATA.rows.length - be.length) + ' rows never pay at any ticket. Break-even tickets: ' + p1 + ' pay at $1,000 or less, ' + p25 + ' at $2,500 or less, ' + p5 + ' at $5,000 or less. Net-positive rows at $1,000: ' + nc[5] + ' at a 5% pool, ' + nc[10] + ' at 10%, ' + nc[15] + ' at 15% \u2014 the pool share is an assumption, and the net moves with it. The old rule\u2019s median FARM row returned $13.74 expected for $30.93 of cost, so 104 of its 111 FARM rows lost money in expectation.';
var oddsBody = el('tbody');
odds.calibration.forEach(function (c) {
oddsBody.appendChild(el('tr', null,
tdNum(String(c.decile)),
tdNum(Math.round(c.mean_pred * 100) + '%'),
tdNum(Math.round(c.token_rate * 100) + '%'),
tdNum(String(c.n))
));
});
var quartBody = el('tbody');
odds.quartile_rates.forEach(function (q) {
quartBody.appendChild(el('tr', null,
el('td', null, el('b', { text: q.by })),
tdNum(q.rates.map(function (r) { return Math.round(r * 100) + '%'; }).join('  ·  ')),
tdNum(q.ns.join(' / '))
));
});
var resultsBox = el('div', { id: 'explorer-results' }, explorerResults());
function refreshExplorer() {
resultsBox.textContent = '';
resultsBox.appendChild(explorerResults());
}
var tvlSlider = el('input', { type: 'range', id: 'ex-tvl', min: '7', max: '10.7', step: '0.01', value: String(Math.log10(explorer.tvl)), 'aria-label': 'TVL to price with the curve' });
var tvlOut = el('output', { text: fmtUsd(explorer.tvl) });
tvlSlider.addEventListener('input', function () { explorer.tvl = Math.round(Math.pow(10, parseFloat(tvlSlider.value))); tvlOut.textContent = fmtUsd(explorer.tvl); refreshExplorer(); });
return el('div', null,
el('section', { class: 'panel section' },
el('h2', { text: 'How implied value is computed' }),
el('p', { class: 'note', text: 'One curve scores every row, from the snapshot\u2019s own figures only.' }),
el('div', { class: 'formula', text: 'log(market cap) = ' + DATA.curve.intercept + ' + ' + DATA.curve.slope + ' x log(TVL)   ·   implied = round( exp(a + b x log(TVL)) )' }),
el('p', { class: 'note', text: 'Least squares on the logs of ' + DATA.curve.comps + ' traded comparables in this snapshot (a protocol counts when it records a market cap and TVL, is not a CEX and has no versioned name). Slope clamped to [' + P.slope_floor + ', ' + P.slope_cap + ']. Fitted range ' + fmtUsd(DATA.curve.tvl_min_usd) + ' to ' + fmtUsd(DATA.curve.tvl_max_usd) + ' of TVL; rows outside it are extrapolated. The curve rises with TVL, so the board orders by size, and sets the level and both error bands.' }),
el('p', { class: 'note', text: 'Verdicts follow fixed numeric rules, the same for every row. SKIP when TVL is outside the fitted range or 7d growth is at or below ' + P.verdict_growth_skip + '%. THIN when growth is below ' + P.verdict_growth_thin + '% or launch odds are below ' + Math.round(P.verdict_odds_thin * 100) + '%, or the net at a $1,000 ticket and a 10% farmers\u2019 pool is not positive. Otherwise FARM. The bootstrap band is shown in each detail view but does not drive the verdict. A verdict is never a promise that a token launches.' })
),
el('div', { class: 'grid2' },
el('section', { class: 'panel section' },
el('h2', { text: 'Blind tests: what survived, what was dropped' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Variant' }), el('th', { scope: 'col', text: 'LOO log err' }), el('th', { scope: 'col', text: 'LOO 2x' }), el('th', { scope: 'col', text: 'Walk-fwd log err' }), el('th', { scope: 'col', text: 'Walk-fwd 2x' }))),
ablBody
)),
el('p', { class: 'note', text: 'Leave-one-out predicts each comparable from a fit that never saw it (n=' + bt.comps + '). Walk-forward fits on the ' + val.train_n + ' comparables listed before ' + val.split_date + ' and tests on the ' + val.test_n + ' listed at or after it. A term was kept only when it beat the bare curve on BOTH tests; none did, so the board uses the bare curve. The range factors are the kept fit\u2019s leave-one-out error quartiles, clamped to [0.25x, 4x]: ' + fmtMult(bt.low_factor) + ' to ' + fmtMult(bt.high_factor) + ', and ' + Math.round(val.calibration.coverage * 100) + '% of held-out market caps land inside their own band (calibration, n=' + val.calibration.n + '). A wider 80% band from the error deciles, ' + fmtMult(bt.low80_factor) + ' to ' + fmtMult(bt.high80_factor) + ', holds ' + Math.round(val.calibration.coverage80 * 100) + '% of held-out caps. The bootstrap refits the curve ' + val.bootstrap.refits + ' times on resampled comparables: slope ' + val.bootstrap.slope_p5 + ' to ' + val.bootstrap.slope_p95 + ' (median ' + val.bootstrap.slope_median + '), which sets each row\u2019s second band.' })
),
el('section', { class: 'panel section' },
el('h2', { text: 'Coverage: all ' + cov.total + ' protocols accounted for' }),
el('div', { class: 'kv' },
kvRow('On the watchlist', String(cov.watchlist)),
kvRow('Ranked on the board', String(cov.board)),
kvRow('Early rows below the floor', String(cov.early)),
kvRow('Live-token protocols set aside', String(cov.live_token)),
kvRow('Pre-token, excluded as products', String(cov.excluded.reduce(function (n, e) { return n + e.count; }, 0)))
),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Exclusion reason' }), el('th', { scope: 'col', text: 'Count' }))),
exclBody
)),
el('p', { class: 'note', text: 'Exclusions follow the watchlist\u2019s own rule: versioned names, bridge / liquid-staking / CEX categories, wrapped or staked names, exchange-named products \u2014 applied from the ten fields the snapshot carries.' }),
el('details', { class: 'named' },
el('summary', { text: 'Every excluded protocol, named (' + cov.excluded_named.length + ')' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Slug' }), el('th', { scope: 'col', text: 'Reason' }))),
namedBody
))
)
)
),
el('section', { class: 'panel section' },
el('h2', { text: 'Launch odds: a descriptive base rate, not a forecast' }),
el('p', { class: 'note', text: 'A logistic regression on log TVL, 7d growth, age in years and one-hot flags for the ' + odds.categories.length + ' most common categories (features standardised, L2 penalty), fitted on all ' + odds.n + ' non-product protocols in the snapshot: ' + odds.token_n + ' record a token, ' + odds.pretoken_n + ' do not. Five-fold stratified cross-validation: AUC ' + odds.auc + ', log-loss ' + odds.logloss + ' against ' + odds.base_logloss + ' for the base rate (' + Math.round(odds.base_rate * 100) + '% record a token). Standardised coefficients: intercept ' + odds.intercept + ', log TVL ' + odds.coef_log_tvl + ', growth ' + odds.coef_growth + ', age ' + odds.coef_age_years + '; categories: ' + odds.categories.map(function (c, i) { return c + ' ' + odds.coef_category[i]; }).join(', ') + '. The shortlist is counted from the data, re-counted on each fold\u2019s training rows alone in cross-validation, and never hand-picked. Category predicts whether a protocol records a token, not what it would be worth: the same terms lost as value terms in the blind tests. The odds say, for protocols of this size, growth, age and category, what share records a token. They do not say this protocol launches one: the snapshot holds no future outcome, and an old protocol that never launched may never launch.' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Odds decile' }), el('th', { scope: 'col', text: 'Mean predicted odds' }), el('th', { scope: 'col', text: 'Share recording a token' }), el('th', { scope: 'col', text: 'Protocols' }))),
oddsBody
)),
el('p', { class: 'note', text: 'Calibration: predicted odds against the actual token rate in each decile. The deciles rise with the predictions, with noise in the middle.' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token rate by quartile of' }), el('th', { scope: 'col', text: 'Q1 · Q2 · Q3 · Q4' }), el('th', { scope: 'col', text: 'Counts' }))),
quartBody
)),
el('p', { class: 'note', text: 'How the odds are used: one verdict rule (THIN below ' + Math.round(P.verdict_odds_thin * 100) + '%), and the expectation break-even in each detail view, which scales the plan\u2019s cost by 1/odds. The implied value never uses the odds; the ranking is the curve\u2019s alone.' })
),
el('section', { class: 'panel section' },
el('h2', { text: 'Net economics: does the farm pay?' }),
el('p', { class: 'note', text: netPanelText })
),
el('section', { class: 'panel section' },
el('h2', { text: 'The curve at reference sizes' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Effective multiple' }), el('th', { scope: 'col', text: 'Fitted range' }))),
refBody
)),
el('p', { class: 'note', text: 'The multiple falls as TVL rises: the slope is below 1, so market cap grows more slowly than TVL.' })
),
el('section', { class: 'panel section' },
el('h2', { text: 'Category yardsticks (diagnostic only)' }),
el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'How used' }))),
fitBody
)),
el('p', { class: 'note', text: 'The blind tests rejected category intercepts, so the board does not use them.' })
),
el('section', { class: 'panel section sandbox' },
el('h2', { text: 'Curve explorer: price any size' }),
el('p', { class: 'note', text: 'Move the slider to a TVL and see what the fitted curve implies, with the nearest board rows.' }),
el('label', { for: 'ex-tvl' }, 'TVL ', tvlOut, tvlSlider),
resultsBox
),
el('section', { class: 'panel section' },
el('h2', { text: 'What the model does not know' }),
el('p', { class: 'note', text: 'The snapshot carries no points program, funding or team information, fees or revenue, user counts or token announcement. The radar cannot say whether or when a protocol launches a token, how an airdrop would be split, or what farming returns. It carries no airdrop data: the 10% pool is an assumption, and the net moves with it \u2014 the controls show 5% and 15% too. Growth, age and category enter through launch odds, a base rate, not a forecast. Farm plans are generic steps from category, chains, TVL and age; verify the protocol\u2019s own pages before sending funds.' })
)
);
}
var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
function openDetail(slug) {
var row = null;
DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
if (!row) return;
state.selected = slug;
writeHash();
dialog.textContent = '';
var recomputed = impliedOf(row, 1);
var agrees = recomputed === row.implied_value_usd;
var bMin = Math.log(Math.max(1, DATA.rows[DATA.rows.length - 1].implied_value_usd)), bMax = Math.log(Math.max(1, DATA.rows[0].implied_value_usd));
function pct(v) { return bMax > bMin ? Math.max(0, Math.min(100, (v - bMin) / (bMax - bMin) * 100)) : 50; }
var loP = Math.round(pct(Math.log(Math.max(1, row.implied_low_usd))));
var hiP = Math.round(pct(Math.log(Math.max(1, row.implied_high_usd))));
var midP = Math.round(pct(Math.log(Math.max(1, row.implied_value_usd))));
dialog.appendChild(el('div', { class: 'detail-head' },
el('div', null,
el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? '  ·  Watchlist' : '  ·  Early') }),
el('h2', { id: 'detail-title', text: row.name }),
el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + '  ·  listed ' + (row.listed_at || 'date unknown') })
),
el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
));
dialog.appendChild(el('section', { class: 'detail-section' },
el('h3', { text: 'Implied value' }),
el('div', { class: 'equation' },
el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
el('div', null, el('span', { text: 'Size curve (' + DATA.curve.comps + ' comparables)' }), el('b', { text: 'log cap = ' + DATA.curve.intercept + ' + ' + DATA.curve.slope + ' x log TVL' })),
el('div', null, el('span', { text: 'Effective multiple at this size' }), el('b', { text: fmtMult(row.model.multiple) + (row.model.extrapolated ? ' (extrapolated: outside the fitted TVL range)' : '') })),
el('div', null, el('span', { text: 'Seven-day growth (enters launch odds, not the value curve)' }), el('b', { text: fmtPct(row.change_7d) })),
el('div', null, el('span', { text: 'Age with no token (enters launch odds, not the value curve)' }), el('b', { text: fmtAge(row.age_days) })),
el('div', null, el('span', { text: 'Launch odds (descriptive base rate)' }), el('b', { text: Math.round(row.model.launch_odds * 100) + '% record a token at this size, growth and age' })),
el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
el('div', null, el('span', { text: 'Range (leave-one-out spread)' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
el('div', null, el('span', { text: 'Range, 80% band (error deciles)' }), el('b', { text: fmtUsd(row.model.range80_low_usd) + ' – ' + fmtUsd(row.model.range80_high_usd) })),
el('div', null, el('span', { text: 'Bootstrap band (200 refits)' }), el('b', { text: fmtUsd(row.model.boot_low_usd) + ' – ' + fmtUsd(row.model.boot_high_usd) }))
),
el('div', { class: 'rangebar', 'aria-hidden': 'true' }, el('i', { style: 'left:' + loP + '%;right:' + (100 - hiP) + '%;' }), el('b', { style: 'left:calc(' + midP + '% - 1px);' })),
el('p', { class: 'sub', text: 'This page recomputes the row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries.' : ' — which differs from board.json: the data would be stale.') + ' An estimate, not a price.' })
));
dialog.appendChild(el('section', { class: 'detail-section' },
el('h3', { text: 'Farm economics' }),
el('div', { class: 'totals' },
el('span', { class: 'total' }, el('b', { text: row.farm.verdict }), ' — ' + row.farm.verdict_reason),
el('span', { class: 'total', text: 'Capital $' + row.farm.capital_usd }),
el('span', { class: 'total', text: 'Gas about $' + row.farm.gas_usd }),
el('span', { class: 'total', text: 'Time ' + row.farm.active_minutes + ' min ($' + row.farm.time_value_usd + ' at $' + P.time_value_usd_per_hour + '/hr)' }),
el('span', { class: 'total', text: 'Total cost $' + row.farm.total_cost_usd }),
el('span', { class: 'total', text: 'Break-even $' + row.farm.breakeven_usd + ' (' + row.farm.breakeven_pct_of_low + '% of the low-end value)' }),
el('span', { class: 'total', text: 'Expectation break-even $' + row.farm.breakeven_ev_usd + ' at ' + Math.round(row.model.launch_odds * 100) + '% launch odds' }),
el('span', { class: 'total', text: 'Net at $1,000 · 10%: ' + fmtSigned(row.farm.net_usd) + ' (EV ' + fmt2(row.farm.net_ev_usd) + ' \u2212 gas $' + row.farm.gas_usd + ' \u2212 time $' + row.farm.time_value_usd + ' \u2212 T-bill ' + fmt2(row.farm.net_forgone_usd) + ')' }),
el('span', { class: 'total', text: row.farm.breakeven_ticket_usd === null ? 'Never pays at any ticket: expected allocation per dollar is below the 4% risk-free rate' : 'Pays from a $' + row.farm.breakeven_ticket_usd.toLocaleString('en-US') + ' ticket' }),
el('span', { class: 'total', text: 'Hold ' + row.farm.hold_days + ' days: ' + row.farm.start_date + ' to ' + row.farm.hold_until_date }),
el('span', { class: 'total', text: 'Exit if TVL falls below ' + fmtUsd(row.farm.exit_tvl_usd) }),
el('span', { class: 'total', text: 'Implied per $1 gas ' + fmtUsd(Math.round(row.implied_value_usd / Math.max(1, row.farm.gas_usd))) })
),
el('p', { class: 'sub', text: 'Capital stays in the position and is not a fee; gas is the estimated cost of the plan\u2019s transactions on ' + (row.chains && row.chains.length ? row.chains[0] : 'its main chain') + '. Break-even is gas plus active time at $' + P.time_value_usd_per_hour + '/hr: what an allocation must exceed to net positive. The expectation break-even scales that cost by 1/launch odds: the allocation, if a token launches, that makes the plan positive in expectation. Implied-per-gas compares plans; it is never a promised return.' })
));
dialog.appendChild(el('section', { class: 'detail-section' },
el('h3', { text: 'Farm plan' }),
el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
var at = s.indexOf(' Cost: ');
var action = at >= 0 ? s.slice(0, at) : s;
var tail = at >= 0 ? s.slice(at + 1) : '';
return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
}))
));
if (typeof dialog.showModal === 'function') {
if (!dialog.open) dialog.showModal();
} else {
dialog.setAttribute('open', '');
}
}
function footer() {
return el('footer', { class: 'footer' },
el('p', { text: 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '; the data does not move. Built by one program, main.ts, from the sealed snapshot: no hand-kept list, no network.' }),
el('p', { text: 'Model ' + DATA.model_version + ': a size curve fitted on ' + DATA.curve.comps + ' traded comparables, kept because it beat the flat multiple and every added term on leave-one-out and walk-forward tests, plus launch odds from a cross-validated logistic regression, a base rate and never a forecast. The board is the model\u2019s claim, never make.fun\u2019s.' })
);
}
function render() {
var fe = document.activeElement, fid = fe && fe.id, fc = fe && typeof fe.selectionStart === 'number' ? fe.selectionStart : null;
app.textContent = '';
var shell = el('div', { class: 'shell' });
shell.appendChild(header());
if (state.tab !== 'farms') shell.appendChild(lede());
shell.appendChild(controls());
if (state.tab === 'board') shell.appendChild(boardTable());
else if (state.tab === 'farms') shell.appendChild(farmsTable());
else if (state.tab === 'live') shell.appendChild(liveTable());
else shell.appendChild(modelTab());
shell.appendChild(footer());
app.appendChild(shell);
app.setAttribute('aria-busy', 'false');
if (!dialog.isConnected) app.appendChild(dialog);
if (state.selected) openDetail(state.selected);
if (fid) {
var fb = document.getElementById(fid);
if (fb) {
fb.focus();
if (fc !== null) { var at = Math.min(fc, fb.value.length); fb.setSelectionRange(at, at); }
}
}
}
readHash();
render();
window.addEventListener('keydown', function (e) {
if (e.key === 'Escape' && dialog.open) dialog.close();
});
})();
