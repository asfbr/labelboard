/* The Labels view: every label in your Gmail, in the colour Gmail shows, by what it is to the board (labels.js classify).
   Here you hand a label of yours over (fold it into a column, or let the board take it as it is), say what happens to
   labels left over from an earlier layout, and fix column colours that look alike. Picks are settings; Apply does them. */
window.LabelboardLabelsView = function (ctx) {
  'use strict';
  var S = ctx.S, R = window.LabelboardRules, L = window.LabelboardLabels, $ = ctx.$, h = ctx.h, fmt = ctx.fmt, plural = ctx.plural;
  var counts = null, asked = false, open = {}; // counts: label name → {threads, messages}, asked once a visit; open: column trees unfolded
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
    ctx.API.counts().then(function (c) { counts = c; if (ctx.view() === 'labels') render(); })
      .catch(function (e) { console.error(e); counts = {}; if (ctx.view() === 'labels') render(); });
  }
  // Where mail can fold into: each column's label and the folders in its tree.
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
  // A label of yours at the top of its own tree: stays yours, the board takes it (a column when it's under none), or folds in.
  function handPick(r, rows) {
    var hand = (S.config.handover || {})[r.name] || {}, v = hand.keep ? 'keep' : hand.into ? 'into:' + hand.into : '', top = !r.column;
    var into = targets(rows).filter(function (t) { return t !== r.name; }).map(function (t) { return ['into:' + t, 'Fold into ' + t]; });
    return '<select class="lb-pick" data-hand="' + h(r.name) + '" aria-label="What happens to ' + h(r.name) + '">' +
      options([['', 'Stays yours'], ['keep', top ? 'Becomes a column' : 'The board takes it as it is']], v) + '<optgroup label="Fold it into">' + options(into, v) + '</optgroup></select>';
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
  function rowHtml(r, rows, hk, base) {
    var root = r.kind === 'yours' && !(r.hand && r.hand.top !== r.name) && !rows.some(function (x) { return x.kind === 'yours' && r.name.indexOf(x.name + '/') === 0; });
    var tag = r.kind === 'leftover' ? '<span class="lb-tag left">Left over</span>' : r.kind === 'yours' ? '<span class="lb-tag yours">Yours</span>' : '';
    var pick = r.kind === 'leftover' ? leftPick(r, rows) : root ? handPick(r, rows) : '';
    var say = root ? handNote(r, rows, hk) : r.hand && r.target ? '<p class="note lb-say">Folds into ' + h(r.target) + '.</p>' : '';
    return '<li class="lb-row k-' + r.kind + '" style="--d:' + (depth(r.name) - depth(base)) + '">' + colorCell(r) + '<span class="lb-name" title="' + h(r.name) + '">' + h(base ? leaf(r.name) : r.name) + '</span>' + tag + num(r.name) +
      (pick ? '<span class="lb-act">' + pick + '</span>' : '') + (say ? '<div class="lb-more">' + say + '</div>' : '') + '</li>';
  }
  function columnHtml(b, rows, hk) {
    var self = rows.filter(function (r) { return r.name === b.label; })[0] || { name: b.label, color: null, kind: 'column', want: b.color };
    var tree = rows.filter(function (r) { return r.name.indexOf(b.label + '/') === 0; }).sort(function (x, z) { return x.name.localeCompare(z.name); });
    var n = { left: 0, yours: 0, paint: 0 };
    tree.concat(self).forEach(function (r) { if (r.kind === 'leftover') n.left++; if (r.kind === 'yours') n.yours++; if (r.want && (!r.color || r.color.backgroundColor !== r.want.backgroundColor)) n.paint++; });
    var bits = [self.hand && self.hand.keep && 'your label, handed over on Apply', tree.length ? plural(tree.length, 'label') + ' under it' : 'nothing under it', n.left && fmt(n.left) + ' left over',
      n.yours && fmt(n.yours) + ' of yours', n.paint && fmt(n.paint) + ' recolour on Apply'].filter(Boolean).join(' · ');
    var isOpen = open[b.id] != null ? open[b.id] : !!(n.left || n.yours);
    var hand = self.hand && self.hand.keep ? '<p class="note lb-say">Your label, made a column here: the board takes it on Apply. <button type="button" class="linkish" data-unhand="' + h(b.label) + '">Leave it yours</button></p>' : '';
    // data-lb-col, not data-col: Home's click handler on #view opens the column named by data-col
    return '<details class="lb-col" data-lb-col="' + h(b.id) + '"' + (isOpen ? ' open' : '') + '><summary class="lb-row lb-head">' + colorCell(self) + '<span class="lb-name"><b>' + h(b.name) + '</b> <span class="note">' + h(b.label) + '</span></span>' +
      '<span class="lb-bits note">' + bits + '</span>' + num(b.label) + '</summary>' + hand +
      (n.left ? '<p class="note lb-say">Labelboard made the labels marked <i>Left over</i> for an earlier layout. On Apply each one\'s mail, inbox and archived, moves where its menu says, then the label is deleted.</p>' : '') +
      (tree.length ? '<ul class="lb-tree">' + tree.map(function (r) { return rowHtml(r, rows, hk, b.label); }).join('') + '</ul>' : '<p class="note lb-say">No labels under it in Gmail yet.</p>') + '</details>';
  }
  function alikeHtml(rows) {
    var list = L.lookalikes(S.config, rows); if (!list.length) return '';
    return '<div class="lb-alike">' + list.map(function (x) {
      var b = ctx.bucket(x.column), a = ctx.bucket(x.like);
      return '<p>' + ctx.labelChip(b) + ' and ' + ctx.labelChip(a) + ' look almost the same in Gmail\'s label list. <button type="button" class="btn" data-alike="' + h(b.id) + '" data-bg="' + h(x.suggest.backgroundColor) + '" data-fg="' + h(x.suggest.textColor) + '">' +
        sw(x.suggest) + ' Give ' + h(b.name) + ' this colour</button></p>';
    }).join('') + '</div>';
  }

  function render() {
    var el = $('view'), st = ctx.labelState();
    var head = '<header class="v-head"><h2>Labels</h2><p>Every label in your Gmail, in the colour Gmail shows it. The board\'s labels sit under its columns: sub-labels and folders take the column\'s colour in a lighter shade. ' +
      'Labels you made stay yours until you hand one over: fold it into a column, or let the board take it as it is. Nothing changes in Gmail until you apply.</p></header>';
    if (!st) { el.innerHTML = head + '<p class="empty">Labelboard couldn\'t read your labels from Gmail this time. Nothing changed. Reload the page to try again.</p>'; return; }
    askCounts();
    var rows = st.rows, hk = st.hk, inCol = function (r) { return !!r.column; };
    var mine = rows.filter(function (r) { return r.kind === 'yours' && !inCol(r) && !rows.some(function (x) { return x.kind === 'yours' && r.name.indexOf(x.name + '/') === 0; }); }).sort(function (x, z) { return x.name.localeCompare(z.name); });
    var under = function (top) { return rows.filter(function (r) { return r.name.indexOf(top + '/') === 0; }).length; };
    var stray = rows.filter(function (r) { return !inCol(r) && r.kind === 'leftover'; });
    el.innerHTML = head + alikeHtml(rows) +
      '<h3 class="v-h">Your labels</h3>' + (mine.length ? '<p class="note">Folding moves a label\'s mail onto a column\'s label (the same sub-labels underneath where they match) and deletes the old label. A filter of yours that adds it is handed over with it and adds the new label instead.</p><ul class="lb-list">' +
        mine.map(function (r) {
          var n = under(r.name);
          return '<li class="lb-row k-yours lb-top">' + colorCell(r) + '<span class="lb-name">' + h(r.name) + (n ? ' <span class="note">and ' + plural(n, 'label') + ' under it</span>' : '') + '</span>' + num(r.name) +
            '<span class="lb-act">' + handPick(r, rows) + '</span><div class="lb-more">' + handNote(r, rows, hk) + '</div></li>';
        }).join('') + '</ul>' : '<p class="note">Every label outside the columns is the board\'s.</p>') +
      '<h3 class="v-h">The board\'s labels, by column</h3>' + S.config.buckets.filter(function (b) { return b.label; }).map(function (b) { return columnHtml(b, rows, hk); }).join('') +
      (stray.length ? '<h3 class="v-h">Labelboard\'s, outside every column</h3><p class="note">Made for a column that has another label now. On Apply each one\'s mail moves where its menu says, then the label is deleted.</p><ul class="lb-list">' + stray.map(function (r) { return rowHtml(r, rows, hk, ''); }).join('') + '</ul>' : '') +
      '<p class="note lb-foot">Counts are threads with the label, inbox and archived, as Gmail has them now. System labels (Inbox, Starred, the tabs) aren\'t shown.</p>';
  }

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
  function pickHand(name, v) {
    var hand = S.config.handover = S.config.handover || {}, msg;
    if (!v) msg = 'Stays yours: Labelboard won\'t touch ' + name + '.' + unhand(name);
    else if (v === 'keep') {
      unhand(name); hand[name] = { keep: true };
      var top = !R.bucketOfLabel(name, S.config);
      if (top) makeColumn(name);
      msg = top ? name + ' is a column now. Apply hands the label over to the board.' : 'Apply hands ' + name + ' over to the board, as it is.';
    } else { unhand(name); hand[name] = { into: v.slice(5) }; msg = name + ' folds into ' + v.slice(5) + ' on Apply. The mail and labels it moves show here and in Review.'; }
    var st = ctx.labelState(); if (st) syncFilters(st.rows);
    changed(msg);
  }
  function pickLeft(name, v) {
    var picks = S.config.leftovers = S.config.leftovers || {}, st = ctx.labelState(), r = st && st.rows.filter(function (x) { return x.name === name; })[0];
    if (r && v === (r.suggest || 'tidy')) delete picks[name]; else picks[name] = v;
    changed(v === 'keep' ? name + ' stays.' : v === 'tidy' ? name + ' is deleted on Apply if no mail has it.' : 'On Apply the mail under ' + name + ' moves to ' + v + '.');
  }

  var el = $('view');
  el.addEventListener('change', function (e) {
    if (ctx.view() !== 'labels') return;
    var t = e.target;
    if (t.dataset.hand != null) pickHand(t.dataset.hand, t.value);
    else if (t.dataset.left != null) pickLeft(t.dataset.left, t.value);
  });
  el.addEventListener('click', function (e) {
    if (ctx.view() !== 'labels') return;
    var a = e.target.closest('[data-alike]'), u = e.target.closest('[data-unhand]');
    if (a) { var b = ctx.bucket(a.dataset.alike); b.color = { backgroundColor: a.dataset.bg, textColor: a.dataset.fg }; changed(b.name + ' has a new colour. Apply gives it to its labels in Gmail.'); }
    if (u) pickHand(u.dataset.unhand, '');
  });
  el.addEventListener('toggle', function (e) { var d = e.target; if (d.classList && d.classList.contains('lb-col')) open[d.dataset.lbCol] = d.open; }, true);
  return { render: render, syncFilters: syncFilters };
};
