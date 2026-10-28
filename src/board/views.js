/* Labelboard views beside the board: Inbox, Priorities, the Gmail tab's day strips, and the pane under the board
   (before → after, a flow you drop cards in). Numbers from insights.js, drawn as plain SVG/HTML. They never change Gmail. */
window.LabelboardViews = function (ctx) {
  'use strict';
  var S = ctx.S, I = window.LabelboardInsights, R = window.LabelboardRules, $ = ctx.$, h = ctx.h, fmt = ctx.fmt, plural = ctx.plural;
  var NAMES = { home: 'Home', board: 'Board', gmail: 'Gmail', inbox: 'Inbox', priorities: 'Priorities' };
  var tips = {}, tipSeq = 0; // tooltip HTML by id, rebuilt on every render
  var colorOf = function (id) { var b = ctx.bucket(id); return ctx.bandOf(b) || (b && b.id !== 'unsorted' ? 'var(--muted)' : 'var(--hatch)'); }; // as the rack
  var nameOf = function (id) { var b = ctx.bucket(id); return b ? b.name : id; };
  var short = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var pct = function (a, b) { return b ? Math.round(100 * a / b) + '%' : '0%'; };
  var day = function (iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  var ago = function (d) { return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago'; };
  var tip = function (html) { var id = 'p' + (++tipSeq); tips[id] = html; return ' data-tip="' + id + '"'; };
  var q = function () { return $('q').value.trim().toLowerCase(); };
  var hit = function (s) { var x = q(); return !x || String(s || '').toLowerCase().indexOf(x) >= 0; };
  function head(title, lead) { return '<header class="v-head"><h2>' + h(title) + '</h2><p>' + lead + '</p></header>'; }
  function kpis(list) {
    return '<div class="kpis">' + list.map(function (k) {
      return '<div class="kpi' + (k.accent ? ' accent' : '') + '"><span class="kpi-n">' + h(k.n) + '</span><span class="kpi-l">' + h(k.l) + '</span></div>';
    }).join('') + '</div>';
  }

  function resetTips() { tips = {}; tipSeq = 0; hideTip(); }
  function render(view) {
    resetTips();
    var el = $('view'), w = Math.max(320, el.clientWidth - 40);
    el.innerHTML = view === 'inbox' ? inboxHtml(w) : view === 'priorities' ? prioritiesHtml() : '';
    if (view === 'priorities') wirePriorities();
  }
  // ---------- Inbox: who writes (bubbles), or every thread by column or by age ----------
  var INBOX = [['who', 'Who writes'], ['column', 'Every thread'], ['age', 'By age']];
  function inboxHtml(W) {
    var mode = ctx.ui().inbox || 'who';
    var pick = '<div class="seg-pick" role="radiogroup" aria-label="Show">' + INBOX.map(function (m) { return '<button type="button" role="radio" data-inbox="' + m[0] + '" aria-checked="' + (mode === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</div>';
    return mode === 'who' ? overviewHtml(W, pick) : threadsHtml(mode, pick);
  }

  var PATTERN = '<defs><pattern id="fl-out" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--hatch)"/><rect width="3" height="6" fill="var(--muted)"/></pattern></defs>';
  // The bands and bars of a layered Sankey (insights.js flowLayout), for the pane under the board. o: fill(id),
  // linkColor(l), linkTip(l), linkClass(l)?, node(id, n) → { name, n, tip, text, open (attributes), dim?, stroke? }
  function sankey(L, o) {
    var N = L.nodes, nw = L.nodeWidth;
    var links = L.links.map(function (l) {
      var s = N[l.from], t = N[l.to], x0 = s.x + nw, x1 = t.x, xm = (x0 + x1) / 2;
      return '<path class="link' + (o.linkClass ? o.linkClass(l) : '') + '" data-from="' + h(l.from) + '" data-to="' + h(l.to) + '" d="M' + x0 + ' ' + l.y0 + 'C' + xm + ' ' + l.y0 + ' ' + xm + ' ' + l.y1 + ' ' + x1 + ' ' + l.y1 +
        '" stroke="' + o.linkColor(l) + '" stroke-width="' + l.w.toFixed(2) + '"' + tip(o.linkTip(l)) + '/>';
    }).join('');
    var nodes = Object.keys(N).map(function (id) {
      var n = N[id], x = o.node(id, n);
      return '<g class="node' + (x.dim ? ' dim' : '') + (x.open ? ' opens' : '') + '" data-node="' + h(id) + '"' + x.open + tip(x.tip) + (x.open ? ' tabindex="0" role="button" aria-label="' + h(x.name) + ', ' + plural(x.n, 'thread') + '"' : '') + '>' +
        '<rect x="' + n.x + '" y="' + n.y + '" width="' + nw + '" height="' + n.h.toFixed(2) + '" rx="2" fill="' + o.fill(id) + '"' + (x.stroke ? ' stroke="' + x.stroke + '" stroke-width="1.5"' + (x.dash ? ' stroke-dasharray="3 2"' : '') : '') + '/>' + x.text + '</g>';
    }).join('');
    return { links: links, nodes: nodes };
  }

  // Day by day, on the Gmail tab: each thread on the day its last message arrived, so a filter's start shows where the
  // hollow marks (mail it didn't label) give way to solid ones. Labelboard's filters by column, then yours.
  var SHORT = { filter: 'by a filter', early: 'at Apply', hand: 'by hand', missed: 'came before the filter', would: 'once you apply' };
  function dayRows() {
    var tr = ctx.trace(), win = S.snapshot.window, days = win && win.days || 30;
    return rowsHtml(I.filterRows(tr.t, tr.filters, S.config, Date.parse(S.snapshot.generatedAt), days), tr, days);
  }
  function rowsHtml(rows, tr, days) {
    var at = {}; tr.filters.forEach(function (f) { var b = f.live && f.ours && f.at && R.bucketOfLabel(f.label, S.config); if (b) at[b.id] = Math.min(at[b.id] || Infinity, f.at); });
    var now = Date.parse(S.snapshot.generatedAt), live = rows.yours.filter(function (r) { return r.n.all; });
    var blind = rows.yours.filter(function (r) { return !r.preview; }).length, none = rows.yours.length - live.length - blind;
    var key = function (k, t) { return '<span class="fk fk-' + k + '">' + h(t) + '</span>'; };
    return '<h3 class="v-h">Day by day</h3><p class="v-note">Each mark is a thread, on the day its last message came in; the left block is everything older than ' + days + ' days. ' +
      'Where hollow marks give way to solid ones is roughly when a filter started.</p>' +
      '<div class="fk-row">' + key('filter', 'Labelled, a filter matches') + key('early', 'Labelled at Apply') + key('hand', 'Labelled by hand') + key('missed', 'Came before the filter: no label') + key('would', 'Caught once you apply') + '</div>' +
      '<div class="frs">' + (rows.columns.length ? '<h4 class="frs-h">Labelboard\'s, by column</h4>' + rows.columns.map(function (r) {
        var b = r.bucket, s = ctx.colStatus(b);
        return rowHtml(' data-ours="' + h(b.id) + '"', '<span class="fr-t">' + h(b.name) + '</span>' + ctx.labelChip(b) + (s ? '<span class="fr-s">' + h(ctx.fsText(s, b)) + '</span>' : ''),
          r, colorOf(b.id), at[b.id], now, days);
      }).join('') : '') +
      (live.length ? '<h4 class="frs-h">Yours</h4>' + live.map(function (r) {
        var b = R.bucketOfLabel(r.filter.label, S.config);
        return rowHtml(' data-filter="' + h(r.filter.gid) + '"', '<span class="fr-q">' + h(r.filter.query) + '</span>' + ctx.nameChip(r.filter.label), r, b ? colorOf(b.id) : 'var(--muted)', null, now, days);
      }).join('') : '') + '</div>' +
      (none || blind ? '<p class="v-note">' + [none ? plural(none, 'filter') + ' of yours match' + (none === 1 ? 'es' : '') + ' nothing Labelboard read' : '',
        blind ? plural(blind, 'filter') + ' of yours search' + (blind === 1 ? 'es' : '') + ' for things Labelboard can\'t see, such as words in the message or list:' : ''].filter(Boolean).join('. ') + '.</p>' : '');
  }
  function rowHtml(open, name, r, color, madeAt, now, days) {
    // days share one scale; the older block is a full-height share bar, so a long past doesn't flatten the days
    var max = Math.max.apply(null, r.bins.slice(1).map(function (b) { return b.n; }).concat(1)), bw = 10, gap = 8, Wd = (days + 1) * bw + gap, Hd = 30;
    var bars = r.bins.map(function (b, i) {
      if (!b.n) return '';
      var x = i * bw + (i ? gap : 0) + 1.5, y = Hd, parts = '', whenText = i ? new Date(now - (days - i) * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Older than ' + days + ' days';
      ['filter', 'early', 'hand', 'missed', 'would'].forEach(function (k) {
        if (!b[k]) return;
        var hh = Math.max(2.5, (Hd - 2) * b[k] / (i ? max : b.n)); y -= hh;
        var st = k === 'filter' ? 'fill="' + color + '"' : k === 'early' ? 'fill="' + color + '" fill-opacity=".4"' : k === 'hand' ? 'fill="var(--hatch)"'
          : k === 'missed' ? 'fill="none" stroke="' + color + '" stroke-width="1.5"' : 'fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="2 2"';
        parts += '<rect x="' + x + '" y="' + (y + 0.75).toFixed(2) + '" width="' + (bw - 3) + '" height="' + Math.max(1, hh - 1.5).toFixed(2) + '" rx="1" ' + st + ' vector-effect="non-scaling-stroke"/>';
      });
      return '<g' + tip('<b>' + h(whenText) + '</b><br>' + ['filter', 'early', 'hand', 'missed', 'would'].filter(function (k) { return b[k]; }).map(function (k) { return plural(b[k], 'thread') + ' ' + SHORT[k]; }).join('<br>')) + '>' +
        '<rect x="' + (x - 1.5) + '" y="0" width="' + bw + '" height="' + Hd + '" fill="transparent"/>' + parts + '</g>';
    }).join('');
    var made = madeAt && madeAt > now - days * 864e5 ? (function () { var x = (days - Math.floor((now - madeAt) / 864e5)) * bw + gap; return '<line class="fr-made" x1="' + x + '" x2="' + x + '" y1="-2" y2="' + (Hd + 2) + '"' + tip('Labelboard made this filter on ' + h(new Date(madeAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))) + '/>'; })() : '';
    var counts = ['filter', 'early', 'hand', 'missed', 'would'].filter(function (k) { return r.n[k]; }).map(function (k) { return '<span class="fk fk-' + k + '" title="' + h(plural(r.n[k], 'thread') + ' ' + SHORT[k]) + '">' + fmt(r.n[k]) + '</span>'; }).join('');
    return '<div class="fr"><button type="button" class="fr-name"' + open + '>' + name + '</button>' +
      '<svg class="fr-strip" viewBox="0 -2 ' + Wd + ' ' + (Hd + 4) + '" preserveAspectRatio="none" role="img" aria-label="' + h(plural(r.n.all, 'thread') + ' over time') + '">' +
      '<line class="fr-base" x1="0" x2="' + Wd + '" y1="' + Hd + '" y2="' + Hd + '"/>' + bars + made + '</svg><div class="fr-n">' + counts + '</div></div>';
  }
  function hotFlow(g, on) {
    var svg = g.closest('svg'), id = g.dataset.node;
    svg.classList.toggle('focus', on);
    svg.querySelectorAll('.link').forEach(function (l) { l.classList.toggle('on', on && (l.dataset.from === id || l.dataset.to === id)); });
  }

  // ---------- the pane under the board: folded, Gmail now vs after Apply and the last move; open, the flow you drop cards in ----------
  function pane() {
    var el = $('pane'), p = ctx.ui().pane || {}, f = S.snapshot && S.snapshot.threads.length && I.shift(S.snapshot, S.built, S.config, { max: 24, keep: S.lastMove && S.lastMove.key, owned: S.gmail && S.gmail.ownedLabels });
    if (!f || !f.total) { el.hidden = true; return; }
    tips = {}; tipSeq = 0; hideTip();
    el.hidden = false; el.classList.toggle('open', !!p.open);
    if (document.body.dataset.view === 'board') $('rack').classList.toggle('compact', !!p.open); // room for the flow
    el.style.height = p.open ? paneH(p.h || window.innerHeight * 0.45) + 'px' : '';
    var bar = function (list, after) {
      return '<div class="pane-bar">' + list.map(function (n) {
        var b = n.bucket && ctx.bucket(n.bucket), name = n.bucket ? nameOf(n.bucket) : 'In your inbox, no label', bg = colorOf(n.bucket), out = after ? n.leaves : 0;
        var seg = function (k, leaves) { return k ? '<i class="seg' + (leaves ? ' leaves' : '') + '" style="flex-grow:' + k + ';background-color:' + bg + '"' + tip('<b>' + h(name) + '</b><br>' + plural(k, 'inbox thread') +
          (after ? (leaves ? ' leave the inbox' : ' stay in the inbox') + (b && b.label ? ', labelled ' + h(b.label) : '') : b && b.label ? ' labelled ' + h(b.label) + ' in Gmail now' : n.bucket ? ' with no column label in Gmail now' : ' without a column\'s label in Gmail now, labelled on Apply')) + '></i>' : ''; };
        return seg(n.n - out, false) + seg(out, true);
      }).join('') + '</div>';
    };
    var move = ctx.moveLine();
    var html = '<div class="pane-head"><button type="button" class="pane-grip" id="pane-grip" aria-expanded="' + !!p.open + '" title="' + (p.open ? 'Drag to resize, click to fold' : 'Show the flow') + '"><span></span></button>' +
      '<div class="pane-rows"><span class="pane-k">Gmail now</span>' + bar(f.layers[0], false) + '<span class="pane-k">After Apply</span>' + bar(f.layers[2], true) + '</div>' +
      '<div class="pane-side"><p class="pane-move">' + (move || (f.changed ? '<b>' + fmt(f.changed) + '</b> of ' + plural(f.total, 'inbox thread') + ' change when you apply.' : 'Gmail already looks like the board.')) + '</p>' +
      '<button type="button" class="linkish" id="pane-toggle">' + (p.open ? 'Fold the flow' : 'Show the flow') + '</button></div></div>';
    if (p.open) html += '<div class="pane-flow v-scroll">' + shiftSvg(f, Math.max(720, el.clientWidth - 64), Math.max(140, el.clientHeight - 96)) + '</div>';
    el.innerHTML = html;
  }
  // The open pane's height: at least 220 px, and the board above it keeps 240 px for its column heads and a card or two.
  function paneH(want) { var room = window.innerHeight - $('board').getBoundingClientRect().top - 254; return Math.round(Math.max(220, Math.min(room, want))); }
  // The flow in the pane: left the inbox by the label Gmail has now, middle the cards, right the columns after Apply.
  // Bands Apply leaves as they are are faint; drop a card's bar on a column to move it (wirePane).
  function shiftSvg(f, W, H) {
    var L = I.flowLayout(f, { width: W, height: H, minH: 8, gap: 4, labelWidth: Math.min(220, W * 0.2), rightWidth: 200 }), N = L.nodes, nw = L.nodeWidth, info = {};
    f.layers.forEach(function (l) { l.forEach(function (n) { info[n.id] = n; }); });
    var label = function (id) { var n = info[id]; return id === 'now:none' ? 'No label yet' : id.indexOf('card:') === 0 || id.indexOf('more:') === 0 ? n.title : nameOf(n.bucket); };
    var fill = function (id) { return id === 'now:none' ? 'var(--hatch)' : colorOf(info[id].bucket); };
    var changes = function (n) { return n.ch ? fmt(n.ch) + ' change on Apply' : 'nothing changes on Apply'; };
    var drawn = sankey(L, {
      fill: fill, linkClass: function (l) { return l.ch ? '' : ' faint'; },
      linkColor: function (l) { return fill(l.to.indexOf('col:') === 0 ? l.to : l.from); },
      linkTip: function (l) { return plural(l.n, 'thread') + ': ' + h(label(l.from)) + ' → ' + h(label(l.to)) + '<br>' + changes(l); },
      node: function (id, n) {
        var x = info[id], cy = n.y + n.h / 2, name = label(id), left = n.layer === 0, card = !!x.key, col = id.indexOf('col:') === 0;
        return { name: name, n: x.n, open: card ? ' data-card="' + h(x.key) + '"' : col ? ' data-drop="' + h(x.bucket) + '"' : '', stroke: S.lastMove && x.key === S.lastMove.key ? 'var(--accent)' : null,
          tip: '<b>' + h(name) + '</b><br>' + plural(x.n, 'inbox thread') + ', ' + changes(x) + (col && x.leaves ? '<br>' + fmt(x.leaves) + ' leave the inbox' : '') +
            (x.more ? '<br>Each has a few threads. Open the column on the board to see them.' : '') + (card ? '<br><i>Drag onto a column on the right to move it, or click to open</i>' : ''),
          text: left ? '<text x="' + (n.x - 8) + '" y="' + cy + '" text-anchor="end">' + h(short(name, 26)) + ' <tspan class="n">' + fmt(x.n) + '</tspan></text>'
            : '<text x="' + (n.x + nw + 8) + '" y="' + cy + '" class="halo">' + h(short(name, col ? 30 : 24)) + ' <tspan class="n">' + fmt(x.n) + (col && x.leaves ? ' · ' + fmt(x.leaves) + ' out' : '') + '</tspan></text>' };
      },
    });
    var heads = '<text class="lh" x="' + (N[f.layers[0][0].id].x + nw) + '" y="-12" text-anchor="end">Gmail now</text><text class="lh" x="' + N[f.layers[1][0].id].x + '" y="-12">Cards</text>' +
      '<text class="lh" x="' + N[f.layers[2][0].id].x + '" y="-12">After Apply</text>';
    return '<svg class="flow shift" width="' + W + '" height="' + (L.height + 24) + '" viewBox="0 -24 ' + W + ' ' + (L.height + 24) + '" role="img" aria-label="' +
      h(fmt(f.total) + ' inbox threads from Gmail now to after Apply, ' + fmt(f.changed) + ' change') + '">' + PATTERN + '<g class="links">' + drawn.links + '</g>' + heads + drawn.nodes + '</svg>';
  }
  // The pane's own pointer work: the grip folds and resizes, a card's bar drags onto a column.
  function wirePane() {
    var el = $('pane'), drag = null, dragged = false;
    var setOpen = function (open, hh) { var p = ctx.ui().pane = ctx.ui().pane || {}; p.open = open; if (hh) p.h = hh; ctx.save(); pane(); };
    el.addEventListener('click', function (e) {
      if (dragged) { e.stopImmediatePropagation(); e.preventDefault(); dragged = false; return; }
      if (e.target.closest('#pane-toggle')) return setOpen(!(ctx.ui().pane || {}).open);
      if (e.target.closest('[data-undo-move]')) return ctx.undoMove();
    }, true);
    el.addEventListener('pointerdown', function (e) {
      var g = e.target.closest('#pane-grip'), c = e.target.closest('.shift [data-card]'); dragged = false;
      if (!g && !c || e.button) return;
      drag = { grip: !!g, key: c && c.dataset.card, x: e.clientX, y: e.clientY, h: el.offsetHeight, on: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.on && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return;
      drag.on = true; hideTip();
      if (drag.grip) { el.classList.add('open'); el.style.height = paneH(drag.h + drag.y - e.clientY) + 'px'; return; }
      var ghost = $('pane-ghost') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'pane-ghost', className: 'pane-ghost' }));
      ghost.textContent = S.cardByKey[drag.key].title; ghost.style.left = e.clientX + 12 + 'px'; ghost.style.top = e.clientY + 8 + 'px';
      var hot = document.elementFromPoint(e.clientX, e.clientY), d = hot && hot.closest('[data-drop]');
      el.querySelectorAll('[data-drop].hot').forEach(function (x) { if (x !== d) x.classList.remove('hot'); });
      if (d) d.classList.add('hot');
    });
    var end = function (e) {
      if (!drag) return;
      var was = drag; drag = null; dragged = true; // the click that follows lands on the pane (pointer capture): swallow it
      var ghost = $('pane-ghost'); if (ghost) ghost.remove();
      if (!was.on) return was.grip ? setOpen(!(ctx.ui().pane || {}).open) : ctx.openCard(was.key); // a click: fold or open the flow, or open the card
      if (was.grip) return setOpen(true, el.offsetHeight);
      var hot = e && document.elementFromPoint(e.clientX, e.clientY), d = hot && hot.closest('[data-drop]');
      if (d && d.dataset.drop !== R.placement(S.cardByKey[was.key], S.config).bucket) ctx.moveCard(was.key, d.dataset.drop);
      else pane();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('keydown', function () { dragged = false; }, true); // Enter on a card clicks it with no pointer
    el.addEventListener('pointercancel', function () { end(null); });
    window.addEventListener('resize', function () { if ((ctx.ui().pane || {}).open && document.body.dataset.view === 'board') pane(); });
  }

  // ---------- Inbox: who writes ----------
  function overviewHtml(W, pick) {
    var o = I.overview(S.snapshot, S.built, S.config, Date.now(), { perColumn: 14, top: 10 });
    if (!o.inbox) return head('Inbox', 'Nothing in your inbox to show.') + pick;
    var size = Math.max(300, Math.min(W > 900 ? W * 0.52 : W, 620));
    return head('Inbox', 'Who fills your inbox. Each bubble is a card (a company, a sender, a subject rule), sized by its inbox threads and grouped by column.') + '<div class="tb-tools">' + pick + '</div>' +
      kpis([{ n: fmt(o.inbox), l: 'inbox threads' }, { n: pct(o.people, o.inbox), l: 'from people (' + fmt(o.people) + ')', accent: true },
        { n: fmt(o.machine), l: 'automated' }, { n: pct(o.answered, o.people), l: 'of threads from people are answered' }, { n: fmt(o.starred), l: 'starred' }, { n: o.oldestDays + ' days', l: 'oldest thread' }]) +
      '<div class="ov-grid"><div class="ov-pack">' + packSvg(o, size) + '</div><div class="ov-side">' +
      '<h3 class="v-h">Columns</h3><ul class="ov-cols">' + o.columns.map(function (c) {
        return '<li><span class="dot" style="background:' + colorOf(c.id) + '"></span><span class="ov-name">' + h(c.bucket.name) + '</span>' +
          '<span class="ov-bar"><i style="width:' + (100 * c.n / o.columns.reduce(function (m, x) { return Math.max(m, x.n); }, 1)).toFixed(1) + '%;background:' + colorOf(c.id) + '"></i></span>' +
          '<span class="ov-n">' + fmt(c.n) + '</span></li>';
      }).join('') + '</ul><h3 class="v-h">Who writes the most</h3><ol class="ov-top">' + o.top.map(function (c) {
        return '<li><button type="button" class="ov-who' + (hit(c.title) ? '' : ' dim') + '" data-card="' + h(c.key) + '">' + avatar(c.title, c.bucket, 30) +
          '<span class="ov-name">' + h(c.title) + '<small>' + h(nameOf(c.bucket)) + '</small></span><span class="ov-n">' + fmt(c.n) + '</span></button></li>';
      }).join('') + '</ol></div></div>' + monthsHtml(o.months);
  }
  function avatar(title, bucketId, px) {
    var bg = ctx.bandOf(ctx.bucket(bucketId)) || '#bdb8cc';
    return '<span class="avatar" style="width:' + px + 'px;height:' + px + 'px;background:' + bg + ';color:' + ctx.textOn(bg) + '" aria-hidden="true">' + h(I.initials(title)) + '</span>';
  }
  // Two packs: cards inside each column's circle, then the columns. Area ∝ threads.
  function packSvg(o, size) {
    var groups = o.columns.map(function (c) {
      var items = c.cards.map(function (x) { return { r: Math.sqrt(x.n), card: x }; });
      if (c.rest) items.push({ r: Math.sqrt(c.rest.n), rest: c.rest });
      var p = I.pack(items.map(function (x) { return x.r; }), 0.25);
      p.circles.forEach(function (cc, i) { cc.item = items[i]; });
      return { col: c, inner: p, r: p.r + 0.9 };
    });
    var outer = I.pack(groups.map(function (g) { return g.r; }), 0.8), s = (size / 2 - 4) / (outer.r || 1), cx = size / 2;
    var out = groups.map(function (g, i) {
      var gc = outer.circles[i], gx = cx + gc.x * s, gy = cx + gc.y * s, col = g.col, color = colorOf(col.id);
      var ring = '<circle class="ov-col" cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="' + (g.r * s).toFixed(1) + '" stroke="' + color + '"' +
        tip('<b>' + h(col.bucket.name) + '</b><br>' + plural(col.n, 'thread') + (col.leaves ? ', ' + fmt(col.leaves) + ' skip the inbox after sorting' : '')) + '/>';
      return ring + g.inner.circles.map(function (c) {
        var x = gx + c.x * s, y = gy + c.y * s, r = c.r * s, it = c.item, bg = ctx.bandOf(col.bucket) || '#bdb8cc';
        if (it.rest) return '<circle class="ov-rest" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '"' +
          tip(plural(it.rest.cards, 'smaller card') + ' in ' + h(col.bucket.name) + '<br>' + plural(it.rest.n, 'thread')) + '/>' +
          (r >= 14 ? '<text class="ov-rest-t" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">+' + it.rest.cards + '</text>' : '');
        var k = it.card, dim = hit(k.title) ? '' : ' dim';
        return '<g class="ov-b' + dim + '"' + (k.key ? ' data-card="' + h(k.key) + '" tabindex="0" role="button" aria-label="' + h(k.title + ', ' + plural(k.n, 'thread')) + '"' : '') +
          tip('<b>' + h(k.title) + '</b><br>' + plural(k.n, 'thread') + ' · ' + h(col.bucket.name) + (k.key ? '<br><i>Click to open</i>' : '')) + '>' +
          '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + Math.max(0.5, r - 0.6).toFixed(1) + '" fill="' + bg + '"/>' +
          (r >= 11 ? '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" fill="' + ctx.textOn(bg) + '" style="font-size:' + Math.min(16, r * 0.75).toFixed(1) + 'px">' + h(I.initials(k.title)) + '</text>' : '') + '</g>';
      }).join('');
    }).join('');
    return '<svg class="pack" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Inbox threads by card and column">' + out + '</svg>';
  }
  function monthsHtml(ms) {
    if (ms.length < 2) return '';
    var max = Math.max.apply(null, ms.map(function (m) { return m.n; })), H = 120;
    var bars = ms.map(function (m) {
      var hh = max ? Math.max(m.n ? 2 : 0, H * m.n / max) : 0, lbl = new Date(m.month + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      return '<div class="mo"' + tip('<b>' + h(lbl) + '</b><br>' + plural(m.n, 'thread') + ' last active') + '><span class="mo-v">' + (m.n === max ? fmt(m.n) : '') + '</span><i style="height:' + hh.toFixed(1) + 'px"></i><span class="mo-l">' + h(lbl) + '</span></div>';
    }).join('');
    return '<h3 class="v-h">Inbox threads by month of their last message</h3><div class="months" style="--h:' + H + 'px">' + bars + '</div>' +
      '<p class="note">Only mail still in your inbox: what you archived isn\'t counted.</p>';
  }

  // ---------- Inbox: every thread ----------
  function threadsHtml(mode, pick) {
    var g = I.grid(S.snapshot, S.built, S.config), now = Date.now();
    if (!g.length) return head('Inbox', 'Nothing in your inbox to show.') + pick;
    var ageOf = function (t) { var d = (now - Date.parse(t.date)) / 864e5; return d <= 7 ? 0 : d <= 30 ? 1 : d <= 90 ? 2 : 3; };
    var AGES = ['This week', 'This month', '1–3 months', 'Older'];
    var blocks = g.map(function (c) {
      var color = colorOf(c.id), leaves = 0;
      var groups = c.cards.map(function (k) {
        var match = hit(k.title);
        var cells = k.threads.map(function (p) {
          var t = p.t; if (p.out) leaves++;
          var on = match || hit(t.from) || hit(t.subject);
          return '<i class="cell' + (p.out ? ' leaves' : '') + (mode === 'age' ? ' a' + ageOf(t) : '') + (on ? '' : ' dim') + '"' +
            tip('<b>' + h(t.subject || '(no subject)') + '</b><br>' + h(t.fromName ? t.fromName + ' · ' + t.from : t.from) + '<br>' + h(day(t.date)) +
              (t.count > 1 ? ' · ' + t.count + ' messages' : '') + (I.waitsSince(t) == null ? ' · answered' : '') +
              '<br>' + h(k.title) + ' → ' + h(c.bucket.name) + (p.later ? ', leaves the inbox within the hour after Apply' : p.leaves ? ', skips the inbox' : '')) + '></i>';
        }).join('');
        return '<span class="tg"' + (k.key ? ' data-card="' + h(k.key) + '" tabindex="0" role="button" aria-label="' + h(k.title + ', ' + plural(k.threads.length, 'thread')) + '"' : '') + '>' + cells + '</span>';
      }).join('');
      return '<section class="tb" style="--c:' + color + '"><div class="tb-head"><span class="dot" style="background:' + color + '"></span><h3>' + h(c.bucket.name) + '</h3><span class="count">' + fmt(c.n) + '</span>' +
        (leaves ? '<span class="tb-sub">' + fmt(leaves) + ' skip the inbox</span>' : '') + '</div><div class="tb-cells">' + groups + '</div></section>';
    }).join('');
    var key = mode === 'age' ? AGES.map(function (a, i) { return '<span><i class="cell a' + i + '"></i>' + a + '</span>'; }).join('')
      : '<span><i class="cell" style="--c:var(--muted)"></i>Stays in the inbox</span><span><i class="cell leaves" style="--c:var(--muted)"></i>Skips the inbox after sorting</span>';
    return head('Inbox', 'Every inbox thread is one square, grouped by column and card' + (mode === 'age' ? ', coloured by age' : '') + '. Hover a square to see the thread; click it to open its card.') +
      '<div class="tb-tools">' + pick + '<div class="tb-key">' + key + '</div></div><div class="tblocks' + (mode === 'age' ? ' by-age' : '') + '">' + blocks + '</div>';
  }

  // ---------- Priorities ----------
  function prioritiesHtml() {
    var o = ctx.prioOpts(), p = I.priorities(S.snapshot, S.built, S.config, Date.now(), o), pace = Number(ctx.ui().pace) || 2;
    if (!p.inbox) return head('Priorities', 'Nothing in your inbox to show.');
    var list = p.waiting.filter(function (w) { return hit(w.title) || hit(w.t.from) || hit(w.t.subject); });
    var mins = p.waiting.length * pace, hours = mins / 60, old = S.snapshot.threads.filter(function (t) { return !t.msgs; }).length;
    var A = [['week', 'This week'], ['month', 'This month'], ['quarter', '1–3 months'], ['older', 'Older']], amax = Math.max.apply(null, A.map(function (a) { return p.ages[a[0]]; }).concat(1));
    return head('Priorities', 'What in your inbox waits on you: threads from people where the last message is theirs, most pressing first (starred, marked important by Gmail, in a column for what mail is about, waiting longest).') +
      kpis([{ n: fmt(p.waiting.length), l: 'from people, waiting on your answer', accent: true }, { n: fmt(p.recent.week), l: 'active in the last 7 days' },
        { n: pct(p.answered, p.people), l: 'of threads from people are answered' }, { n: fmt(p.machineStays), l: 'automated, still in your inbox after sorting' }]) +
      '<div class="pr-grid"><div><h3 class="v-h">Time to clear</h3><p class="pr-time"><b>' + (hours >= 1 ? (Math.round(hours * 10) / 10) + ' hours' : Math.round(mins) + ' minutes') + '</b> to go through ' + plural(p.waiting.length, 'thread') +
      ' at <label><input id="pr-pace" type="number" min="0.5" max="30" step="0.5" value="' + pace + '"> min</label> each.</p>' +
      '<p class="note">Your own pace, not a norm: published benchmarks for this are mostly vendor surveys. Archiving, or a column that leaves the inbox (right away, after some days or once read), removes threads from this count.</p>' +
      '<h3 class="v-h">How long they have waited</h3><ul class="pr-ages">' + A.map(function (a, i) {
        var n = p.ages[a[0]];
        return '<li><span>' + a[1] + '</span><span class="ov-bar"><i class="a' + i + '" style="width:' + (100 * n / amax).toFixed(1) + '%"></i></span><span class="ov-n">' + fmt(n) + '</span></li>';
      }).join('') + '</ul>' +
      (p.noise.length ? '<h3 class="v-h">Automated mail that stays in your inbox</h3><ul class="pr-noise">' + p.noise.map(function (x) {
        return '<li><button type="button" class="linkish" data-card="' + h(x.key || '') + '">' + h(x.title) + '</button><span class="note">' + h(nameOf(x.bucket)) + '</span><span class="ov-n">' + fmt(x.n) + '</span></li>';
      }).join('') + '</ul><p class="note">Machine senders on cards that stay in the inbox. Open one to send single threads, or the whole card, to a column that skips the inbox.</p>' : '') +
      '</div><div><h3 class="v-h">Start here</h3>' + prioPicks(p, o) + '<ol class="pr-list" id="pr-start">' + list.slice(0, 40).map(function (w) {
        var t = w.t, star = t.labels.indexOf('STARRED') >= 0;
        return '<li><a href="' + h(ctx.threadUrl(t.id)) + '" target="_blank" rel="noopener" class="pr-row">' +
          '<span class="pr-subj">' + (star ? '<span class="star" aria-label="Starred">★</span> ' : '') + h(t.subject || '(no subject)') + '</span>' +
          '<span class="pr-meta"><span class="dot" style="background:' + colorOf(w.bucket) + '"></span>' + h(w.title || nameOf(w.bucket)) + ' · ' + h(t.fromName || t.from) + ' · ' + h(ago(w.days)) + '</span></a>' +
          '<button type="button" class="pr-hide" data-hide="' + h(t.id) + '" data-date="' + h(t.date) + '" title="Hide it until a new message comes in" aria-label="' + h('Hide ' + (t.subject || 'this thread')) + '">Hide</button></li>';
      }).join('') + '</ol>' + (list.length > 40 ? '<p class="note">Showing 40 of ' + fmt(list.length) + '. Find a sender above to narrow it.</p>' : '') + '</div></div>' +
      '<p class="note">These counts cover your inbox. A thread waits on you when its last message is someone else\'s' +
      (old ? '; for ' + plural(old, 'thread') + ' read before Labelboard kept each message\'s time, any message of yours in it counts as an answer' : '') + '.</p>' + repliesHtml();
  }
  // Over the list: the colleagues switch (once colleague-only threads wait, or it's on) and what you hid.
  function prioPicks(p, o) {
    var sw = p.colleagues || o.colleaguesOut ? '<label class="check"><input type="checkbox" id="pr-colleagues"' + (o.colleaguesOut ? ' checked' : '') + '> Leave out threads with only colleagues on them' + (p.colleagues ? ' (' + fmt(p.colleagues) + ')' : '') + '</label>' : '';
    var hid = p.hidden ? '<p class="note">' + plural(p.hidden, 'thread') + ' hidden until a new message comes in. <button type="button" class="linkish" id="pr-unhide">Show ' + (p.hidden > 1 ? 'them' : 'it') + ' again</button></p>' : '';
    return sw || hid ? '<div class="pr-picks">' + sw + hid + '</div>' : '';
  }
  var dur = function (s) { return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : (Math.round(s / 8640) / 10) + ' days'; };
  // Your replies over the last 30 days, inbox and archived: needs the window read, offered here first.
  function repliesHtml() {
    var win = S.snapshot.window, on = win && !win.error && !win.off, nd = on && win.days || 30;
    var title = '<h3 class="v-h">Your replies, last ' + nd + ' days</h3>';
    if (!on) {
      return '<section class="pr-replies pr-optin">' + title +
        (win && win.error ? '<p><b>The last 30 days didn\'t fit.</b> Apps Script keeps 500 KB for everything Labelboard stores, and that much mail went over it. The inbox read is saved; reply numbers are off.</p>' :
          '<p>How many threads from people you answered, how fast, and which ones you archived without answering. For this Labelboard also reads the last 30 days of archived and sent mail: the same details as for the inbox (sender, recipients, subject, labels, dates), never what a message says. The board and Flow then show the mail that skipped your inbox too.</p>') +
        '<p class="note">The first time takes about 7 minutes per 1,000 threads. After that, Read mail again keeps it current, usually in seconds.</p>' +
        '<button class="btn primary" type="button" id="pr-window"' + (ctx.canRead ? '' : ' disabled') + '>' + (win && win.error ? 'Try again' : 'Read the last 30 days') + '</button>' +
        (ctx.canRead ? '' : '<p class="note">The preview reads files on this computer: ask Claude to refresh them.</p>') + '</section>';
    }
    var r = I.replies(S.snapshot, S.built, S.recent, S.config, Date.now(), win.days);
    var SP = [['hour', 'Within an hour'], ['day', 'Within a day'], ['days', '1–3 days'], ['longer', 'Longer']], smax = Math.max.apply(null, r.speed.map(function (s) { return s.n; }).concat(1));
    var arch = r.archived.filter(function (w) { return hit(w.title) || hit(w.t.from) || hit(w.t.subject); });
    return '<section class="pr-replies">' + title +
      '<p class="note">Inbox and archived mail since ' + h(day(win.since)) + ', from the last read. A thread counts when a person wrote in it in these ' + nd + ' days; it is answered when the last message is yours.' +
        (win.shrunk ? ' Fewer than 30 days: 30 didn\'t fit in the 500 KB Apps Script keeps for Labelboard.' : '') + '</p>' +
      kpis([{ n: fmt(r.people), l: 'threads where people wrote to you' }, { n: pct(r.answered, r.people), l: 'answered (' + fmt(r.answered) + ')', accent: true },
        { n: r.median == null ? '–' : dur(r.median), l: 'typical time to answer (median)' }, { n: fmt(win.sent), l: 'messages you sent' }, { n: fmt(win.received), l: 'messages you received' }]) +
      '<div class="pr-grid"><div><h3 class="v-h">How fast you answer</h3><ul class="pr-ages">' + SP.map(function (s, i) {
        var n = r.speed[i].n;
        return '<li><span>' + s[1] + '</span><span class="ov-bar"><i class="a' + i + '" style="width:' + (100 * n / smax).toFixed(1) + '%"></i></span><span class="ov-n">' + fmt(n) + '</span></li>';
      }).join('') + '</ul><p class="note">' + plural(r.replies, 'answer') + ', each timed from their first message you hadn\'t answered yet.</p>' +
      (r.columns.length ? '<h3 class="v-h">By column</h3><ul class="pr-cols"><li class="pr-cols-h"><span>Column</span><span>Threads</span><span>Answered</span><span>Typical</span></li>' + r.columns.map(function (c) {
        return '<li><span class="ov-name"><span class="dot" style="background:' + colorOf(c.id) + '"></span>' + h(c.bucket.name) + '</span><span class="ov-n">' + fmt(c.people) + '</span><span class="ov-n">' + pct(c.answered, c.people) + '</span><span class="ov-n">' + (c.median == null ? '–' : dur(c.median)) + '</span></li>';
      }).join('') + '</ul>' : '') +
      '</div><div><h3 class="v-h">Archived without your answer</h3>' + (arch.length ? '<ol class="pr-list">' + arch.slice(0, 25).map(function (w) {
        var t = w.t;
        return '<li><a href="' + h(ctx.threadUrl(t.id, true)) + '" target="_blank" rel="noopener" class="pr-row"><span class="pr-subj">' + h(t.subject || '(no subject)') + '</span>' +
          '<span class="pr-meta"><span class="dot" style="background:' + colorOf(w.bucket) + '"></span>' + h(w.title || nameOf(w.bucket)) + ' · ' + h(t.fromName || t.from) + ' · ' + h(ago(w.days)) + '</span></a></li>';
      }).join('') + '</ol>' + (arch.length > 25 ? '<p class="note">Showing 25 of ' + fmt(arch.length) + '. Find a sender above to narrow it.</p>' : '')
        : '<p class="note">' + (r.archived.length ? 'None match your search.' : 'None: every thread from people you archived in these ' + nd + ' days has your answer as its last message.') + '</p>') +
      '<p class="note">The last message is theirs and the thread left the inbox. Many need nothing more (a thank-you); some slipped.</p></div></div>' +
      (r.partial ? '<p class="note">' + plural(r.partial, 'thread') + ' from these ' + nd + ' days were read before Labelboard kept message times and aren\'t counted.</p>' : '') +
      '<p class="note">' + plural(win.threads, 'archived or sent thread') + ' from these ' + nd + ' days are kept for this and for the board.' +
      (ctx.canRead ? ' <button type="button" class="linkish" id="pr-window-off">Stop reading the last ' + nd + ' days</button>' : '') + '</p></section>';
  }
  function wirePriorities() {
    var w = $('pr-window'); if (w) w.onclick = function () { ctx.refresh({ window: true }); };
    var off = $('pr-window-off'); if (off) off.onclick = function () { ctx.windowOff(); };
    var cl = $('pr-colleagues'); if (cl) cl.onchange = function () { if (this.checked) ctx.ui().colleaguesOut = true; else delete ctx.ui().colleaguesOut; ctx.save(); render('priorities'); $('pr-colleagues').focus(); };
    var un = $('pr-unhide'); if (un) un.onclick = function () { delete ctx.ui().hidden; ctx.save(); render('priorities'); };
    var st = $('pr-start'); if (st) st.onclick = function (e) {
      var b = e.target.closest('[data-hide]'); if (!b) return;
      var i = Array.prototype.indexOf.call(this.children, b.parentNode), u = ctx.ui();
      (u.hidden = u.hidden || {})[b.dataset.hide] = b.dataset.date; ctx.save(); render('priorities');
      var next = document.querySelectorAll('#pr-start .pr-hide'), go = next[Math.min(i, next.length - 1)] || $('pr-unhide'); if (go) go.focus(); // keep the keyboard where it was
    };
    var el = $('pr-pace'); if (!el) return;
    el.onchange = function () { var v = Number(this.value); if (v > 0) { ctx.ui().pace = v; ctx.save(); render('priorities'); $('pr-pace').focus(); } };
  }

  // ---------- tooltip, clicks, hover ----------
  var tipEl = function () { return $('tip'); };
  function showTip(id, x, y) {
    var t = tipEl(); if (!tips[id]) return;
    t.innerHTML = tips[id]; t.hidden = false;
    var r = t.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    t.style.left = Math.max(8, Math.min(vw - r.width - 8, x + 14)) + 'px';
    t.style.top = (y + 16 + r.height > vh - 8 ? y - r.height - 12 : y + 16) + 'px';
  }
  function hideTip() { var t = tipEl(); if (t) t.hidden = true; }
  function wire(v) {
    v.addEventListener('pointermove', function (e) {
      var el = e.target.closest('[data-tip]');
      if (!el) return hideTip();
      showTip(el.dataset.tip, e.clientX, e.clientY);
    });
    v.addEventListener('pointerleave', hideTip);
    v.addEventListener('pointerover', function (e) {
      var g = e.target.closest('.flow .node'); if (g) hotFlow(g, true);
      var tg = e.target.closest('.tg'); if (tg) tg.classList.add('hot');
    });
    v.addEventListener('pointerout', function (e) {
      var g = e.target.closest('.flow .node'); if (g && !g.contains(e.relatedTarget)) hotFlow(g, false);
      var tg = e.target.closest('.tg'); if (tg && !tg.contains(e.relatedTarget)) tg.classList.remove('hot');
    });
    // keyboard focus shows what hover shows
    v.addEventListener('focusin', function (e) {
      var el = e.target.closest('[data-tip]') || e.target.querySelector && e.target.querySelector('[data-tip]'); if (!el) return;
      var r = e.target.getBoundingClientRect(); showTip(el.dataset.tip, r.left, r.bottom - 8);
      var g = e.target.closest('.flow .node'); if (g) hotFlow(g, true);
    });
    v.addEventListener('focusout', function (e) { hideTip(); var g = e.target.closest('.flow .node'); if (g) hotFlow(g, false); });
    v.addEventListener('click', function (e) {
      var c = e.target.closest('[data-card]'); if (c && c.dataset.card) { hideTip(); return ctx.openCard(c.dataset.card); }
      var f = e.target.closest('[data-filter]'); if (f) { hideTip(); return ctx.openFilter(f.dataset.filter); }
      var o = e.target.closest('[data-ours]'); if (o) { hideTip(); return ctx.openOurs(o.dataset.ours); }
      var g = e.target.closest('[data-goto]'); if (g) { hideTip(); return ctx.showView(g.dataset.goto); }
      var m = e.target.closest('[data-inbox]'); if (m) { ctx.ui().inbox = m.dataset.inbox; ctx.save(); render('inbox'); }
    });
    v.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-card], [role="button"][data-filter], [role="button"][data-ours]')) { e.preventDefault(); e.target.click(); }
    });
  }
  wirePane(); wire($('view')); wire($('pane'));
  return { render: render, pane: pane, NAMES: NAMES, hideTip: hideTip, resetTips: resetTips, tip: tip, dayRows: dayRows, colorOf: colorOf };
};
