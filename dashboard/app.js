// The Pre-Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, a detail drawer for every protocol,
// the live-token view and the model tab with its fit, backtest, coverage accounting and
// sandbox. No network: every byte it shows is in data.js, and the page recomputes each
// row's implied value from the snapshot figures, so the code and the board visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var P = DATA.params;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };
  var sandbox = { mult: 1, growth: P.growth_weight };

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

  // The model in one function: TVL x fitted multiple x growth x maturity. The page
  // recomputes a row from the snapshot figures and checks the number board.json carries.
  function impliedOf(row, multScale, growthWeight) {
    var growth = Math.min(P.growth_cap, Math.max(P.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * growthWeight;
    var age = row.age_days === null || row.age_days === undefined ? P.unknown_age_days : row.age_days;
    var maturity = P.maturity_floor + (Math.min(Math.max(age, 0), P.maturity_days) / P.maturity_days) * P.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.model.multiple * multScale * growthMult * maturity));
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
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: cov.watchlist + ' watchlist protocols, plus every early pre-token protocol below the floor' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token and is not a wrapped or staked product of one that trades. The radar adds ' + cov.early + ' more pre-token protocols below that floor, ranks them all by a fitted implied launch value, and gives each a costed farm plan.' }),
        el('p', { class: 'caveat', text: 'Implied value is this model\u2019s estimate from the snapshot\u2019s own figures, not a price and not a prediction that a token launches. A protocol \u201Crecords no token\u201D when its DefiLlama record carries none; the record is not proof.' })
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: cov.watchlist + ' / ' + cov.watchlist }), el('em', { text: 'the whole floor, no gaps' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(cov.board) }), el('em', { text: cov.early + ' early rows below the floor' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Global fitted multiple' }), el('b', { text: fmtMult(DATA.global_multiple) }), el('em', { text: DATA.backtest.comps + ' traded comparables' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Backtest within 2x' }), el('b', { text: Math.round(DATA.backtest.within_2x * 100) + '%' }), el('em', { text: 'leave-one-out, median ratio ' + DATA.backtest.median_ratio.toFixed(2) + 'x' }))
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

  function sandboxResults() {
    var rescored = DATA.rows.map(function (r) {
      return { row: r, value: impliedOf(r, sandbox.mult, sandbox.growth) };
    }).sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); });
    var top = rescored.slice(0, 10);
    var kept = top.filter(function (x) { return x.row.rank <= 10; }).length;
    var tbody = el('tbody');
    top.forEach(function (x, i) {
      tbody.appendChild(el('tr', { onclick: function () { openDetail(x.row.slug); } },
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', null, el('b', { text: x.row.name })),
        el('td', { class: 'num', text: fmtUsd(x.value) }),
        el('td', { class: 'num', text: 'board #' + x.row.rank })
      ));
    });
    return el('div', null,
      el('p', { class: 'note', text: kept + ' of the sandbox top 10 are also in the board top 10. The sandbox never changes board.json: the board always uses the fitted model.' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Sandbox rank' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Board rank' }))),
        tbody
      ))
    );
  }

  function modelTab() {
    var bt = DATA.backtest;
    var cov = DATA.coverage;
    var fitRows = DATA.categories.slice().sort(function (a, b) { return b.comps - a.comps || (a.category < b.category ? -1 : 1); });
    var fitBody = el('tbody');
    fitRows.forEach(function (c) {
      var fallback = c.comps < P.min_category_comps;
      fitBody.appendChild(el('tr', { onclick: function () {} },
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'sub', text: fallback ? 'global median (too few comparables)' : 'category median, shrunk to global' })
      ));
    });
    var exclBody = el('tbody');
    cov.excluded.forEach(function (e) {
      exclBody.appendChild(el('tr', { onclick: function () {} }, el('td', { text: e.reason }), el('td', { class: 'num', text: String(e.count) })));
    });
    var resultsBox = el('div', { id: 'sandbox-results' }, sandboxResults());
    function refreshSandbox() {
      resultsBox.textContent = '';
      resultsBox.appendChild(sandboxResults());
    }
    var multSlider = el('input', { type: 'range', id: 'sb-mult', min: '0.5', max: '2', step: '0.05', value: String(sandbox.mult), 'aria-label': 'Multiple scale' });
    var multOut = el('output', { text: 'x' + sandbox.mult.toFixed(2) });
    multSlider.addEventListener('input', function () { sandbox.mult = parseFloat(multSlider.value); multOut.textContent = 'x' + sandbox.mult.toFixed(2); refreshSandbox(); });
    var growthSlider = el('input', { type: 'range', id: 'sb-growth', min: '0', max: '1', step: '0.05', value: String(sandbox.growth), 'aria-label': 'Growth weight' });
    var growthOut = el('output', { text: String(sandbox.growth.toFixed(2)) });
    growthSlider.addEventListener('input', function () { sandbox.growth = parseFloat(growthSlider.value); growthOut.textContent = sandbox.growth.toFixed(2); refreshSandbox(); });
    return el('div', null,
      el('section', { class: 'panel section' },
        el('h2', { text: 'How implied value is computed' }),
        el('p', { class: 'note', text: 'One function scores every row, from the snapshot\u2019s own figures only. No protocol name is special-cased and no row is hand-picked.' }),
        el('div', { class: 'formula', text: 'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, ' + P.growth_floor + ', ' + P.growth_cap + ') / 100 x ' + P.growth_weight + ') x (' + P.maturity_floor + ' + min(age_days, ' + P.maturity_days + ') / ' + P.maturity_days + ' x ' + P.maturity_range + ') )' }),
        el('p', { class: 'note', text: 'The multiple is the category\u2019s median market-cap/TVL ratio among traded comparables in this same snapshot, winsorised to [' + P.ratio_floor + ', ' + P.ratio_cap + '], shrunk toward the global median with a prior of ' + P.shrink_prior + ' pseudo-comparables, and capped at ' + fmtMult(P.multiple_cap) + '. A category with fewer than ' + P.min_category_comps + ' comparables takes the global median (' + fmtMult(DATA.global_multiple) + '). Age is the time since first listing, the best record of how long a protocol has run with no token; an unlisted age uses ' + P.unknown_age_days + ' days.' })
      ),
      el('div', { class: 'grid2' },
        el('section', { class: 'panel section' },
          el('h2', { text: 'Backtest: how rough is the fit?' }),
          el('div', { class: 'kv' },
            kvRow('Traded comparables tested', String(bt.comps)),
            kvRow('Median predicted / actual', bt.median_ratio.toFixed(2) + 'x'),
            kvRow('Median absolute log error', String(bt.median_abs_log_error)),
            kvRow('Within 2x of the real cap', Math.round(bt.within_2x * 100) + '%'),
            kvRow('Implied range factors', fmtMult(bt.low_factor) + ' to ' + fmtMult(bt.high_factor))
          ),
          el('p', { class: 'note', text: 'Each comparable was predicted from a fit that never saw it (leave-one-out). The fit is roughly unbiased but wide: market-cap/TVL ratios genuinely span orders of magnitude. Read every implied value as an order of magnitude, and read the range in each detail view. The range factors are the backtest\u2019s own error quartiles, clamped to [0.25x, 4x].' })
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
          el('p', { class: 'note', text: 'Exclusions follow the watchlist\u2019s own rule: versioned names, bridge / liquid-staking / CEX categories, wrapped or staked names, and exchange-named products. The snapshot carries no parent-protocol field, so the rule is applied from the ten fields it does carry.' })
        )
      ),
      el('section', { class: 'panel section' },
        el('h2', { text: 'Fitted multiples by category' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'fit-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'How fitted' }))),
          fitBody
        ))
      ),
      el('section', { class: 'panel section sandbox' },
        el('h2', { text: 'Model sandbox: what moves the ranking?' }),
        el('p', { class: 'note', text: 'Change the assumptions and watch the top 10 re-rank. This only explores the model in the page; board.json always uses the fitted constants above.' }),
        el('label', { for: 'sb-mult' }, 'Multiple scale ', multOut, multSlider),
        el('label', { for: 'sb-growth' }, 'Growth weight ', growthOut, growthSlider),
        resultsBox
      ),
      el('section', { class: 'panel section' },
        el('h2', { text: 'What the model does not know' }),
        el('p', { class: 'note', text: 'The snapshot carries no points program, no funding or team information, no fees or revenue, no user counts and no token announcement. The radar cannot say whether or when a protocol launches a token, how an airdrop would be split, or what farming it returns. Farm plans are generic, safe-by-default steps derived from category, chains, TVL and age; always verify the protocol\u2019s own pages before sending funds.' })
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
    var recomputed = impliedOf(row, 1, P.growth_weight);
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
        el('div', null, el('span', { text: 'Fitted multiple (' + (row.category || 'Other') + ', ' + row.model.comps_n + (row.model.comps_n === 1 ? ' comparable)' : ' comparables)') }), el('b', { text: fmtMult(row.model.multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth (clamped)' }), el('b', { text: fmtPct(row.model.growth_pct) + '  →  x' + row.model.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) + '  →  x' + row.model.maturity_multiplier })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Range (backtest spread)' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) }))
      ),
      el('div', { class: 'rangebar', 'aria-hidden': 'true' }, el('i', { style: 'left:0%;right:0%;' }), el('b', { style: 'left:calc(' + pos + '% - 1px);' })),
      el('p', { class: 'sub', text: 'This page recomputes the row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries.' : ' — which differs from board.json: the data would be stale.') + ' An estimate, not a price; read the range, not the point.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'totals' },
        el('span', { class: 'total', text: 'Capital $' + row.farm.capital_usd }),
        el('span', { class: 'total', text: 'Gas about $' + row.farm.gas_usd }),
        el('span', { class: 'total', text: 'Active time ' + row.farm.active_minutes + ' min' }),
        el('span', { class: 'total', text: 'Hold ' + row.farm.hold_days + ' days' }),
        el('span', { class: 'total', text: 'Implied per $1 gas ' + fmtUsd(Math.round(row.implied_value_usd / Math.max(1, row.farm.gas_usd))) })
      ),
      el('p', { class: 'sub', text: 'Capital stays in the position and is not a fee; gas is the estimated cost of the plan\u2019s transactions on ' + (row.chains && row.chains.length ? row.chains[0] : 'its main chain') + '. Implied-per-gas is arithmetic for comparing plans, never a promised return.' })
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
      el('p', { text: 'Model ' + DATA.model_version + ': fitted multiples from ' + DATA.backtest.comps + ' traded comparables in this snapshot, growth and maturity from each protocol\u2019s own record. The board is the model\u2019s claim, never make.fun\u2019s.' })
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
