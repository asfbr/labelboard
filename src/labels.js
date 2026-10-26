// Labelboard labels — pure JS, no DOM: what each Gmail label is to the board (a column's, the board's, left over from
// an earlier layout, or yours), the colours Apply sets, clearing left-over labels, and handing a label of yours over.
// The rules stay in rules.js; this sorts Gmail's labels against them. Used by the board (Labels view, Review) and Node tests.
var LabelboardLabels = (function (R) {
  'use strict';
  var SYSTEM = /^(INBOX|UNREAD|IMPORTANT|STARRED|SENT|DRAFT|TRASH|SPAM|CHAT|CATEGORY_\w+)$/;
  function set(list) { var o = Object.create(null); (list || []).forEach(function (x) { o[x] = true; }); return o; }
  function parents(name) { var p = name.split('/'), out = []; for (var i = 1; i < p.length; i++) out.push(p.slice(0, i).join('/')); return out; }
  function under(name, top) { return name === top || name.indexOf(top + '/') === 0; }
  function leaf(name) { var p = name.split('/'); return p[p.length - 1]; }
  function childrenFirst(list, key) { var d = function (x) { return key(x).split('/').length; }; return list.slice().sort(function (a, b) { return d(b) - d(a) || key(a).localeCompare(key(b)); }); }

  // Every label the board's layout gives, mail or not: each column's label, every card's and contact's sub-label,
  // moved threads' sub-labels, adopted filters' labels, the plan's own (an AI-read deal), and the folders above them.
  // A company label with no mail in this read is still the board's (planFilters makes it only once mail comes).
  // also: more names that are the board's, such as labels of yours it took as they are (gmail.adoptedLabels).
  function layout(built, config, plan, also) {
    var B = R.bucketById(config), out = Object.create(null);
    var add = function (n) { if (!n) return; out[n] = true; parents(n).forEach(function (p) { out[p] = true; }); };
    var sub = function (b, s) { if (b && b.label) add(R.labelName(b, s)); };
    config.buckets.forEach(function (b) { if (b.label) add(b.label); });
    R.allCards(built, config).forEach(function (c) { var p = R.placement(c, config); if (p.sublabel) sub(B[p.bucket], p.sublabel); });
    Object.keys(config.threadOverrides || {}).forEach(function (id) { var o = config.threadOverrides[id]; if (o.sublabel) sub(B[o.bucket], o.sublabel); });
    Object.keys(config.adopted || {}).forEach(function (id) { add(config.adopted[id].label); });
    ((plan && plan.labels) || []).forEach(function (l) { add(l.name); });
    (also || []).forEach(add);
    return out;
  }

  // Names compared as people read them: case, accents and punctuation aside.
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // The one name in `names` that `want` means: the same path, else the only one with the same last part, else the only
  // one whose last part starts with the other's as a word ("Lumen" → "Lumen Saúde"). null when none or several.
  function match(want, names) {
    var w = norm(want), l = norm(leaf(want)), one = function (xs) { return xs.length === 1 ? xs[0] : null; };
    var same = names.filter(function (n) { return norm(n) === w; }); if (same.length) return same[0];
    var byLeaf = names.filter(function (n) { return norm(leaf(n)) === l; }); if (byLeaf.length) return one(byLeaf);
    if (l.length < 3) return null;
    return one(names.filter(function (n) { var x = norm(leaf(n)); return x.length >= 3 && (x.indexOf(l + ' ') === 0 || l.indexOf(x + ' ') === 0); }));
  }
  // Where a label of yours goes when `top` (it or a label above it) folds into `into`. `top` lands on a label right under
  // `into` with its name when there is one (Buyers → _M&A/Buyers), else on `into`. Below it: the same path when Gmail or
  // the layout has it (case and accents aside), else the one label in that tree it names, else that path, new.
  function foldTarget(name, top, into, names) {
    var kid = names.filter(function (n) { return n.indexOf(into + '/') === 0 && n.split('/').length === into.split('/').length + 1 && norm(leaf(n)) === norm(leaf(top)); })[0];
    into = kid || into;
    var rel = name === top ? '' : name.slice(top.length + 1), path = rel ? into + '/' + rel : into;
    var tree = names.filter(function (n) { return under(n, into); });
    var same = tree.filter(function (n) { return norm(n) === norm(path); });
    if (same.length || !rel) return same[0] || path;
    return match(path, tree) || path;
  }

  // Each of your Gmail labels (info: [{name, color, type}]) with what it is to the board, and what Apply does with it.
  // kind: column (a column's own label), board (in the layout), leftover (Labelboard made it and the layout no longer
  // gives it), yours (you made it, under a column's label or not). want: the colour Apply gives it (null: left as is).
  // owned: names Labelboard created. lay: layout(). Your picks: config.handover { name: {into} | {keep} } for a label of
  // yours and those under it; config.leftovers { name: target name | 'keep' | 'tidy' }.
  // A leftover's default: the one layout label it names (its card moved), else 'tidy' (deleted if empty, else kept).
  function classify(info, owned, lay, config) {
    var mine = set(owned), cols = Object.create(null), hand = config.handover || {}, picks = config.leftovers || {}, layNames = Object.keys(lay);
    var live = info.filter(function (l) { return l.type !== 'system' && !SYSTEM.test(l.name); });
    // fold targets: never a left-over label, which moves away in the same Apply
    var names = Object.keys(set(live.map(function (l) { return l.name; }).filter(function (n) { return lay[n] || !mine[n]; }).concat(layNames)));
    config.buckets.forEach(function (b) { if (b.label) cols[b.label] = b; });
    return live.map(function (l) {
      var b = R.bucketOfLabel(l.name, config), kind = cols[l.name] ? 'column' : lay[l.name] ? 'board' : mine[l.name] ? 'leftover' : 'yours';
      var r = { name: l.name, color: l.color || null, kind: kind, column: b ? b.id : null, owned: !!mine[l.name], want: kind === 'column' ? b.color || null : kind === 'board' ? R.labelColor(l.name, config) : null };
      if (kind === 'leftover') {
        var cands = layNames.filter(function (n) { return n !== l.name && (b ? R.bucketOfLabel(n, config) === b : true); });
        r.suggest = match(l.name, cands);
        r.pick = picks[l.name] || r.suggest || 'tidy';
        if (r.pick === 'keep') r.want = R.labelColor(l.name, config);
      }
      // a label of yours made a column is a column now, still handed over (adopted) on Apply
      var top = !r.owned && parents(l.name).concat(l.name).filter(function (n) { return hand[n] && !mine[n]; }).pop();
      if (top) {
        r.hand = { top: top, keep: !!hand[top].keep, into: kind === 'yours' && hand[top].into || null };
        if (r.hand.keep && kind === 'yours') r.want = R.labelColor(l.name, config);
        if (r.hand.into) r.target = foldTarget(l.name, top, r.hand.into, names);
      }
      return r;
    });
  }

  // What Apply does about labels besides the board's own plan.labels: colours to fix on labels already in Gmail, moves
  // (the mail onto another label, then the old label deleted; to: null deletes it only if empty), labels of yours the board
  // takes as they are (adoptLabels), the names you handed over (the server moves or adopts only those, and its own),
  // new target labels to create, and folds held back by a filter of yours Labelboard can't take with it (blocked).
  // repaint: how many of plan.labels Gmail has in another colour (Apply recolours those itself).
  // filters: Gmail's filters as the board reads them ({id, labels, owned}); config.adopted: the ones handed over.
  function housekeeping(rows, plan, config, filters) {
    var planned = set((plan.labels || []).map(function (l) { return l.name; })), have = set(rows.map(function (r) { return r.name; })), live = {};
    var adopted = config.adopted || {}, out = { recolor: [], moves: [], adoptLabels: [], handover: [], create: [], blocked: [] };
    rows.forEach(function (r) { live[r.name] = r; });
    out.repaint = (plan.labels || []).filter(function (l) { var r = live[l.name]; return r && l.color && (!r.color || r.color.backgroundColor !== l.color.backgroundColor); }).length;
    var blockers = function (name) {
      return (filters || []).filter(function (f) { return !f.owned && !adopted[f.id] && f.labels.indexOf(name) >= 0; }).map(function (f) { return f.id; });
    };
    rows.forEach(function (r) {
      if (r.want && !planned[r.name] && (!r.color || r.color.backgroundColor !== r.want.backgroundColor)) out.recolor.push({ name: r.name, color: r.want });
      if (r.kind === 'leftover' && r.pick !== 'keep') out.moves.push({ from: r.name, to: r.pick === 'tidy' ? null : r.pick });
      if (!r.hand) return;
      if (r.hand.keep) { out.handover.push(r.name); out.adoptLabels.push(r.name); return; }
      if (!r.target || r.target === r.name) return;
      var stop = blockers(r.name);
      if (stop.length) return out.blocked.push({ name: r.name, filters: stop });
      out.handover.push(r.name); out.moves.push({ from: r.name, to: r.target });
    });
    out.moves = childrenFirst(out.moves, function (m) { return m.from; });
    out.moves.forEach(function (m) {
      if (!m.to || have[m.to] || planned[m.to]) return;
      [m.to].concat(parents(m.to)).forEach(function (n) {
        if (!have[n] && !planned[n] && !out.create.some(function (c) { return c.name === n; })) out.create.push({ name: n, color: R.labelColor(n, config) });
      });
    });
    return out;
  }

  // ---------- colours people can't tell apart ----------
  // CIE76 ΔE: under 15 reads as the same colour in Gmail's label list (measured on the palette: two greens 9.4 apart,
  // two pinks 9.3; orange and yellow at 21 stay apart).
  var ALIKE = 15;
  function lab(hex) {
    var c = R.rgbOf(hex).map(function (v) { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; });
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    var x = f((c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047), y = f(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722), z = f((c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function deltaE(a, b) { var p = lab(a), q = lab(b); return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2)); }
  // Columns whose colour looks like an earlier column's: [{column, like, suggest}], suggest = a palette colour clear of
  // every colour in use, coloured labels of yours included (a column isn't flagged for looking like one of those).
  function lookalikes(config, rows) {
    var cols = config.buckets.filter(function (b) { return b.label && b.color && b.color.backgroundColor; });
    var used = cols.map(function (b) { return b.color.backgroundColor; }).concat((rows || []).filter(function (r) { return r.kind === 'yours' && r.color; }).map(function (r) { return r.color.backgroundColor; })), out = [];
    cols.forEach(function (b, i) {
      var like = cols.slice(0, i).filter(function (a) { return deltaE(a.color.backgroundColor, b.color.backgroundColor) < ALIKE; })[0];
      if (!like) return;
      var s = freeColor(used); used.push(s.backgroundColor); // the next suggestion keeps clear of this one too
      out.push({ column: b.id, like: like.id, suggest: s });
    });
    return out;
  }
  // A strong palette colour (rows 1, 5, 6) in a hue nothing in `used` has yet when there is one, furthest from every
  // colour in `used`, with readable text.
  function freeColor(used) {
    var best = null, far = -1, hues = set(used.map(function (u) { var i = R.paletteIndex(u); return i < 8 ? 'grey' : i % 8; }));
    var strong = R.PALETTE.filter(function (c, i) { var row = Math.floor(i / 8); return row === 1 || row === 5 || row === 6; });
    var fresh = strong.filter(function (c) { return !hues[R.paletteIndex(c) % 8]; });
    (fresh.length ? fresh : strong).forEach(function (c) {
      var d = Math.min.apply(null, used.map(function (u) { return deltaE(u, c); }).concat(999));
      if (d > far) { far = d; best = c; }
    });
    var rgb = R.rgbOf(best), light = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150;
    return { backgroundColor: best, textColor: light ? '#000000' : '#ffffff' };
  }

  return { SYSTEM: SYSTEM, layout: layout, norm: norm, match: match, foldTarget: foldTarget, classify: classify, housekeeping: housekeeping,
    deltaE: deltaE, lookalikes: lookalikes, freeColor: freeColor, under: under, parents: parents };
})(typeof LabelboardRules !== 'undefined' ? LabelboardRules : require('./rules.js'));
if (typeof module !== 'undefined') module.exports = LabelboardLabels;
