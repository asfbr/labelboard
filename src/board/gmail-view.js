/* The Gmail tab: what Gmail does with your mail. Filters on the left (a column's, yours, none), labels on the right
   (a column's tree, your trees, in Gmail's colours), the threads between them as bands (insights.js gmailFlow).
   Here a column says when its mail leaves the inbox, a label of yours merges into any label (menu or drag), left-over
   labels get a place, and column colours that look alike get fixed. Picks are settings; Apply does them. */
window.LabelboardGmailView = function (ctx) {
  'use strict';
  var S = ctx.S, R = window.LabelboardRules, L = window.LabelboardLabels, I = window.LabelboardInsights, $ = ctx.$, h = ctx.h, fmt = ctx.fmt, plural = ctx.plural, tip = ctx.tip;
  var counts = null, asked = false, open = {}, drop = null; // counts: label name → {threads, messages}, asked once a visit; open: rows unfolded; drop: a drag waiting for its yes
  var depth = function (n) { return n.split('/').length; };
  var leaf = function (n) { return n.split('/').pop(); };

  function sw(color, title) {
    var bg = color && ctx.hex(color.backgroundColor);
    return '<span class="lb-sw' + (bg ? '' : ' none') + '"' + (bg ? ' style="background:' + bg + '"' : '') + (title ? ' title="' + h(title) + '"' : '') + '></span>';
  }
  function colorCell(r) {
    var off = r.want && (!r.color || r.color.backgroundColor !== r.want.backgroundColor);
    return '<span class="lb-c">' + sw(r.color, r.color ? 'Its colour in Gmail now' : 'No colour in Gmail now') + (off ? '<span class="lb-to" aria-hidden="true">→</span>' + sw(r.want, 'Its colour after Apply') : '') + '</span>';
  }
  function num(name) {
    if (!counts) return '<span class="lb-n note" title="Counting…">…</span>';
    var c = counts[name]; return '<span class="lb-n" title="Threads with this label, inbox and archived">' + (c ? fmt(c.threads) : '–') + '</span>';
  }
  function askCounts() {
    if (asked || !ctx.API.counts) return;
    asked = true;
    ctx.API.counts().then(function (c) { counts = c; if (ctx.view() === 'gmail') render(); })
      .catch(function (e) { console.error(e); counts = {}; if (ctx.view() === 'gmail') render(); });
  }
  // Each column's label and the folders in its tree: where a left-over label's mail can go.
  function targets(rows) {
    var names = rows.map(function (r) { return r.name; }), out = [];
    S.config.buckets.forEach(function (b) {
      if (!b.label) return;
      out.push(b.label);
      names.filter(function (n) { return n.indexOf(b.label + '/') === 0 && names.some(function (x) { return x.indexOf(n + '/') === 0; }); }).sort().forEach(function (n) { out.push(n); });
    });
    return out;
  }
  function options(list, v) { return list.map(function (o) { return '<option value="' + h(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + h(o[1]) + '</option>'; }).join(''); }
  // A label of yours: stays yours, the board takes it (a column when it's under none), or merges into any label (labels.js
  // mergeTargets), the one that looks the same first.
  function handPick(r, st) {
    var hand = (S.config.handover || {})[r.name] || {}, v = hand.keep ? 'keep' : hand.into ? 'into:' + hand.into : '', top = !r.column;
    var twin = st.twins.filter(function (t) { return t.name === r.name; })[0], all = L.mergeTargets(r.name, st.rows, st.lay);
    if (hand.into && !all.some(function (t) { return t.name === hand.into; })) all.push({ name: hand.into, kind: 'board' });
    var group = function (label, list) { return list.length ? '<optgroup label="' + label + '">' + options(list.map(function (t) { return ['into:' + t.name, t.name]; }), v) + '</optgroup>' : ''; };
    var of = function (k) { return all.filter(function (t) { return t.kind === k && !(twin && t.name === twin.into); }); };
    return '<select class="lb-pick" data-hand="' + h(r.name) + '" aria-label="What happens to ' + h(r.name) + '">' +
      options([['', 'Stays yours'], ['keep', top ? 'Becomes a column' : 'The board takes it as it is']], v) +
      (twin ? group('Looks the same', [{ name: twin.into }]) : '') + group('Merge into a column\'s label', of('column')) + group('Merge into the board\'s', of('board')) + group('Merge into one of yours', of('yours')) + '</select>';
  }
  function leftPick(r, rows) {
    var list = [], parent = r.name.split('/').slice(0, -1).join('/');
    if (r.suggest) list.push([r.suggest, 'Its mail moves to ' + r.suggest]);
    list.push(['tidy', 'Deleted if empty, else kept'], ['keep', 'Keep it']);
    var more = targets(rows).concat(parent ? [parent] : []).filter(function (t, i, all) { return t !== r.suggest && t !== r.name && all.indexOf(t) === i; });
    if (r.pick !== 'keep' && r.pick !== 'tidy' && r.pick !== r.suggest && more.indexOf(r.pick) < 0) more.push(r.pick);
    return '<select class="lb-pick" data-left="' + h(r.name) + '" aria-label="What happens to ' + h(r.name) + '">' + options(list, r.pick) +
      '<optgroup label="Its mail moves to">' + options(more.map(function (t) { return [t, t]; }), r.pick) + '</optgroup></select>';
  }
  function blockedNote(r, hk) {
    var b = hk.blocked.filter(function (x) { return x.name === r.name; })[0]; if (!b) return '';
    var why = b.filters.map(function (id) { var f = (S.filters || []).filter(function (x) { return x.id === id; })[0]; return f ? '“' + f.query + '”' + (f.why ? ': ' + f.why.replace(/ The board.*$/, '') : '') : id; });
    return '<p class="lb-block">Stays where it is: your filter ' + why.map(h).join(', ') + ' adds it, and Labelboard can\'t take that filter over. Change it in Gmail to fold this label.</p>';
  }
  // What a handed-over label does on Apply, in words, under its row.
  function handNote(r, rows, hk) {
    if (!r.hand) return '';
    if (r.hand.keep) return '<p class="note lb-say">' + (r.kind === 'column' ? 'Becomes the board\'s on Apply, as a column with its name.' : 'Becomes the board\'s on Apply, as it is. Its colour follows the column.') + '</p>';
    var tree = rows.filter(function (x) { return x.hand && x.hand.top === r.name && x.target; }).sort(function (x, z) { return x.name.localeCompare(z.name); }), have = {};
    rows.forEach(function (x) { have[x.name] = 1; });
    return '<ul class="lb-map">' + tree.map(function (x) {
      var wb = function (s) { return h(s).replace(/\//g, '/<wbr>'); }; // long paths break after a slash
      return '<li><span class="lb-from">' + wb(x.name) + '</span><span aria-hidden="true">→</span><span>' + wb(x.target) + (have[x.target] ? '' : ' <span class="note">(new)</span>') + '</span></li>';
    }).join('') + '</ul><p class="note lb-say">On Apply the mail under ' + (tree.length > 1 ? 'these labels' : 'it') + ' moves, inbox and archived, then ' + (tree.length > 1 ? 'they are' : 'it is') + ' deleted. Undo puts ' + (tree.length > 1 ? 'them' : 'it') + ' back.</p>' + tree.map(function (x) { return blockedNote(x, hk); }).join('');
  }
  // A label of yours that looks like one the board gives: one click merges it there.
  function twinNote(r, st) {
    var t = !r.hand && st.twins.filter(function (x) { return x.name === r.name; })[0]; if (!t) return '';
    return '<p class="lb-twin">Looks the same as ' + ctx.nameChip(t.into) + ' <button type="button" class="btn" data-twin="' + h(r.name) + '" data-into="' + h(t.into) + '">Merge into it</button></p>';
  }
  // One label in a tree. A label of yours at the top of its own tree takes the menu, and can be dragged onto another label.
  function rowHtml(r, st, base) {
    var rows = st.rows, hk = st.hk;
    var root = r.kind === 'yours' && !(r.hand && r.hand.top !== r.name) && !rows.some(function (x) { return x.kind === 'yours' && r.name.indexOf(x.name + '/') === 0; });
    var tag = r.kind === 'leftover' ? '<span class="lb-tag left">Left over</span>' : r.kind === 'yours' ? '<span class="lb-tag yours">Yours</span>' : '';
    var pick = r.kind === 'leftover' ? leftPick(r, rows) : root ? handPick(r, st) : '';
    var say = root ? handNote(r, rows, hk) + twinNote(r, st) : r.hand && r.target ? '<p class="note lb-say">Merges into ' + h(r.target) + '.</p>' : '';
    return '<li class="lb-row k-' + r.kind + '" data-drop="' + h(r.name) + '"' + (root ? ' draggable="true" data-drag="' + h(r.name) + '" title="Drag onto another label to merge it there"' : '') + ' style="--d:' + (depth(r.name) - depth(base || '')) + '">' +
      colorCell(r) + '<span class="lb-name" title="' + h(r.name) + '">' + h(base ? leaf(r.name) : r.name) + '</span>' + tag + num(r.name) +
      (pick ? '<span class="lb-act">' + pick + '</span>' : '') + (say ? '<div class="lb-more">' + say + '</div>' : '') + '</li>';
  }
  function toggle(key, n, what) { return '<button type="button" class="linkish gm-open" data-gx="' + h(key) + '" aria-expanded="' + !!open[key] + '">' + (open[key] ? 'Hide ' : 'Show ') + plural(n, what) + '</button>'; }
  // ---------- the right side: a column's label tree, or a tree outside the columns ----------
  function columnHtml(n, st, minH) {
    var b = n.bucket, rows = st.rows, key = 'R:' + n.id;
    var self = rows.filter(function (r) { return r.name === b.label; })[0] || { name: b.label, color: null, kind: 'column', want: b.color };
    var tree = rows.filter(function (r) { return r.name.indexOf(b.label + '/') === 0; }).sort(function (x, z) { return x.name.localeCompare(z.name); });
    var c = { left: 0, yours: 0, paint: 0 };
    tree.concat(self).forEach(function (r) { if (r.kind === 'leftover') c.left++; if (r.kind === 'yours') c.yours++; if (r.want && (!r.color || r.color.backgroundColor !== r.want.backgroundColor)) c.paint++; });
    if (open[key] == null) open[key] = !!c.left;
    var bits = [self.hand && self.hand.keep && 'your label, handed over on Apply', c.left && fmt(c.left) + ' left over', c.yours && fmt(c.yours) + ' of yours', c.paint && fmt(c.paint) + ' recolour on Apply'].filter(Boolean).join(' · ');
    var hand = self.hand && self.hand.keep ? '<p class="note lb-say">Your label, made a column here: the board takes it on Apply. <button type="button" class="linkish" data-unhand="' + h(b.label) + '">Leave it yours</button></p>' : '';
    return '<div class="gm-row gm-lab" data-node="' + key + '" data-drop="' + h(b.label) + '" style="--c:' + ctx.colorOf(b.id) + ';min-height:' + minH + 'px">' +
      '<div class="gm-l1">' + colorCell(self) + ctx.labelChip(b) + num(b.label) + '</div>' +
      '<div class="gm-l2">' + (bits ? '<span>' + bits + '</span>' : '<span>' + (tree.length ? '' : 'Nothing under it in Gmail yet') + '</span>') + (tree.length ? toggle(key, tree.length, 'label') + '' : '') + '</div>' + hand +
      (open[key] && c.left ? '<p class="note lb-say">Labelboard made the labels marked <i>Left over</i> for an earlier layout. On Apply each one\'s mail, inbox and archived, moves where its menu says, then the label is deleted.</p>' : '') +
      (open[key] && tree.length ? '<ul class="lb-tree">' + tree.map(function (r) { return rowHtml(r, st, b.label); }).join('') + '</ul>' : '') + '</div>';
  }
  function treeHtml(n, st, minH) {
    var top = n.name, key = 'R:' + n.id, rows = st.rows;
    var self = rows.filter(function (r) { return r.name === top; })[0] || { name: top, color: null, kind: 'yours' };
    var sub = rows.filter(function (r) { return r.name.indexOf(top + '/') === 0; }).sort(function (x, z) { return x.name.localeCompare(z.name); });
    if (open[key] == null) open[key] = sub.some(function (r) { return r.kind === 'leftover'; });
    return '<div class="gm-row gm-lab k-' + self.kind + '" data-node="' + key + '" style="--c:var(--hatch);min-height:' + minH + 'px"><ul class="lb-tree">' + rowHtml(self, st, '') +
      (open[key] ? sub.map(function (r) { return rowHtml(r, st, top); }).join('') : '') + '</ul>' + (sub.length ? '<div class="gm-l2"><span></span>' + toggle(key, sub.length, 'label') + '</div>' : '') + '</div>';
  }
  // ---------- the left side: a column's filters, a filter of yours, or none ----------
  function filterHtml(n, minH) {
    var key = 'L:' + n.id, g = S.gmail || {};
    if (n.id === 'none') return '<div class="gm-row gm-fil gm-none" data-node="' + key + '" style="--c:var(--hatch);min-height:' + minH + 'px"><div class="gm-l1">No filter</div><div class="gm-l2"><span>Labels added by hand, or by a filter that was deleted</span></div></div>';
    if (n.bucket) {
      var b = n.bucket, s = ctx.colStatus(b), cards = S.built.cards.filter(function (c) { return R.placement(c, S.config).bucket === b.id; }).sort(function (x, z) { return z.threads.length - x.threads.length; });
      var log = g.later && g.later.log && g.later.log['col:' + b.id], gone = log ? log.reduce(function (m, x) { return m + x[1]; }, 0) : 0;
      return '<div class="gm-row gm-fil" data-node="' + key + '" style="--c:' + ctx.colorOf(b.id) + ';min-height:' + minH + 'px">' +
        '<div class="gm-l1"><span class="dot" style="background:' + ctx.colorOf(b.id) + '"></span><button type="button" class="linkish gm-name" data-ours="' + h(b.id) + '">' + h(b.name) + '</button>' +
        (cards.length ? toggle(key, cards.length, 'card') : '') + '</div>' +
        '<div class="gm-l2"><span>' + h(s ? ctx.fsText(s, b) : 'No filter yet') + (gone ? ' · archived ' + fmt(gone) + ' in 14 days' : '') + '</span>' +
        ctx.leavesSelect('class="leaves" data-leaves="' + h(b.id) + '" aria-label="When mail in ' + h(b.name) + ' leaves the inbox"', R.leavesOf(b)) + '</div>' +
        (open[key] ? '<ul class="gm-cards">' + cards.map(function (c) {
          return '<li><button type="button" class="linkish" data-card="' + h(c.key) + '">' + h(c.title) + '</button><span class="n">' + fmt(c.threads.length) + '</span>' +
            ctx.leavesSelect('class="leaves" data-cardleaves="' + h(c.key) + '" aria-label="When ' + h(c.title) + ' leaves the inbox"', R.cardLeaves((S.config.cards || {})[c.key]), R.leavesOf(b), true) + '</li>';
        }).join('') + '</ul>' : '') + '</div>';
    }
    var f = (g.filters || []).filter(function (x) { return x.id === n.filter; })[0] || { query: n.filter, labels: [], extras: [] };
    var does = [f.labels.length ? 'adds ' + f.labels.join(', ') : '', f.archive ? 'skips the inbox' : ''].concat(f.extras || []).filter(Boolean).join(', ');
    return '<div class="gm-row gm-fil yours" data-node="' + key + '" style="--c:var(--muted);min-height:' + minH + 'px">' +
      '<div class="gm-l1">' + (f.owned || (S.config.adopted || {})[f.id] ? '<span class="lb-tag yours">Labelboard\'s</span>' : '<span class="lb-tag yours">Yours</span>') + '<button type="button" class="linkish fr-q" data-filter="' + h(n.filter) + '">' + h(f.query) + '</button></div>' +
      '<div class="gm-l2"><span>' + h(does) + '</span></div></div>';
  }
  function alikeHtml(rows) {
    var list = L.lookalikes(S.config, rows); if (!list.length) return '';
    return '<div class="lb-alike">' + list.map(function (x) {
      var b = ctx.bucket(x.column), a = ctx.bucket(x.like);
      return '<p>' + ctx.labelChip(b) + ' and ' + ctx.labelChip(a) + ' look almost the same in Gmail\'s label list. <button type="button" class="btn" data-alike="' + h(b.id) + '" data-bg="' + h(x.suggest.backgroundColor) + '" data-fg="' + h(x.suggest.textColor) + '">' +
        sw(x.suggest) + ' Give ' + h(b.name) + ' this colour</button></p>';
    }).join('') + '</div>';
  }

  var last = null; // what the last render drew: rows and the flow, for drags and the bands
  function render() {
    var el = $('view');
    ctx.resetTips();
    var head = '<header class="v-head"><h2>Gmail</h2><p>What Gmail does with your mail: filters catch it (left), labels hold it (right). Each band is threads, your inbox plus the last ' +
      ((S.snapshot.window || {}).days || 30) + ' days. A column says when its mail leaves the inbox; a label of yours can merge into any label, from its menu or by dragging it onto another. Nothing changes in Gmail until you apply.</p></header>';
    var st = ctx.labelState();
    if (!st) { el.innerHTML = head + '<p class="empty">Labelboard couldn\'t read your labels from Gmail this time. Nothing changed. Reload the page to try again.</p>'; return; }
    askCounts();
    st.lay = L.layout(S.built, S.config, st.plan, (S.gmail || {}).adoptedLabels); st.twins = L.twins(st.rows, st.lay);
    var trees = Object.keys(st.rows.filter(function (r) { return !r.column; }).reduce(function (o, r) { o[r.name.split('/')[0]] = 1; return o; }, {}));
    var f = I.gmailFlow(ctx.trace(), S.mail, S.config, trees), pre = I.rowLayout(f, { minH: 52 }), g = S.gmail || {};
    last = { st: st, f: f };
    var mh = function (side, n) { return Math.round(pre.nodes[side + n.id].h); };
    var apply = f.links.reduce(function (m, l) { return m + l.apply; }, 0), yours = st.rows.filter(function (r) { return r.kind === 'yours'; }).length, mine = (g.filters || []).filter(function (x) { return !x.owned; }).length;
    var moves = st.hk.moves.length, paint = st.hk.repaint + st.hk.recolor.length, chip = function (n, l, cls) { return '<span class="gm-chip' + (cls ? ' ' + cls : '') + '"><b>' + fmt(n) + '</b> ' + l + '</span>'; };
    var twins = st.twins.length ? '<div class="gm-twins">' + (st.twins.length === 1 ? 'A label of yours looks the same as one the board made: ' : plural(st.twins.length, 'label') + ' of yours look the same as labels the board made: ') +
      st.twins.slice(0, 4).map(function (t) { return h(t.name) + ' → ' + h(t.into); }).join(', ') + (st.twins.length > 4 ? '…' : '') + ' <button type="button" class="btn primary" data-twins-all>' + (st.twins.length === 1 ? 'Merge it' : st.twins.length === 2 ? 'Merge both' : 'Merge all ' + st.twins.length) + '</button></div>' : '';
    var confirm = drop ? '<div class="gm-confirm" role="alert">Merge <b>' + h(drop.from) + '</b> into <b>' + h(drop.to) + '</b> on Apply? Its mail moves there, inbox and archived, and ' + h(drop.from) + ' is deleted. Undo puts it back. ' +
      '<button type="button" class="btn primary" data-drop-yes>Merge</button> <button type="button" class="btn" data-drop-no>Cancel</button></div>' : '';
    el.innerHTML = head + '<div class="gm-chips">' + chip((g.filters || []).length + (S.fs && S.fs.status ? S.fs.status.actions.create.length : 0), 'filters, ' + fmt(mine) + ' of them yours') +
      chip(st.rows.length, 'labels, ' + fmt(yours) + ' of them yours') + (apply ? chip(apply, 'threads labelled once you apply', 'acc') : '') + (moves ? chip(moves, moves === 1 ? 'label moves on Apply' : 'labels move on Apply') : '') +
      (paint ? chip(paint, 'recolour on Apply') : '') + '</div>' + twins + alikeHtml(st.rows) + confirm +
      '<div class="gm-key"><span><i class="k-now"></i>Labelled in Gmail now</span><span><i class="k-apply"></i>Labelled once you apply</span><span><i class="k-missed"></i>Came before the filter: no label</span><span><i class="k-leaves"></i>Leaves the inbox</span></div>' +
      '<div class="gm-wrap"><div class="gm" id="gm"><div class="gm-side gm-left"><div class="gm-h">Filters · what catches it</div>' + f.left.map(function (n) { return filterHtml(n, mh('L:', n)); }).join('') + '</div>' +
      '<div class="gm-mid"><svg class="gm-bands" id="gm-bands" aria-hidden="true"></svg></div>' +
      '<div class="gm-side gm-right"><div class="gm-h">Labels · what holds it</div>' + f.right.map(function (n) { return n.bucket ? columnHtml(n, st, mh('R:', n)) : treeHtml(n, st, mh('R:', n)); }).join('') + '</div></div></div>' +
      '<p class="note lb-foot">Label counts are threads with the label, inbox and archived, as Gmail has them now. System labels (Inbox, Starred, the tabs) aren\'t shown. Click a filter for its Gmail search and status.</p>' + ctx.dayRows();
    bands();
  }
  // The bands, from where the rows really are (their content sets their height): each link split by state.
  function bands() {
    var gm = $('gm'), svg = $('gm-bands'); if (!gm || !svg || !last) return;
    var top = gm.getBoundingClientRect().top, at = {}, f = last.f;
    gm.querySelectorAll('[data-node]').forEach(function (x) { var r = x.getBoundingClientRect(); at[x.dataset.node] = { y: r.top - top, h: r.height }; });
    var lay = I.rowLayout(f, { at: at }), H = Math.ceil(gm.getBoundingClientRect().height), leaves = {};
    f.left.forEach(function (n) { leaves[n.id] = n.bucket ? R.leavesOf(n.bucket) !== 'never' : n.filter ? !!((S.gmail.filters || []).filter(function (x) { return x.id === n.filter; })[0] || {}).archive : false; });
    var W = Math.max(1, Math.round(svg.parentNode.getBoundingClientRect().width)), m = W / 2;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.style.height = H + 'px';
    var color = function (id) { return id === 'none' ? 'var(--hatch)' : id.indexOf('col:') === 0 ? ctx.colorOf(id.slice(4)) : 'var(--muted)'; };
    var name = function (n) { return n.bucket ? n.bucket.name : n.name || n.filter || 'No filter'; }, byId = {};
    f.left.concat(f.right).forEach(function (n) { byId[n.id] = n; });
    // a band is a filled ribbon, so hatching (mail that leaves the inbox) keeps its angle at any width
    var ribbon = function (a, b, w) { return 'M0 ' + a.toFixed(1) + 'C' + m + ' ' + a.toFixed(1) + ' ' + m + ' ' + b.toFixed(1) + ' ' + W + ' ' + b.toFixed(1) + 'v' + w.toFixed(1) + 'C' + m + ' ' + (b + w).toFixed(1) + ' ' + m + ' ' + (a + w).toFixed(1) + ' 0 ' + (a + w).toFixed(1) + 'Z'; };
    svg.innerHTML = '<defs><pattern id="gm-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="7" fill="var(--surface)" fill-opacity=".5"/></pattern></defs>' + lay.links.map(function (l) {
      var y0 = l.y0 - l.w / 2, y1 = l.y1 - l.w / 2, out = '', go = leaves[l.from];
      var t = tip('<b>' + h(name(byId[l.from]) || '') + ' → ' + h(byId[l.to].bucket ? byId[l.to].bucket.label : byId[l.to].name) + '</b><br>' + [l.now && plural(l.now, 'thread') + ' labelled now', l.apply && fmt(l.apply) + ' once you apply', l.missed && fmt(l.missed) + ' came before the filter, no label'].filter(Boolean).join('<br>') + (go ? '<br>Leaves the inbox' : ''));
      STATES.forEach(function (k) {
        if (!l[k]) return;
        var w = Math.max(1, l.w * l[k] / l.n), d = ribbon(y0, y1, w);
        out += '<g class="gm-band ' + k + '" data-from="' + h(l.from) + '" data-to="' + h(l.to) + '"' + t + '><path d="' + d + '" fill="' + color(l.from) + '"/>' + (go && k !== 'missed' ? '<path d="' + d + '" fill="url(#gm-hatch)"/>' : '') + '</g>';
        y0 += w; y1 += w;
      });
      return out;
    }).join('');
  }
  var STATES = ['now', 'apply', 'missed'];
  // ---------- picks ----------
  function changed(msg) { ctx.rebuild(); ctx.render(); ctx.save(); if (msg) ctx.toast(msg, 5000); }
  // Anything that names the column: placed cards, moved threads, group addresses, label votes, topics, processes, subject rules.
  function named(id) {
    var c = S.config, vals = function (o, f) { return Object.keys(o || {}).some(function (k) { return f(o[k]) === id; }); }, of = function (x) { return x && x.bucket; };
    return vals(c.cards, of) || vals(c.threadOverrides, of) || vals(c.aliasBuckets, String) || vals(c.labelMap, String) ||
      ['topics', 'processes', 'patterns'].some(function (k) { return (c[k] || []).some(function (x) { return x.bucket === id; }); });
  }
  // A label of yours made a column: its own colour when Gmail has one (the palette's nearest), else one clear of the others.
  function makeColumn(name) {
    var row = (ctx.labelState() || { rows: [] }).rows.filter(function (r) { return r.name === name; })[0], c = row && row.color && row.color.backgroundColor;
    var used = S.config.buckets.filter(function (b) { return b.color; }).map(function (b) { return b.color.backgroundColor; });
    var color = c ? { backgroundColor: R.PALETTE[R.paletteIndex(c)], textColor: row.color.textColor || ctx.textOn(R.PALETTE[R.paletteIndex(c)]) } : L.freeColor(used);
    var n = S.config.buckets.length, at = S.config.buckets[n - 1] && S.config.buckets[n - 1].id === 'keep' ? n - 1 : n;
    S.config.buckets.splice(at, 0, { id: 'c' + Date.now().toString(36), name: name.replace(/^_+/, ''), label: name, archive: false, color: color, fromLabel: true });
  }
  function unhand(name) {
    var hand = S.config.handover || {}, was = hand[name]; delete hand[name];
    var b = was && was.keep && S.config.buckets.filter(function (x) { return x.label === name && x.fromLabel; })[0];
    if (!b) return '';
    if (named(b.id)) return ' Its column stays, since cards or settings name it; delete the column in Settings if you don\'t want it.';
    S.config.buckets = S.config.buckets.filter(function (x) { return x !== b; });
    return ' Its column is gone.';
  }
  // Filters of yours that add a label being folded go with it: adopted, writing the label it moves to. Kept in step with
  // the picks before every plan; one Labelboard can't adopt (it forwards, adds two labels) holds the fold back instead.
  function syncFilters(rows) {
    var a = S.config.adopted = S.config.adopted || {}, hand = S.config.handover || {}, live = (S.gmail || {}).filters || [], moved = false;
    Object.keys(a).forEach(function (id) {
      var x = a[id]; if (!x.fold) return;
      var f = live.filter(function (g) { return g.id === id; })[0];
      if (!(hand[x.fold] && hand[x.fold].into) && f && !f.owned) { delete a[id]; moved = true; } // fold called off before Apply: the filter is yours again
    });
    rows.forEach(function (r) {
      if (!r.hand || !r.hand.into || !r.target) return;
      live.forEach(function (f) {
        if (f.owned || f.extras.length || f.labels.length !== 1 || f.labels[0] !== r.name) return;
        var x = a[f.id];
        if (x && !x.fold) return; // adopted by you already: its label is yours to set
        if (!x) { a[f.id] = { query: f.query, label: r.target, archive: f.archive, fold: r.hand.top }; moved = true; }
        else if (x.label !== r.target) { x.label = r.target; moved = true; }
      });
    });
    return moved;
  }
  // One label's pick, in words for the toast; the caller syncs filters and redraws once (pickHand, or every twin at once).
  function setHand(name, v) {
    var hand = S.config.handover = S.config.handover || {};
    if (!v) return 'Stays yours: Labelboard won\'t touch ' + name + '.' + unhand(name);
    unhand(name);
    if (v === 'keep') {
      hand[name] = { keep: true };
      var top = !R.bucketOfLabel(name, S.config);
      if (top) makeColumn(name);
      return top ? name + ' is a column now. Apply hands the label over to the board.' : 'Apply hands ' + name + ' over to the board, as it is.';
    }
    hand[name] = { into: v.slice(5) };
    return name + ' merges into ' + v.slice(5) + ' on Apply. The mail and labels it moves show here and in Review.';
  }
  function pickHand(name, v) {
    var msg = setHand(name, v), st = ctx.labelState(); if (st) syncFilters(st.rows);
    changed(msg);
  }
  var el = $('view');
  el.addEventListener('change', function (e) {
    if (ctx.view() !== 'gmail') return;
    var t = e.target;
    if (t.dataset.hand != null) pickHand(t.dataset.hand, t.value);
    else if (t.dataset.left != null) pickLeft(t.dataset.left, t.value);
    else if (t.dataset.cardleaves != null) {
      var v = t.value; ctx.cardEdit(t.dataset.cardleaves, function (cur) { R.setCardLeaves(cur, v); });
      ctx.placed(); render(); ctx.toast('Saved: ' + (v ? ctx.leavesWords(v).toLowerCase() : 'as the column'));
    }
  });
  el.addEventListener('click', function (e) {
    if (ctx.view() !== 'gmail') return;
    var a = e.target.closest('[data-alike]'), u = e.target.closest('[data-unhand]'), x = e.target.closest('[data-gx]'), tw = e.target.closest('[data-twin]');
    if (a) { var b = ctx.bucket(a.dataset.alike); b.color = { backgroundColor: a.dataset.bg, textColor: a.dataset.fg }; changed(b.name + ' has a new colour. Apply gives it to its labels in Gmail.'); }
    if (u) pickHand(u.dataset.unhand, '');
    if (x) { open[x.dataset.gx] = !open[x.dataset.gx]; render(); var back = $('view').querySelector('[data-gx="' + CSS.escape(x.dataset.gx) + '"]'); if (back) back.focus(); }
    if (tw) pickHand(tw.dataset.twin, 'into:' + tw.dataset.into);
    if (e.target.closest('[data-twins-all]') && last) {
      var all = last.st.twins; all.forEach(function (t) { setHand(t.name, 'into:' + t.into); });
      var st = ctx.labelState(); if (st) syncFilters(st.rows);
      changed(plural(all.length, 'label') + ' of yours merge' + (all.length === 1 ? 's' : '') + ' into the board\'s on Apply. Each row says where its mail goes.');
    }
    if (e.target.closest('[data-drop-yes]') && drop) { var d = drop; drop = null; pickHand(d.from, 'into:' + d.to); }
    if (e.target.closest('[data-drop-no]')) { drop = null; render(); }
  });
  // Drag a label of yours onto another label to merge it there; it asks first.
  var dragging = null;
  var canDrop = function (to) { return dragging && last && to !== dragging && L.mergeTargets(dragging, last.st.rows, last.st.lay).some(function (t) { return t.name === to; }); };
  el.addEventListener('dragstart', function (e) {
    var d = ctx.view() === 'gmail' && e.target.closest && e.target.closest('[data-drag]'); if (!d) return;
    dragging = d.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging); d.classList.add('dragging');
  });
  el.addEventListener('dragover', function (e) {
    var t = dragging && e.target.closest('[data-drop]'); if (!t || !canDrop(t.dataset.drop)) return;
    e.preventDefault(); el.querySelectorAll('.drop-hot').forEach(function (x) { if (x !== t) x.classList.remove('drop-hot'); }); t.classList.add('drop-hot');
  });
  el.addEventListener('drop', function (e) {
    var t = dragging && e.target.closest('[data-drop]'); if (!t || !canDrop(t.dataset.drop)) return;
    e.preventDefault(); drop = { from: dragging, to: t.dataset.drop }; dragging = null; render();
    var y = $('view').querySelector('[data-drop-yes]'); if (y) y.focus();
  });
  el.addEventListener('dragend', function () { dragging = null; el.querySelectorAll('.drop-hot, .dragging').forEach(function (x) { x.classList.remove('drop-hot', 'dragging'); }); });
  el.addEventListener('pointerover', function (e) { var n = ctx.view() === 'gmail' && e.target.closest('#gm [data-node]'); hot(n ? n.dataset.node : null); });
  el.addEventListener('pointerleave', function () { hot(null); });
  // hovering a row lights its bands
  function hot(key) {
    var gm = $('gm'); if (!gm) return;
    gm.classList.toggle('focus', !!key);
    var id = key && key.slice(2), side = key && key[0];
    gm.querySelectorAll('.gm-band').forEach(function (p) { p.classList.toggle('on', !!key && (side === 'L' ? p.dataset.from : p.dataset.to) === id); });
  }
  window.addEventListener('resize', function () { if (ctx.view() === 'gmail') bands(); });
  return { render: render, syncFilters: syncFilters };
};
