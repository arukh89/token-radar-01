// The Pre-Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board with its validation strip, the filters, a detail
// drawer for every protocol, the live-token view and the model tab with its size curve,
// blind tests, coverage accounting and curve explorer. No network: every byte it shows
// is in data.js, and the page recomputes each row's implied value from the snapshot
// figures, so the code and the board visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var P = DATA.params;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };
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

  // The model in one function: TVL x the fitted multiple at that size. The multiple
  // comes from the size curve (log market cap on log TVL), so the page recomputes a
  // row from the snapshot figures and checks the number board.json carries.
  function impliedOf(row, multScale) {
    return Math.max(1, Math.round(row.tvl_usd * row.model.multiple * (multScale || 1)));
  }
  function curveValue(tvl) {
    return Math.max(1, Math.round(Math.exp(DATA.curve.intercept + DATA.curve.slope * Math.log(Math.max(1, tvl)))));
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
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w') === '1') state.watch = true;
    if (params.get('tab')) state.tab = params.get('tab');
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
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.model.multiple; bv = b.model.multiple; }
      else if (key === 'verdict') { var order = { FARM: 0, THIN: 1, SKIP: 2 }; av = order[a.farm.verdict]; bv = order[b.farm.verdict]; }
      else if (key === 'efficiency') { av = a.implied_value_usd / Math.max(1, a.farm.gas_usd); bv = b.implied_value_usd / Math.max(1, b.farm.gas_usd); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
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
          el('div', { class: 'brand-sub', text: 'Which protocol is worth farming next, and what to do about it' })
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
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: cov.watchlist + ' watchlist protocols, plus every early pre-token protocol below the floor' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token and is not a wrapped or staked product of one that trades. The radar adds ' + cov.early + ' more pre-token protocols below that floor, ranks them all by a size curve fitted on traded tokens, and gives each a dated, costed farm plan with a verdict.' }),
        el('p', { class: 'caveat', text: 'Implied value is this model\u2019s estimate from the snapshot\u2019s own figures, not a price and not a prediction that a token launches. A protocol \u201Crecords no token\u201D when its DefiLlama record carries none; the record is not proof.' })
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
        el('span', null, el('b', { text: cov.total + ' scanned' }), '  →  ' + cov.board + ' ranked  ·  ' + cov.live_token + ' live-token set aside  ·  ' + excluded + ' excluded as products  ·  ' + verdicts.FARM + ' FARM / ' + verdicts.THIN + ' THIN / ' + verdicts.SKIP + ' SKIP'),
        flat ? el('span', { class: 'strip-note', text: 'Blind tests kept the size curve and dropped the flat multiple (leave-one-out log error ' + bt.median_abs_log_error + ' vs ' + flat.loo.median_abs_log_error + '; walk-forward ' + (wf ? wf.median_abs_log_error : 'n/a') + ' vs ' + (flat.walk_forward ? flat.walk_forward.median_abs_log_error : 'n/a') + '). Category, growth and age terms were tested the same way and dropped: see Model & coverage.' }) : null
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
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
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var countText = state.tab === 'board' ? filteredRows().length + ' of ' + DATA.rows.length + ' rows shown'
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols, set aside from the ranking'
      : 'The fit, the backtest, the coverage and the sandbox';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'watch' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('model', 'Model & coverage'))),
      el('span', { class: 'count', text: countText })
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
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.model.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(Math.round(r.implied_value_usd / Math.max(1, r.farm.gas_usd))) }),
        el('td', null, el('span', { class: 'badge verdict-' + r.farm.verdict.toLowerCase(), text: r.farm.verdict })),
        el('td', null, el('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            sortHeader('efficiency', 'Implied / $1 gas'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'badge live', text: 'Already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The largest live-token protocols by market cap. Their market caps are facts, not models, so they are set aside from the pre-token ranking; their market-cap/TVL ratios are the comparables the fit learns from.' }),
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
        el('td', { class: 'num', text: '#' + r.rank }),
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      ));
    });
    return el('div', null,
      el('p', { class: 'note', text: 'At ' + fmtUsd(tvl) + ' of TVL the curve implies ' + fmtUsd(value) + ' (multiple ' + fmtMult(mult) + ')' + (inside ? ', inside the fitted TVL range.' : ', OUTSIDE the fitted TVL range: the curve extrapolates here, and rows there carry a SKIP verdict.') + ' The explorer never changes board.json: the board always uses the fitted curve.' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
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
      ablBody.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('b', { text: v.label }), v.kept ? el('span', { class: 'badge verdict-farm', text: ' kept' }) : null),
        el('td', { class: 'num', text: String(v.loo.median_abs_log_error) }),
        el('td', { class: 'num', text: Math.round(v.loo.within_2x * 100) + '%' }),
        el('td', { class: 'num', text: v.walk_forward ? String(v.walk_forward.median_abs_log_error) : 'n/a' }),
        el('td', { class: 'num', text: v.walk_forward ? Math.round(v.walk_forward.within_2x * 100) + '%' : 'n/a' })
      ));
    });
    var refBody = el('tbody');
    [10000000, 50000000, 100000000, 500000000, 1000000000, 5000000000, 10000000000].forEach(function (tvl) {
      var value = curveValue(tvl);
      refBody.appendChild(el('tr', { onclick: function () {} },
        el('td', { class: 'num', text: fmtUsd(tvl) }),
        el('td', { class: 'num', text: fmtUsd(value) }),
        el('td', { class: 'num', text: fmtMult(value / tvl) }),
        el('td', { class: 'sub', text: tvl >= DATA.curve.tvl_min_usd && tvl <= DATA.curve.tvl_max_usd ? 'inside the fitted range' : 'outside: extrapolated' })
      ));
    });
    var fitBody = el('tbody');
    DATA.categories.forEach(function (c) {
      fitBody.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: fmtMult(c.median_ratio) }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'sub', text: 'yardstick only: the curve ignores category' })
      ));
    });
    var exclBody = el('tbody');
    cov.excluded.forEach(function (e) {
      exclBody.appendChild(el('tr', { onclick: function () {} }, el('td', { text: e.reason }), el('td', { class: 'num', text: String(e.count) })));
    });
    var namedBody = el('tbody');
    cov.excluded_named.forEach(function (e) {
      namedBody.appendChild(el('tr', { onclick: function () {} }, el('td', null, el('b', { text: e.name })), el('td', { class: 'sub', text: e.slug }), el('td', { class: 'sub', text: e.reason })));
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
        el('p', { class: 'note', text: 'One curve scores every row, from the snapshot\u2019s own figures only. No protocol name is special-cased and no row is hand-picked.' }),
        el('div', { class: 'formula', text: 'log(market cap) = ' + DATA.curve.intercept.toFixed(4) + ' + ' + DATA.curve.slope.toFixed(4) + ' x log(TVL)   ·   implied = round( exp(a + b x log(TVL)) )' }),
        el('p', { class: 'note', text: 'The curve is least squares on the logs of ' + DATA.curve.comps + ' traded comparables in this same snapshot (a protocol counts when it records a market cap and TVL, is not a CEX and has no versioned name). The slope is clamped to [' + P.slope_floor + ', ' + P.slope_cap + ']. The fitted range runs from ' + fmtUsd(DATA.curve.tvl_min_usd) + ' to ' + fmtUsd(DATA.curve.tvl_max_usd) + ' of TVL; rows outside it are flagged as extrapolated. Because the curve rises with TVL, the board orders by size — the tests below are why no other term survived, and the curve still sets the level, the error band and the bootstrap band at every size.' }),
        el('p', { class: 'note', text: 'Farm verdicts follow fixed numeric rules, the same for every row. SKIP when the TVL is outside the fitted range or when 7d growth is at or below ' + P.verdict_growth_skip + '%. THIN when growth is below ' + P.verdict_growth_thin + '%. Otherwise FARM. The bootstrap band is shown in each detail view but does not drive the verdict: it is narrower than the leave-one-out error range at every size. A verdict judges the trend and the fit\u2019s range; it is never a promise that a token launches.' })
      ),
      el('div', { class: 'grid2' },
        el('section', { class: 'panel section' },
          el('h2', { text: 'Blind tests: what survived, what was dropped' }),
          el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Variant' }), el('th', { scope: 'col', text: 'LOO log err' }), el('th', { scope: 'col', text: 'LOO 2x' }), el('th', { scope: 'col', text: 'Walk-fwd log err' }), el('th', { scope: 'col', text: 'Walk-fwd 2x' }))),
            ablBody
          )),
          el('p', { class: 'note', text: 'Leave-one-out predicts each comparable from a fit that never saw it (n=' + bt.comps + '). Walk-forward fits on the ' + val.train_n + ' comparables listed before ' + val.split_date + ' and tests on the ' + val.test_n + ' listed at or after it. A term was kept only when it beat the bare curve on BOTH tests; none did, so the board uses the bare curve. Lower log error is better. The range factors are the kept fit\u2019s leave-one-out error quartiles, clamped to [0.25x, 4x]: ' + fmtMult(bt.low_factor) + ' to ' + fmtMult(bt.high_factor) + ', and ' + Math.round(val.calibration.coverage * 100) + '% of held-out market caps land inside their own band (calibration, n=' + val.calibration.n + '). The bootstrap refits the curve ' + val.bootstrap.refits + ' times on resampled comparables: slope ' + val.bootstrap.slope_p5 + ' to ' + val.bootstrap.slope_p95 + ' (median ' + val.bootstrap.slope_median + '), which sets each row\u2019s second band in its detail view.' })
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
          el('p', { class: 'note', text: 'Exclusions follow the watchlist\u2019s own rule: versioned names, bridge / liquid-staking / CEX categories, wrapped or staked names, and exchange-named products. The snapshot carries no parent-protocol field, so the rule is applied from the ten fields it does carry.' }),
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
        el('h2', { text: 'The curve at reference sizes' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Effective multiple' }), el('th', { scope: 'col', text: 'Fitted range' }))),
          refBody
        )),
        el('p', { class: 'note', text: 'The multiple falls as TVL rises: the slope is below 1, so market cap grows more slowly than TVL across the traded set. That is the size effect the flat multiple misses.' })
      ),
      el('section', { class: 'panel section' },
        el('h2', { text: 'Category yardsticks (diagnostic only)' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'How used' }))),
          fitBody
        )),
        el('p', { class: 'note', text: 'Shown so the category structure is visible. The blind tests rejected category intercepts, so the board does not use them.' })
      ),
      el('section', { class: 'panel section sandbox' },
        el('h2', { text: 'Curve explorer: price any size' }),
        el('p', { class: 'note', text: 'Move the slider to a TVL and see what the fitted curve implies at that size, with the nearest board rows. This only explores the curve in the page; board.json always uses the fitted constants above.' }),
        el('label', { for: 'ex-tvl' }, 'TVL ', tvlOut, tvlSlider),
        resultsBox
      ),
      el('section', { class: 'panel section' },
        el('h2', { text: 'What the model does not know' }),
        el('p', { class: 'note', text: 'The snapshot carries no points program, no funding or team information, no fees or revenue, no user counts and no token announcement. The radar cannot say whether or when a protocol launches a token, how an airdrop would be split, or what farming it returns. Growth and age were tested as model terms and dropped because they lost the blind tests; they still appear as facts on each row and in the verdict rules. Farm plans are generic, safe-by-default steps derived from category, chains, TVL and age; always verify the protocol\u2019s own pages before sending funds.' })
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
    var lo = Math.log(Math.max(1, row.implied_low_usd));
    var hi = Math.log(Math.max(2, row.implied_high_usd));
    var mid = Math.log(Math.max(1, row.implied_value_usd));
    var pos = hi > lo ? Math.round(((mid - lo) / (hi - lo)) * 100) : 50;
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
        el('div', null, el('span', { text: 'Size curve (' + DATA.curve.comps + ' comparables)' }), el('b', { text: 'log cap = ' + DATA.curve.intercept.toFixed(2) + ' + ' + DATA.curve.slope.toFixed(3) + ' x log TVL' })),
        el('div', null, el('span', { text: 'Effective multiple at this size' }), el('b', { text: fmtMult(row.model.multiple) + (row.model.extrapolated ? ' (extrapolated: outside the fitted TVL range)' : '') })),
        el('div', null, el('span', { text: 'Seven-day growth (a fact, not a model term)' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token (a fact, not a model term)' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Range (leave-one-out spread)' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
        el('div', null, el('span', { text: 'Bootstrap band (200 refits)' }), el('b', { text: fmtUsd(row.model.boot_low_usd) + ' – ' + fmtUsd(row.model.boot_high_usd) }))
      ),
      el('div', { class: 'rangebar', 'aria-hidden': 'true' }, el('i', { style: 'left:0%;right:0%;' }), el('b', { style: 'left:calc(' + pos + '% - 1px);' })),
      el('p', { class: 'sub', text: 'This page recomputes the row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries.' : ' — which differs from board.json: the data would be stale.') + ' An estimate, not a price; read the range, not the point.' })
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
        el('span', { class: 'total', text: 'Hold ' + row.farm.hold_days + ' days: ' + row.farm.start_date + ' to ' + row.farm.hold_until_date }),
        el('span', { class: 'total', text: 'Exit if TVL falls below ' + fmtUsd(row.farm.exit_tvl_usd) }),
        el('span', { class: 'total', text: 'Implied per $1 gas ' + fmtUsd(Math.round(row.implied_value_usd / Math.max(1, row.farm.gas_usd))) })
      ),
      el('p', { class: 'sub', text: 'Capital stays in the position and is not a fee; gas is the estimated cost of the plan\u2019s transactions on ' + (row.chains && row.chains.length ? row.chains[0] : 'its main chain') + '. Break-even is gas plus active time valued at $' + P.time_value_usd_per_hour + ' an hour: what an allocation to this farmer must exceed for the plan to net positive. Implied-per-gas is arithmetic for comparing plans, never a promised return.' })
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
      el('p', { text: 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '; the data does not move. Built by one program, main.ts, from the sealed snapshot: no hand-kept list, no network, no names special-cased.' }),
      el('p', { text: 'Model ' + DATA.model_version + ': a size curve fitted on ' + DATA.curve.comps + ' traded comparables in this snapshot, kept because it beat the flat multiple and every added term on leave-one-out and walk-forward tests. The board is the model\u2019s claim, never make.fun\u2019s.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(modelTab());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
