// LaunchScope's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked launch board, a live-token view that shows the calibration's evidence, and a detail
// drawer per protocol with the model's arithmetic and the farm plan. No network: every byte it
// shows is in data.js. On load the page re-multiplies every row's stated components and counts how
// many land on board.json's exact figure, so a reader can see the page and the board agree.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D || !app) return;

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', segment: 'all', sort: 'rank', dir: 1, selected: null };

  // State may arrive in the hash (#cat=Lending&seg=watchlist&p=some-slug): shareable views, and the
  // same mechanism the entry's screenshots were taken with.
  (function fromHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('tab') === 'live') state.tab = 'live';
    if (h.get('q')) state.q = h.get('q');
    if (h.get('cat')) state.category = h.get('cat');
    if (h.get('chain')) state.chain = h.get('chain');
    if (h.get('seg')) state.segment = h.get('seg');
    if (h.get('sort')) state.sort = h.get('sort');
    if (h.get('p')) state.selected = h.get('p');
  })();

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 335) return (d / 365).toFixed(1) + ' yrs';
    if (d >= 60) return Math.round(d / 30.4) + ' mo';
    return d + ' d';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x !== null && x !== undefined) node.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // The model check: board.json's implied value is tvl x peer multiple x (growth x maturity x
  // breadth), every component stated on the row. Re-multiply all of them and count exact matches.
  var verified = 0;
  D.rows.forEach(function (r) {
    var m = r.model;
    var again = Math.round(r.tvl_usd * m.peer_multiple * (m.growth_factor * m.maturity_factor * m.breadth_factor));
    if (again === r.implied_value_usd) verified++;
  });

  function header() {
    var c = D.counts;
    var stat = function (n, l) { return el('div', { class: 'stat' }, el('div', { class: 'n' }, n), el('div', { class: 'l', text: l })); };
    return el('div', null,
      el('div', { class: 'head' },
        el('div', { class: 'rings' }),
        el('div', { class: 'brand' },
          el('h1', null, 'Launch', el('span', { class: 'scope', text: 'Scope' })),
          el('p', { text: 'Every protocol that records no token yet, ranked by what its token would be worth if the market priced it like the live protocols it already prices — and the steps to farm each one before it launches.' })),
        el('div', { class: 'asof', text: 'snapshot ' + D.as_of + '\n' + D.source })),
      el('div', { class: 'stats' },
        stat([String(c.protocols)], 'protocols scanned'),
        stat([String(c.board)], 'pre-token ranked'),
        stat([String(c.board - c.early), ' / ', String(c.watchlist)], 'watchlist covered'),
        stat([String(c.early)], 'early finds beyond the list'),
        stat([String(c.live)], 'live tokens set aside')),
      el('div', { class: 'model' },
        el('div', { class: 'formula' },
          el('span', { text: 'implied = TVL × ' }), el('b', { text: 'peer multiple' }),
          el('span', { text: ' × growth × maturity × breadth' })),
        el('div', { class: 'note', text: 'The peer multiple is the median market cap / TVL of the live protocols in the same category — ' + D.calibration.peer_count + ' priced peers, market-wide median ' + D.calibration.global_multiple.toFixed(3) + '× — winsorized at the market\u2019s 95th percentile and shrunk toward that median until a category has priced peers of its own. Growth saturates, maturity rewards a long tokenless track record, breadth rewards chains. Model ' + D.model_version + ', stated in full in lib/model.ts.' }),
        el('div', { class: 'verified', text: 'model check: ' + verified + '/' + D.rows.length + ' rows re-multiply exactly' })));
  }

  function options(list, allLabel) {
    var out = [el('option', { value: 'all', text: allLabel })];
    list.forEach(function (v) { out.push(el('option', { value: v, text: v })); });
    return out;
  }
  function controls() {
    var cats = [], chains = [], seenC = {}, seenH = {};
    D.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (!seenC[c]) { seenC[c] = 1; cats.push(c); }
      r.chains.forEach(function (h) { if (!seenH[h]) { seenH[h] = 1; chains.push(h); } });
    });
    cats.sort(); chains.sort();
    var tabBtn = function (id, label) {
      return el('button', { class: state.tab === id ? 'on' : '', onclick: function () { state.tab = id; render(); } }, label);
    };
    var sel = function (key, list, allLabel) {
      var s = el('select', { onchange: function (e) { state[key] = e.target.value; render(); } }, options(list, allLabel));
      s.value = state[key];
      return s;
    };
    var sortSel = el('select', { onchange: function (e) { state.sort = e.target.value; state.dir = e.target.value === 'rank' || e.target.value === 'name' ? 1 : -1; render(); } },
      ['rank|Rank', 'implied|Implied value', 'tvl|TVL', 'change|7d change', 'age|Age', 'name|Name'].map(function (p) {
        var kv = p.split('|');
        return el('option', { value: kv[0], text: 'Sort: ' + kv[1] });
      }));
    sortSel.value = state.sort;
    var bar = el('div', { class: 'controls' },
      el('div', { class: 'tabs' }, tabBtn('board', 'Launch board'), tabBtn('live', 'Live tokens · the evidence')),
      el('input', { type: 'search', placeholder: 'Search name, slug, category…', value: state.q, oninput: function (e) { state.q = e.target.value; renderTable(); } }),
      state.tab === 'board' ? sel('category', cats, 'All categories') : null,
      state.tab === 'board' ? sel('chain', chains, 'All chains') : null,
      state.tab === 'board' ? sortSel : null,
      el('span', { class: 'count', id: 'rowcount' }));
    return bar;
  }

  function segmentSelect() {
    var s = el('select', { onchange: function (e) { state.segment = e.target.value; renderTable(); } },
      el('option', { value: 'all', text: 'All rows' }),
      el('option', { value: 'watchlist', text: 'Watchlist only' }),
      el('option', { value: 'early', text: 'Early radar only' }));
    s.value = state.segment;
    return s;
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.segment === 'watchlist' && !r.watchlist) return false;
      if (state.segment === 'early' && r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -1e9 : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    };
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.rank - b.rank; });
    return rows;
  }

  function boardTable() {
    var rows = visibleRows();
    var head = function (label, keyName, num) {
      var th = el('th', { class: num ? 'num' : '', onclick: function () {
        if (state.sort === keyName) state.dir *= -1; else { state.sort = keyName; state.dir = (keyName === 'rank' || keyName === 'name') ? 1 : -1; }
        renderTable();
      } }, label);
      if (state.sort === keyName) th.appendChild(el('span', { class: 'dir', text: state.dir === 1 ? ' ↑' : ' ↓' }));
      return th;
    };
    var body = rows.map(function (r) {
      var tr = el('tr', { class: (r.rank <= 3 ? 'top' : '') + (state.selected === r.slug ? ' sel' : ''), onclick: function () { state.selected = r.slug; render(); } },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null,
          el('span', { class: 'nm', text: r.name }),
          el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'WATCHLIST' : 'EARLY' }),
          el('div', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + r.slug })),
        el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.model.peer_multiple.toFixed(3) + '×' }),
        el('td', { class: 'num' },
          el('span', { text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'rng', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) })));
      return tr;
    });
    if (rows.length === 0) body = [el('tr', null, el('td', { class: 'empty', colspan: '8', text: 'No protocol matches this filter. Loosen the search or clear a filter.' }))];
    return el('table', null,
      el('thead', null, el('tr', null, head('#', 'rank'), head('Protocol', 'name'), el('th', { text: 'Chains' }), head('TVL', 'tvl', 1), head('7d', 'change', 1), head('Age', 'age', 1), el('th', { class: 'num', text: 'Peer ×' }), head('Implied value', 'implied', 1))),
      el('tbody', null, body));
  }

  function liveTable() {
    var q = state.q.trim().toLowerCase();
    var rows = D.live.filter(function (r) { return !q || (r.name + ' ' + (r.symbol || '') + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0; });
    var body = rows.map(function (r) {
      return el('tr', null,
        el('td', null, el('span', { class: 'nm', text: r.name }), el('div', { class: 'sub', text: (r.category || 'Uncategorised') + (r.symbol ? ' · $' + r.symbol : '') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple.toFixed(3) + '×' }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
    });
    return el('div', null,
      el('p', { class: 'why', text: 'These protocols already have a token, so they are never ranked: the market has priced them itself. Their market cap / TVL multiples are the evidence the board\u2019s model is calibrated from — the biggest 36 of ' + D.calibration.peer_count + ' priced peers.' }),
      el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Live protocol' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'Multiple' }), el('th', { class: 'num', text: '7d' }))),
        el('tbody', null, body)));
  }

  function drawer() {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return null;
    var m = r.model;
    var base = Math.round(r.tvl_usd * m.peer_multiple);
    var after = function (v) { return fmtUsd(Math.round(v)); };
    var grown = base * m.growth_factor, matured = grown * m.maturity_factor;
    var pct = 50;
    if (r.implied_high_usd > r.implied_low_usd && r.implied_value_usd > 0) {
      pct = (Math.log(r.implied_value_usd) - Math.log(r.implied_low_usd)) / (Math.log(r.implied_high_usd) - Math.log(r.implied_low_usd)) * 100;
      pct = Math.max(0, Math.min(100, pct));
    }
    var fact = function (k, v) { return el('div', { class: 'fact' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })); };
    var flowRow = function (k, v, cls) { return el('div', { class: 'row' + (cls ? ' ' + cls : '') }, el('span', { text: k }), el('span', { text: v })); };
    return el('aside', { class: 'drawer' },
      el('button', { class: 'x', text: '×', onclick: function () { state.selected = null; render(); } }),
      el('h2', { text: r.name }),
      el('div', { class: 'cat', text: (r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + D.rows.length + (r.watchlist ? ' · on the house watchlist' : ' · early radar find') }),
      el('div', { class: 'facts' },
        fact('TVL', fmtUsd(r.tvl_usd)),
        fact('Implied value', fmtUsd(r.implied_value_usd)),
        fact('7d TVL change', fmtPct(r.change_7d)),
        fact('Tokenless track record', fmtAge(r.age_days)),
        fact('Chains', r.chains.length ? r.chains.join(', ') : 'not recorded'),
        fact('Token status', 'records no token')),
      el('h3', { text: 'How the model prices it' }),
      el('div', { class: 'flow' },
        flowRow('TVL × peer multiple ' + m.peer_multiple.toFixed(3) + '× (' + (m.peer_count > 0 ? m.peer_count + ' live ' + (r.category || '') + (m.peer_count === 1 ? ' peer' : ' peers') : 'market-wide median') + ')', after(base)),
        flowRow('× growth ' + m.growth_factor.toFixed(3) + ' (7d ' + fmtPct(m.growth_pct) + ', saturating)', after(grown)),
        flowRow('× maturity ' + m.maturity_factor.toFixed(3) + ' (' + fmtAge(m.age_days) + ' with no token)', after(matured)),
        flowRow('× breadth ' + m.breadth_factor.toFixed(3) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', ''),
        flowRow('Implied value', fmtUsd(r.implied_value_usd), 'total')),
      el('div', { class: 'rangebar' }, el('div', { class: 'mark', style: 'left: calc(' + pct.toFixed(1) + '% - 1px)' })),
      el('div', { class: 'rangelabels' }, el('span', { text: 'low ' + fmtUsd(r.implied_low_usd) }), el('span', { text: 'peer 25th–75th percentile' }), el('span', { text: 'high ' + fmtUsd(r.implied_high_usd) })),
      el('p', { class: 'why', text: 'Why this rank: ' + r.name + ' holds ' + fmtUsd(r.tvl_usd) + ' of TVL and records no token. Priced at its category\u2019s own multiple rather than a house constant, then adjusted for its week, its age and its reach, it lands at #' + r.rank + '. The value is a claim about price if a token came, never a promise that one will.' }),
      el('h3', { text: 'Farm plan — ' + r.farm_steps.length + ' steps' }),
      el('ol', { class: 'plan' }, r.farm_steps.map(function (s) {
        return el('li', null,
          el('div', { text: s.text }),
          el('div', { class: 'chips' },
            el('span', { class: 'chip' }, el('b', { text: 'Cost ' }), s.cost),
            el('span', { class: 'chip' }, el('b', { text: 'Time ' }), s.time)));
      })),
      el('div', { class: 'foot', text: 'Plan derived from the protocol\u2019s category, chains, TVL and age by the same function that writes board.json — no name is special-cased.' }));
  }

  var tableHost = null, drawerHost = null, countHost = null;
  function renderTable() {
    if (!tableHost) return;
    tableHost.textContent = '';
    tableHost.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (countHost) {
      countHost.textContent = state.tab === 'board'
        ? visibleRows().length + ' of ' + D.rows.length + ' ranked'
        : D.live.length + ' live shown';
    }
    if (drawerHost) {
      drawerHost.textContent = '';
      var d = drawer();
      if (d) drawerHost.appendChild(d);
    }
  }
  function render() {
    app.textContent = '';
    app.appendChild(header());
    var bar = controls();
    // The segment select needs its own change wiring (it re-renders only the table).
    var segWrap = el('span', null, segmentSelect());
    bar.insertBefore(segWrap, bar.querySelector('.count'));
    if (state.tab !== 'board') segWrap.style.display = 'none';
    app.appendChild(bar);
    countHost = bar.querySelector('.count');
    tableHost = el('div', { id: 'board' });
    app.appendChild(tableHost);
    app.appendChild(el('div', { class: 'foot' },
      el('span', { text: 'Source: ' }), el('span', { class: 'mono', text: D.source }),
      el('span', { text: ' · Board and page are written by one run of main.ts from the sealed snapshot; nothing here loads from a network. Implied values are the entry\u2019s own claims, not make.fun\u2019s.' })));
    drawerHost = el('div', null);
    app.appendChild(drawerHost);
    app.setAttribute('aria-busy', 'false');
    renderTable();
  }
  render();
})();
