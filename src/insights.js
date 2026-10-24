// Labelboard insights — pure JS, no DOM: the numbers and layouts behind the board's other views
// (Flow, Overview, All threads, Priorities). Inbox threads from the snapshot the board already holds; the
// reply numbers also take the 30-day window's archived threads.
var LabelboardInsights = (function (R) {
  'use strict';
  var DAY = 864e5;

  // Every inbox thread with where it ends up after sorting: the same per-thread answer the rack counts.
  function places(snapshot, built, config) {
    return placesOf(snapshot.threads.filter(function (t) { return t.labels.indexOf('INBOX') >= 0; }), built, config);
  }
  function placesOf(threads, built, config) {
    var ctx = R.placeCtx(built, config);
    return threads.map(function (t) { var p = R.threadPlace(t, built, config, ctx); p.t = t; return p; });
  }
  function bucketsById(config) { var m = {}; config.buckets.forEach(function (b) { m[b.id] = b; }); return m; }
  // out: archived already (by you or your own filter), though the board's rules would keep mail like it in
  function outcomeOf(p) { return p.leaves ? 'skip' : p.t.labels.indexOf('INBOX') < 0 ? 'out' : p.labelled ? 'labelled' : 'stays'; }
  function sum(list, f) { return list.reduce(function (n, x) { return n + (f ? f(x) : x); }, 0); }

  // ---------- Flow: rules (cards) → labels (columns) → where the mail lands ----------
  // mail: the inbox plus the window's archived threads, so what skips the inbox shows too. opts.max: cards
  // shown by name, the rest fold into one "more" node per column. opts.yours: your Gmail filters
  // ({ id, query, label, threads }), drawn beside the board's rules (Gmail runs both).
  function flow(mail, built, config, opts) {
    opts = opts || {};
    var byB = bucketsById(config), ps = placesOf(mail.threads, built, config), cards = {}, cardByKey = {};
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    ps.forEach(function (p) { var k = p.card || '_none'; cards[k] = (cards[k] || 0) + 1; });
    var keep = {}, max = opts.max || 30;
    Object.keys(cards).sort(function (a, z) { return cards[z] - cards[a] || a.localeCompare(z); }).slice(0, max).forEach(function (k) { keep[k] = 1; });
    var src = {}, l1 = {}, l2 = {}, labels = {}, gone = {}, outs = {};
    ps.forEach(function (p) {
      var k = p.card && keep[p.card] ? p.card : 'more:' + p.bucket, o = outcomeOf(p);
      if (!src[k]) src[k] = k.indexOf('more:') === 0 ? { id: k, key: null, title: '', n: 0, cards: {}, bucket: p.bucket }
        : { id: k, key: k, title: cardByKey[k] ? cardByKey[k].title : 'No card', n: 0, buckets: {} };
      var s = src[k]; s.n++;
      if (s.cards) s.cards[p.card] = 1; else s.buckets[p.bucket] = (s.buckets[p.bucket] || 0) + 1;
      labels[p.bucket] = (labels[p.bucket] || 0) + 1; outs[o] = (outs[o] || 0) + 1;
      if (p.t.labels.indexOf('INBOX') < 0) gone[p.bucket] = (gone[p.bucket] || 0) + 1;
      var a = k + '\u0000col:' + p.bucket, b = 'col:' + p.bucket + '\u0000out:' + o; // node ids: card key, col:<column>, out:<outcome>
      l1[a] = (l1[a] || 0) + 1; l2[b] = (l2[b] || 0) + 1;
    });
    var order = config.buckets.map(function (b) { return b.id; });
    var rank = function (id) { var i = order.indexOf(id); return i < 0 ? order.length : i; };
    var sources = Object.keys(src).map(function (k) {
      var s = src[k];
      if (s.cards) { s.more = Object.keys(s.cards).length; delete s.cards; s.title = s.more === 1 ? '1 smaller card' : s.more + ' smaller cards'; }
      else { s.bucket = Object.keys(s.buckets).sort(function (a, z) { return s.buckets[z] - s.buckets[a]; })[0]; delete s.buckets; }
      return s;
    }).sort(function (a, z) { return rank(a.bucket) - rank(z.bucket) || !!a.more - !!z.more || z.n - a.n || a.title.localeCompare(z.title); });
    var split = function (m) { return Object.keys(m).map(function (k) { var x = k.split('\u0000'); return { from: x[0], to: x[1], n: m[k] }; }); };
    var yours = (opts.yours || []).filter(function (f) { return f.threads && f.threads.length; }).map(function (f) {
      var b = f.label && R.bucketOfLabel(f.label, config);
      return { id: 'yours:' + f.id, yours: true, filter: f.id, title: f.query, label: f.label, bucket: b ? b.id : null, n: f.threads.length };
    });
    return {
      total: ps.length, archived: ps.filter(function (p) { return p.t.labels.indexOf('INBOX') < 0; }).length, sources: sources, yours: yours,
      labels: order.filter(function (id) { return labels[id]; }).map(function (id) { return { id: 'col:' + id, n: labels[id], archived: gone[id] || 0, bucket: byB[id] }; }),
      outcomes: ['labelled', 'stays', 'skip', 'out'].filter(function (o) { return outs[o]; }).map(function (o) { return { id: 'out:' + o, n: outs[o] }; }),
      links: split(l1).concat(split(l2)),
    };
  }

  // ---------- Before → after: the inbox as Gmail labels it now → cards → the columns after Apply ----------
  // Inbox threads only (Apply re-sorts only those). Every node and link counts `ch`, the threads Apply changes,
  // so the pane can mute what stays put. opts: max cards by name (the rest fold per column), keep (a card key
  // always by name: the one just moved), owned (gmail.ownedLabels, as stats() takes it).
  function shift(snapshot, built, config, opts) {
    opts = opts || {};
    var byB = bucketsById(config), lm = R.labelMapOf(config), ctx = R.placeCtx(built, config), cards = {}, nodes = {}, links = {};
    var inbox = snapshot.threads.filter(function (t) { return t.labels.indexOf('INBOX') >= 0; });
    // now: its column after Apply when Gmail's labels already put it there (or Apply leaves it alone), so the
    // two bars match when nothing changes; else the first column its labels point to, or 'none'
    var nowOf = function (t, p, ch) {
      var cols = t.labels.map(function (l) { return R.bucketForLabel(l, lm); }).filter(function (b) { return b && byB[b] && byB[b].label; });
      var a = byB[p.bucket];
      return !ch || (a && a.label ? cols.indexOf(a.id) >= 0 : !cols.length) ? p.bucket : cols[0] || 'none';
    };
    var rows = inbox.map(function (t) {
      var p = R.threadPlace(t, built, config, ctx), ch = R.threadChange(t, p, opts.owned) ? 1 : 0, k = p.card || '_none';
      var c = cards[k] = cards[k] || { n: 0, ch: 0 }; c.n++; c.ch += ch;
      return { now: nowOf(t, p, ch), card: k, after: p.bucket, leaves: !!p.leaves, ch: ch };
    });
    var keep = {};
    Object.keys(cards).sort(function (a, z) { return (cards[z].ch > 0) - (cards[a].ch > 0) || cards[z].n - cards[a].n || a.localeCompare(z); })
      .slice(0, opts.max || 24).forEach(function (k) { keep[k] = 1; });
    if (opts.keep && cards[opts.keep]) keep[opts.keep] = 1;
    var add = function (id, o) { var n = nodes[id] = nodes[id] || Object.assign({ id: id, n: 0, ch: 0 }, o); n.n++; return n; };
    var link = function (a, b, ch) { var l = links[a + '\u0000' + b] = links[a + '\u0000' + b] || { from: a, to: b, n: 0, ch: 0 }; l.n++; l.ch += ch; };
    var cardByKey = ctx.cardByKey;
    rows.forEach(function (r) {
      var mid = keep[r.card] && r.card !== '_none' ? 'card:' + r.card : 'more:' + r.after;
      var a = add('now:' + r.now, { bucket: r.now === 'none' ? null : r.now }), m = add(mid, mid.indexOf('more:') === 0 ? { bucket: r.after, cards: {} } : { key: r.card, title: cardByKey[r.card].title, bucket: r.after });
      var z = add('col:' + r.after, { bucket: r.after, leaves: 0 });
      a.ch += r.ch; m.ch += r.ch; z.ch += r.ch; if (r.leaves) z.leaves++; if (m.cards) m.cards[r.card] = 1;
      link(a.id, m.id, r.ch); link(m.id, z.id, r.ch);
    });
    // columns without a label (Unsorted, Keep in inbox) come first, where Gmail now shows mail with no label
    var order = config.buckets.filter(function (b) { return !b.label; }).concat(config.buckets.filter(function (b) { return b.label; })).map(function (b) { return b.id; });
    var rank = function (b) { var i = order.indexOf(b); return b == null ? -1 : i < 0 ? order.length : i; };
    var layer = function (pre) { return Object.keys(nodes).filter(function (id) { return id.indexOf(pre) === 0; }).map(function (id) { return nodes[id]; }); };
    var now = layer('now:').sort(function (a, z) { return rank(a.bucket) - rank(z.bucket); });
    var mid = layer('card:').concat(layer('more:')).map(function (n) {
      if (n.cards) { n.more = Object.keys(n.cards).length; delete n.cards; n.title = n.more === 1 ? '1 smaller card' : n.more + ' smaller cards'; }
      return n;
    }).sort(function (a, z) { return rank(a.bucket) - rank(z.bucket) || !!a.more - !!z.more || z.n - a.n || a.title.localeCompare(z.title); });
    var after = layer('col:').sort(function (a, z) { return rank(a.bucket) - rank(z.bucket); });
    return { total: rows.length, changed: rows.filter(function (r) { return r.ch; }).length, layers: [now, mid, after],
      links: Object.keys(links).map(function (k) { return links[k]; }) };
  }

  // Sankey layout for flow(): three layers, node height ∝ threads (with a floor so one thread still shows).
  // Returns nodes { id, layer, x, y, h } and links { from, to, n, y0, y1, w }, plus the drawing height.
  function flowLayout(f, o) {
    var W = o.width, H = o.height, nw = o.nodeWidth || 12, gap = o.gap || 6, minH = o.minH || 3, labelW = o.labelWidth || 180;
    var layers = f.layers || [f.sources, f.labels, f.outcomes], yours = f.yours || [];
    var room = function (list) { return H - Math.max(0, list.length - 1) * gap; };
    var k = Math.min.apply(null, layers.map(function (l) { return room(l) / Math.max(1, sum(l, function (n) { return n.n; })); }));
    var right = o.rightWidth || 240, xs = [labelW, Math.round(labelW + (W - labelW - right - nw) / 2), W - right - nw], nodes = {}, bottom = 0;
    layers.forEach(function (list, li) {
      var used = sum(list, function (n) { return Math.max(minH, n.n * k); }) + Math.max(0, list.length - 1) * gap;
      var y = li === 0 ? 0 : Math.max(0, (H - used) / 2);
      list.forEach(function (n) {
        var hh = Math.max(minH, n.n * k);
        nodes[n.id] = { id: n.id, layer: li, x: xs[li], y: y, h: hh, n: n.n, outY: y, inY: y };
        y += hh + gap;
      });
      bottom = Math.max(bottom, y - gap);
    });
    var yoursTop = bottom + (yours.length ? 34 : 0);
    yours.forEach(function (n, i) { nodes[n.id] = { id: n.id, layer: 0, x: xs[0], y: yoursTop + i * (10 + gap), h: 10, n: n.n, outY: 0, inY: 0, yours: true }; });
    if (yours.length) bottom = yoursTop + yours.length * (10 + gap) - gap;
    // links leave a node top-down in the order of their targets, and arrive in the order of their sources
    var links = f.links.map(function (l) { return { from: l.from, to: l.to, n: l.n, w: Math.max(1, l.n * k) }; });
    links.slice().sort(function (a, z) { return nodes[a.to].y - nodes[z.to].y; }).forEach(function (l) { var s = nodes[l.from]; l.y0 = s.outY + l.w / 2; s.outY += l.w; });
    links.slice().sort(function (a, z) { return nodes[a.from].y - nodes[z.from].y; }).forEach(function (l) { var t = nodes[l.to]; l.y1 = t.inY + l.w / 2; t.inY += l.w; });
    var yl = yours.filter(function (n) { return n.bucket && nodes['col:' + n.bucket]; }).map(function (n) {
      var s = nodes[n.id], t = nodes['col:' + n.bucket];
      return { from: n.id, to: t.id, n: n.n, w: 1.5, y0: s.y + s.h / 2, y1: t.y + Math.min(t.h / 2, 8), yours: true };
    });
    return { nodes: nodes, links: links.concat(yl), height: Math.ceil(bottom), k: k, nodeWidth: nw, yoursTop: yours.length ? yoursTop : null };
  }

  // ---------- circle packing: greedy, each circle tangent to two placed ones, closest to the middle ----------
  function pack(radii, pad) {
    pad = pad || 0;
    var idx = radii.map(function (r, i) { return i; }).sort(function (a, z) { return radii[z] - radii[a]; }), out = [], placed = [];
    var fits = function (x, y, r) { return placed.every(function (c) { var dx = x - c.x, dy = y - c.y; return dx * dx + dy * dy >= (r + c.r + pad) * (r + c.r + pad) - 1e-6; }); };
    idx.forEach(function (i, n) {
      var r = radii[i], best = null;
      if (n === 0) best = { x: 0, y: 0 };
      else if (n === 1) best = { x: placed[0].r + r + pad, y: 0 };
      else {
        for (var a = 0; a < placed.length; a++) for (var b = a + 1; b < placed.length; b++) {
          tangents(placed[a], placed[b], r + pad).forEach(function (p) {
            if (!fits(p.x, p.y, r)) return;
            var d = Math.sqrt(p.x * p.x + p.y * p.y) + r;
            if (!best || d < best.d) best = { x: p.x, y: p.y, d: d };
          });
        }
        if (!best) { var far = Math.max.apply(null, placed.map(function (c) { return Math.sqrt(c.x * c.x + c.y * c.y) + c.r; })); best = { x: far + r + pad, y: 0 }; }
      }
      var c = { x: best.x, y: best.y, r: r };
      placed.push(c); out[i] = c;
    });
    // centre on the bounding box, then the enclosing radius
    var x0 = Math.min.apply(null, out.map(function (c) { return c.x - c.r; })), x1 = Math.max.apply(null, out.map(function (c) { return c.x + c.r; }));
    var y0 = Math.min.apply(null, out.map(function (c) { return c.y - c.r; })), y1 = Math.max.apply(null, out.map(function (c) { return c.y + c.r; }));
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    out.forEach(function (c) { c.x -= cx; c.y -= cy; });
    return { circles: out, r: out.length ? Math.max.apply(null, out.map(function (c) { return Math.sqrt(c.x * c.x + c.y * c.y) + c.r; })) : 0 };
  }
  // the two centres for a circle of radius r touching circles a and b (r already includes the padding)
  function tangents(a, b, r) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy), ra = a.r + r, rb = b.r + r;
    if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) return [];
    var l = (ra * ra - rb * rb + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, ra * ra - l * l)), mx = a.x + dx * l / d, my = a.y + dy * l / d;
    return [{ x: mx - dy * hh / d, y: my + dx * hh / d }, { x: mx + dy * hh / d, y: my - dx * hh / d }];
  }

  // ---------- Overview ----------
  // opts.perColumn: cards drawn by name in each column's bubble; the rest join one "+N" bubble.
  function overview(snapshot, built, config, now, opts) {
    opts = opts || {};
    var byB = bucketsById(config), ps = places(snapshot, built, config), cardByKey = {}, per = opts.perColumn || 16;
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    var cols = {}, months = {}, people = 0, machine = 0, answered = 0, starred = 0;
    ps.forEach(function (p) {
      var t = p.t, col = cols[p.bucket] = cols[p.bucket] || { id: p.bucket, n: 0, leaves: 0, cards: {} };
      col.n++; if (p.leaves) col.leaves++;
      var k = p.card || '_none'; col.cards[k] = (col.cards[k] || 0) + 1;
      if (isPerson(p, byB, config)) { people++; if (waitsSince(t) == null) answered++; } // "answered": the one definition, as in priorities()
      else if (!isAlias(t.from, config)) machine++; // a group address is neither: colleagues forwarding
      if (t.labels.indexOf('STARRED') >= 0) starred++;
      var m = t.date.slice(0, 7); months[m] = (months[m] || 0) + 1;
    });
    var columns = config.buckets.filter(function (b) { return cols[b.id]; }).map(function (b) {
      var c = cols[b.id], ks = Object.keys(c.cards).sort(function (a, z) { return c.cards[z] - c.cards[a] || a.localeCompare(z); });
      var named = ks.slice(0, per).map(function (k) { return { key: cardByKey[k] ? k : null, title: cardByKey[k] ? cardByKey[k].title : 'No card', n: c.cards[k] }; });
      var rest = ks.slice(per);
      return { id: b.id, bucket: b, n: c.n, leaves: c.leaves, cards: named, rest: rest.length ? { cards: rest.length, n: sum(rest, function (k) { return c.cards[k]; }) } : null };
    });
    var top = [];
    columns.forEach(function (c) { c.cards.forEach(function (x) { if (x.key) top.push({ key: x.key, title: x.title, n: x.n, bucket: c.id }); }); });
    top.sort(function (a, z) { return z.n - a.n || a.title.localeCompare(z.title); });
    var oldest = ps.reduce(function (m, p) { return !m || p.t.date < m ? p.t.date : m; }, null);
    return {
      inbox: ps.length, people: people, machine: machine, answered: answered, starred: starred,
      oldestDays: oldest ? Math.floor((now - Date.parse(oldest)) / DAY) : 0,
      columns: columns, top: top.slice(0, opts.top || 10), months: monthRun(months, now, opts.months || 12),
    };
  }
  // the last n calendar months up to now's, empty ones included, so the bars keep their spacing
  function monthRun(counts, now, n) {
    var d = new Date(now), out = [];
    for (var i = n - 1; i >= 0; i--) {
      var m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)), key = m.toISOString().slice(0, 7);
      out.push({ month: key, n: counts[key] || 0 });
    }
    var first = out.findIndex(function (x) { return x.n; }); // drop the empty months before the oldest thread
    return first > 0 ? out.slice(first) : out;
  }
  // A thread from a person: not a machine sender or one of your group addresses, not in a column for automated mail.
  function isPerson(p, byB, config) {
    var b = byB[p.bucket], f = p.t.from;
    return !(b && b.automated) && !!f && !R.isMachine(f) && !isAlias(f, config);
  }
  function isAlias(email, config) { return (config.aliases || []).map(R.addr).indexOf(email) >= 0; }
  // Initials for a card's bubble: "Acme Corp" → AC, "acme.com" → AC, "ana@acme.com" → AN.
  function initials(title) {
    var s = String(title || '').replace(/@.*$/, '').replace(/\.[a-z]{2,}(\.[a-z]{2})?$/i, '');
    var w = s.split(/[^A-Za-z0-9À-ÿ]+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }

  // ---------- All threads: every inbox thread as one cell, grouped column → card ----------
  function grid(snapshot, built, config) {
    var ps = places(snapshot, built, config), cols = {}, cardByKey = {};
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    ps.forEach(function (p) {
      var col = cols[p.bucket] = cols[p.bucket] || { n: 0, cards: {} }, k = p.card || '_none';
      col.n++; (col.cards[k] = col.cards[k] || []).push(p);
    });
    return config.buckets.filter(function (b) { return cols[b.id]; }).map(function (b) {
      var c = cols[b.id];
      return { id: b.id, bucket: b, n: c.n, cards: Object.keys(c.cards).map(function (k) {
        return { key: cardByKey[k] ? k : null, title: cardByKey[k] ? cardByKey[k].title : 'No card', threads: c.cards[k].sort(function (a, z) { return z.t.date.localeCompare(a.t.date); }) };
      }).sort(function (a, z) { return z.threads.length - a.threads.length || a.title.localeCompare(z.title); }) };
    });
  }

  // ---------- who has the last word ----------
  // A timeline (t.msgs, [[epoch s, 1 if yours]]) in turns: open = when they wrote with no message from you
  // since (null: yours is the last word), replies = [[their first unanswered message, seconds to yours]].
  function turns(msgs) {
    var open = null, lastIn = null, out = [];
    msgs.forEach(function (m) {
      if (!m[1]) { if (open == null) open = m[0]; lastIn = m[0]; }
      else if (open != null) { out.push([open, m[0] - open]); open = null; }
    });
    return { open: open, lastIn: lastIn, replies: out };
  }
  // Waiting on you: they wrote and nothing of yours came after. A record read before timelines were
  // kept can only tell whether any message of yours is in the thread (the SENT label).
  function waitsSince(t) {
    if (!t.msgs) return t.labels.indexOf('SENT') >= 0 ? null : Date.parse(t.date);
    var o = turns(t.msgs).open; return o == null ? null : o * 1000;
  }

  // ---------- Priorities: what in the inbox waits on you ----------
  // "Waiting on you" is waitsSince(): the last word is theirs. Score: starred, then Gmail's Important,
  // a topic column, then how long it has waited.
  function priorities(snapshot, built, config, now) {
    var byB = bucketsById(config), ps = places(snapshot, built, config), cardByKey = {};
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    var waiting = [], ages = { week: 0, month: 0, quarter: 0, older: 0 }, people = 0, answered = 0, recent = { week: 0, month: 0 }, noise = {}, machineStays = 0;
    ps.forEach(function (p) {
      var t = p.t, b = byB[p.bucket], days = (now - Date.parse(t.date)) / DAY;
      if (days <= 7) recent.week++;
      if (days <= 30) recent.month++;
      if (!isPerson(p, byB, config)) {
        if (!p.leaves && !isAlias(t.from, config)) { machineStays++; var k = p.card || '_none'; noise[k] = noise[k] || { key: cardByKey[k] ? k : null, title: cardByKey[k] ? cardByKey[k].title : 'No card', bucket: p.bucket, n: 0 }; noise[k].n++; }
        return;
      }
      people++;
      var w = waitsSince(t);
      if (w == null) { answered++; return; }
      if (p.leaves) return;
      days = Math.max(0, (now - w) / DAY);
      ages[days <= 7 ? 'week' : days <= 30 ? 'month' : days <= 90 ? 'quarter' : 'older']++;
      var score = (t.labels.indexOf('STARRED') >= 0 ? 8 : 0) + (t.labels.indexOf('IMPORTANT') >= 0 ? 2 : 0) + (b && b.topics ? 3 : 0) + Math.max(0, 4 - Math.log2(1 + days));
      waiting.push({ t: t, card: p.card, title: cardByKey[p.card] ? cardByKey[p.card].title : '', bucket: p.bucket, days: Math.floor(days), score: score });
    });
    waiting.sort(function (a, z) { return z.score - a.score || z.t.date.localeCompare(a.t.date); });
    return {
      inbox: ps.length, people: people, answered: answered, recent: recent, ages: ages, waiting: waiting, machineStays: machineStays,
      noise: Object.keys(noise).map(function (k) { return noise[k]; }).filter(function (x) { return x.n >= 3; }).sort(function (a, z) { return z.n - a.n; }).slice(0, 8),
    };
  }

  // ---------- Replies: the last `days` days, inbox and archived ----------
  // recent: the window's threads outside the inbox ({threads}, from the window read); built covers both (the
  // board builds its cards over inbox + window). A thread counts when a person wrote in it inside the window;
  // answered = yours is the last word; a reply time counts when their message falls inside the window.
  // partial: inbox threads active in the window that were read before timelines were kept, so they can't count.
  function replies(snapshot, built, recent, config, now, days) {
    days = days || 30;
    var byB = bucketsById(config), since = (now - days * DAY) / 1000, sinceIso = new Date(since * 1000).toISOString(), cardByKey = {};
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    var ps = places(snapshot, built, config).concat(recent ? placesOf(recent.threads, built, config) : []);
    var cols = {}, times = [], people = 0, answered = 0, inboxWaiting = 0, archived = [], partial = 0;
    ps.forEach(function (p) {
      var t = p.t;
      if (!t.msgs) { if (t.date >= sinceIso) partial++; return; }
      var tn = turns(t.msgs);
      if (tn.lastIn == null || tn.lastIn < since || !isPerson(p, byB, config)) return;
      var col = cols[p.bucket] = cols[p.bucket] || { people: 0, answered: 0, times: [] };
      people++; col.people++;
      if (tn.open == null) { answered++; col.answered++; }
      else if (t.labels.indexOf('INBOX') >= 0) inboxWaiting++;
      else archived.push({ t: t, card: p.card, title: cardByKey[p.card] ? cardByKey[p.card].title : '', bucket: p.bucket, days: Math.floor((now / 1000 - tn.open) / 86400) });
      tn.replies.forEach(function (r) { if (r[0] >= since) { times.push(r[1]); col.times.push(r[1]); } });
    });
    archived.sort(function (a, z) { return a.days - z.days || z.t.date.localeCompare(a.t.date); });
    var H = 3600, D = 86400;
    return {
      days: days, people: people, answered: answered, inboxWaiting: inboxWaiting, archived: archived, partial: partial,
      replies: times.length, median: median(times),
      speed: [['hour', 0, H], ['day', H, D], ['days', D, 3 * D], ['longer', 3 * D, Infinity]].map(function (s) {
        return { id: s[0], n: times.filter(function (x) { return x >= s[1] && x < s[2]; }).length };
      }),
      columns: config.buckets.filter(function (b) { return cols[b.id]; }).map(function (b) {
        var c = cols[b.id]; return { id: b.id, bucket: b, people: c.people, answered: c.answered, replies: c.times.length, median: median(c.times) };
      }),
    };
  }
  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, z) { return a - z; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ---------- Filters: how each label got onto the mail ----------
  // Gmail doesn't record who added a label, so this asks whether a filter's search matches (R.parseQuery).
  // filters: [{ id, query, label, live, ours, at }]: live = in Gmail now, else made on Apply; at = when Labelboard
  // made it (ms), if known. Per thread and label, best first: filter (labelled, a live filter matches), early
  // (labelled before it existed), hand (labelled, no filter), missed (a live filter matches, no label), would (made on Apply).
  var HOW = ['filter', 'early', 'hand', 'missed', 'would'];
  function arrival(t) { // its last message from someone else: the one a filter would have seen arrive
    var m = (t.msgs || []).filter(function (x) { return !x[1]; });
    return m.length ? 1000 * Math.max.apply(null, m.map(function (x) { return x[0]; })) : Date.parse(t.date);
  }
  function filterTrace(mail, filters, config) {
    var fs = filters.filter(function (f) { return f.label; }).map(function (f) { return { f: f, m: R.parseQuery(f.query) }; });
    var byFilter = {}, nodes = {}, when = {}, adds = {}; // adds: labels some filter gives, so a hand-given one counts too
    fs.forEach(function (x) { byFilter[x.f.id] = { preview: !!x.m, filter: [], early: [], missed: [], would: [] }; adds[x.f.label] = 1; });
    mail.threads.forEach(function (t) {
      var at = when[t.id] = arrival(t), seen = {}, before = function (f) { return f.at && at < f.at; };
      fs.forEach(function (x) { if (x.m && x.m(t)) (seen[x.f.label] = seen[x.f.label] || []).push(x.f); });
      t.labels.forEach(function (l) { if (!seen[l] && (adds[l] || R.bucketOfLabel(l, config))) seen[l] = []; });
      Object.keys(seen).forEach(function (l) {
        var live = seen[l].filter(function (f) { return f.live; }), has = t.labels.indexOf(l) >= 0;
        live.forEach(function (f) { byFilter[f.id][!has ? 'missed' : before(f) ? 'early' : 'filter'].push(t.id); });
        if (!has) seen[l].forEach(function (f) { if (!f.live) byFilter[f.id].would.push(t.id); });
        var how = has ? (!live.length ? 'hand' : live.every(before) ? 'early' : 'filter') : live.length ? 'missed' : 'would';
        var ours = how === 'would' || live.some(function (f) { return f.ours; });
        // a thread with two labels in one column (a sub-label) counts once there, by its best answer
        var b = R.bucketOfLabel(l, config), node = nodes[b ? 'col:' + b.id : 'lab:' + l] = nodes[b ? 'col:' + b.id : 'lab:' + l] || {}, cur = node[t.id];
        if (!cur || HOW.indexOf(how) < HOW.indexOf(cur.how) || how === cur.how && ours && !cur.ours) node[t.id] = { how: how, ours: ours };
      });
    });
    return { byFilter: byFilter, nodes: nodes, when: when };
  }
  // Sankey input for flowLayout: how the label got there (left) → the label, a column's or one of yours (middle)
  // → in or out of the inbox now (right). A thread counts once per label it has or a filter would give it.
  var HOW_NODES = ['how:ours', 'how:yours', 'how:early', 'how:hand', 'how:missed', 'how:would'];
  function filterFlow(trace, mail, config, opts) {
    var max = opts && opts.max || 8, byId = {}, src = {}, mid = {}, out = {}, l1 = {}, l2 = {}, threads = {};
    var inc = function (m, k) { m[k] = (m[k] || 0) + 1; }, size = function (k) { return Object.keys(trace.nodes[k]).length; };
    mail.threads.forEach(function (t) { byId[t.id] = t; });
    var labs = Object.keys(trace.nodes).filter(function (k) { return k.indexOf('lab:') === 0; }).sort(function (a, z) { return size(z) - size(a) || a.localeCompare(z); });
    var keep = {}; labs.slice(0, labs.length > max ? max - 1 : max).forEach(function (k) { keep[k] = 1; });
    Object.keys(trace.nodes).forEach(function (k) {
      var to = k.indexOf('lab:') === 0 && !keep[k] ? 'lab:' : k; // 'lab:' folds the smaller labels of yours
      Object.keys(trace.nodes[k]).forEach(function (id) {
        var x = trace.nodes[k][id], s = x.how === 'filter' ? (x.ours ? 'how:ours' : 'how:yours') : 'how:' + x.how, o = byId[id].labels.indexOf('INBOX') >= 0 ? 'out:in' : 'out:out';
        threads[id] = 1; inc(src, s); inc(mid, to); inc(out, o); inc(l1, s + '\u0000' + to); inc(l2, to + '\u0000' + o);
      });
    });
    var byB = bucketsById(config), order = config.buckets.map(function (b) { return 'col:' + b.id; }).concat(labs.filter(function (k) { return keep[k]; }), ['lab:']);
    var split = function (m) { return Object.keys(m).map(function (k) { var x = k.split('\u0000'); return { from: x[0], to: x[1], n: m[k] }; }); };
    return {
      total: sum(Object.keys(src).map(function (k) { return src[k]; })), threads: Object.keys(threads).length, yours: [],
      sources: HOW_NODES.filter(function (k) { return src[k]; }).map(function (k) { return { id: k, n: src[k] }; }),
      labels: order.filter(function (k) { return mid[k]; }).map(function (k) {
        return { id: k, n: mid[k], bucket: k.indexOf('col:') === 0 ? byB[k.slice(4)] : null, name: k === 'lab:' ? (labs.length - Object.keys(keep).length) + ' more labels' : k.slice(4) };
      }),
      outcomes: ['out:in', 'out:out'].filter(function (k) { return out[k]; }).map(function (k) { return { id: k, n: out[k] }; }),
      links: split(l1).concat(split(l2)),
    };
  }
  // Arrivals per day, for a filter row: bins[0] is everything older than `days`, then one per day up to today.
  function strip(items, now, days) {
    var bins = [];
    for (var i = 0; i <= days; i++) bins.push({ n: 0 });
    items.forEach(function (x) {
      var d = Math.floor((now - x.at) / DAY), b = bins[d >= days ? 0 : days - Math.max(0, d)];
      b[x.how] = (b[x.how] || 0) + 1; b.n++;
    });
    return bins;
  }
  // The view's list: a row per column with a label (Labelboard's filters, and labels given by hand) and one
  // per live filter of yours, each with counts by answer and its strip.
  function filterRows(trace, filters, config, now, days) {
    var count = function (items) { var n = { all: items.length }; items.forEach(function (x) { n[x.how] = (n[x.how] || 0) + 1; }); return n; };
    var columns = config.buckets.filter(function (b) { return b.label && trace.nodes['col:' + b.id]; }).map(function (b) {
      var node = trace.nodes['col:' + b.id], items = Object.keys(node).map(function (id) { return { id: id, at: trace.when[id], how: node[id].how }; });
      return { bucket: b, n: count(items), bins: strip(items, now, days) };
    });
    var yours = filters.filter(function (f) { return f.live && !f.ours && f.label; }).map(function (f) {
      var x = trace.byFilter[f.id], items = [];
      ['filter', 'early', 'missed'].forEach(function (how) { x[how].forEach(function (id) { items.push({ id: id, at: trace.when[id], how: how }); }); });
      return { filter: f, preview: x.preview, n: count(items), bins: strip(items, now, days) };
    }).sort(function (a, z) { return z.n.all - a.n.all || a.filter.label.localeCompare(z.filter.label); });
    return { columns: columns, yours: yours };
  }

  // ---------- Home: what came in since you last looked (sinceMs, the read you saw last time) ----------
  // mail: inbox plus the window. mail = threads with a message from someone else after it (a record without a
  // timeline goes by its date), fresh = ones that started after it, answered = a message of yours after it,
  // sorted = new mail a column takes (not Unsorted), newCards = Unsorted cards whose mail all started after it.
  function since(mail, built, config, sinceMs) {
    var s = sinceMs / 1000, n = { mail: 0, fresh: 0, answered: 0, sorted: 0, newCards: 0 }, first = {};
    placesOf(mail.threads, built, config).forEach(function (p) {
      var m = p.t.msgs, got = m ? m.some(function (x) { return !x[1] && x[0] > s; }) : Date.parse(p.t.date) > sinceMs;
      first[p.t.id] = m && m.length ? m[0][0] > s : Date.parse(p.t.date) > sinceMs;
      if (m && m.some(function (x) { return x[1] && x[0] > s; })) n.answered++;
      if (!got) return;
      n.mail++; if (first[p.t.id]) n.fresh++;
      if (p.bucket !== 'unsorted') n.sorted++;
    });
    built.cards.forEach(function (c) {
      if (c.threads.length && R.placement(c, config).bucket === 'unsorted' && c.threads.every(function (id) { return first[id]; })) n.newCards++;
    });
    return n;
  }

  return { places: places, since: since, flow: flow, shift: shift, flowLayout: flowLayout, pack: pack, overview: overview, initials: initials, grid: grid, priorities: priorities,
    turns: turns, waitsSince: waitsSince, replies: replies, filterTrace: filterTrace, filterFlow: filterFlow, filterRows: filterRows, strip: strip };
})(typeof LabelboardRules !== 'undefined' ? LabelboardRules : require('./rules.js'));
if (typeof module !== 'undefined') module.exports = LabelboardInsights;
