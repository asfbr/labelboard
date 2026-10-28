/* Labelboard Home: what to do now, in one of three looks (Settings → Look): What now (the next step, big), Gallery
   (a tile per view with its number) or Labels (each column as a tag). Numbers come from the board's own counts. */
window.LabelboardHome = function (ctx) {
  'use strict';
  var S = ctx.S, I = window.LabelboardInsights, $ = ctx.$, h = ctx.h, fmt = ctx.fmt, plural = ctx.plural;
  var STEPS = [['read', 'Read'], ['sort', 'Sort'], ['apply', 'Apply'], ['answer', 'Answer']];
  var VIEWS = [['board', 'Board'], ['gmail', 'Gmail'], ['inbox', 'Inbox'], ['priorities', 'Priorities']];
  var colorOf = function (b) { return ctx.bandOf(b) || (b.id === 'unsorted' ? 'var(--hatch)' : 'var(--muted)'); };
  var one = function (n, a, b) { return n === 1 ? a : b; };

  // Everything Home says, counted once per render.
  function data() {
    var st = S.st, a = st.apply, fs = S.fs || {}, tri = ctx.triage(), now = Date.now();
    var pr = I.priorities(S.snapshot, S.built, S.config, now, ctx.prioOpts()), pace = Number(ctx.ui().pace) || 2, g = S.gmail.filters;
    var cols = S.config.buckets.map(function (b) { var c = ctx.colInfo(b); c.b = b; c.after = st.after.byBucket[b.id] || 0; c.leaves = st.after.archivedByBucket[b.id] || 0; return c; }).filter(function (c) { return c.cards; });
    var d = { st: st, a: a, fs: fs, tri: tri, pr: pr, pace: pace, cols: cols, pending: (fs.pending || 0) + a.threads, applied: !!(S.record && S.record.applies && S.record.applies.length),
      filters: g ? { all: g.length, ours: g.filter(function (f) { return f.owned; }).length, make: fs.status ? fs.status.actions.create.length : 0 } : null,
      people: I.overview(S.snapshot, S.built, S.config, now, { perColumn: 1, top: 6 }) };
    // before the first Apply the steps run in order; after it, waiting changes come before new senders in Unsorted
    var order = d.applied ? ['apply', 'answer', 'sort'] : ['sort', 'apply', 'answer'];
    d.state = order.filter(function (k) { return todo(d, k); })[0] || 'done';
    var since = ctx.since();
    d.since = since && since < Date.parse(S.snapshot.generatedAt) ? { at: since, n: I.since(S.mail, S.built, S.config, since) } : null;
    return d;
  }
  function todo(d, k) { return k === 'sort' ? d.tri.unsorted : k === 'apply' ? d.pending : k === 'answer' ? d.pr.waiting.length : 0; }
  function hours(d) { var m = d.pr.waiting.length * d.pace; return m >= 60 ? (Math.round(m / 6) / 10) + ' hours' : Math.round(m) + ' minutes'; }
  function applyLine(d) {
    var f = d.fs.pending || 0;
    return [d.a.add && plural(d.a.add, 'thread') + ' get' + one(d.a.add, 's', '') + ' labels', d.a.leave && fmt(d.a.leave) + ' leave' + one(d.a.leave, 's', '') + ' the inbox',
      d.a.off && fmt(d.a.off) + ' lose' + one(d.a.off, 's', '') + ' an old label', f && plural(f, 'filter or label change', 'filter and label changes')].filter(Boolean).join(', ');
  }
  // The next step: a sentence, what it means, and the one button that does it.
  function next(d) {
    var w = d.pr.waiting[0], u = d.tri.unsorted, af = d.st.after;
    if (d.state === 'sort') return { h: plural(u, 'card') + ' still need' + one(u, 's', '') + ' a column.', act: 'triage', btn: 'Sort them one by one',
      p: plural(af.unsortedInInbox, 'inbox thread') + one(af.unsortedInInbox, ' comes', ' come') + ' from senders with no rule yet. As the board stands, ' + fmt(af.inbox) + ' of your ' + fmt(d.st.before.inbox) + ' inbox threads stay in the inbox after Apply.' };
    if (d.state === 'apply') return { h: 'Gmail doesn\'t have your board yet.', act: 'review', btn: 'Review changes',
      p: 'On Apply: ' + applyLine(d) + '. Until then Gmail shows your mail as it is.' };
    if (d.state === 'answer') return { h: 'Sorted. ' + plural(d.pr.waiting.length, 'thread') + ' wait' + one(d.pr.waiting.length, 's', '') + ' on your answer.', act: 'goto:priorities', btn: 'Open Priorities',
      p: 'First on the list: ' + h(w.t.subject || '(no subject)') + ', from ' + h(w.t.fromName || w.t.from) + '. About ' + hours(d) + ' at ' + d.pace + ' min each.', raw: true };
    return { h: 'Nothing waits on you.', act: 'goto:board', btn: 'Open the board', p: 'Gmail matches the board, and every thread from people in your inbox has your answer last.' };
  }
  function button(act, label, cls) { return '<button type="button" class="btn ' + (cls || '') + '"' + (act.indexOf('goto:') === 0 ? ' data-goto="' + act.slice(5) + '"' : ' data-home="' + act + '"') + '>' + h(label) + '</button>'; }
  function trail(d) {
    return '<ol class="hm-trail" aria-label="Where you are">' + STEPS.map(function (s) {
      var here = s[0] === d.state, done = s[0] === 'read' || !here && !todo(d, s[0]);
      return '<li class="' + (here ? 'here' : done ? 'done' : '') + '"' + (here ? ' aria-current="step"' : '') + '>' + s[1] + '</li>';
    }).join('') + '</ol>';
  }
  // The rest of what waits, beside the next step (or under it, in the other looks).
  function queue(d, skip) {
    var pr = d.pr, items = [
      ['sort', d.tri.unsorted, one(d.tri.unsorted, 'card still needs a column', 'cards still need a column'), plural(d.st.after.unsortedInInbox, 'inbox thread') + ' from senders with no rule yet.', 'triage', 'Sort them one by one'],
      ['apply', d.pending, one(d.pending, 'change Gmail doesn\'t have yet', 'changes Gmail doesn\'t have yet'), applyLine(d) + '.', 'review', 'Review changes'],
      ['answer', pr.waiting.length, one(pr.waiting.length, 'thread waits on your answer', 'threads wait on your answer'), 'About ' + hours(d) + ' at ' + d.pace + ' min each.', 'goto:priorities', 'Priorities'],
      ['noise', pr.machineStays, one(pr.machineStays, 'automated thread stays in your inbox', 'automated threads stay in your inbox'), 'From machine senders on cards that keep mail.', 'goto:priorities', 'Priorities']];
    var list = items.filter(function (x) { return x[1] && x[0] !== skip; });
    return list.length ? '<ul class="hm-queue">' + list.map(function (x) {
      return '<li><span class="hm-qn' + (x[0] === 'apply' ? ' acc' : '') + '">' + fmt(x[1]) + '</span><span class="hm-qt"><b>' + h(x[2]) + '</b><span>' + h(x[3]) + ' ' +
        (x[4].indexOf('goto:') === 0 ? '<button type="button" class="linkish" data-goto="' + x[4].slice(5) + '">' : '<button type="button" class="linkish" data-home="' + x[4] + '">') + h(x[5]) + '</button></span></span></li>';
    }).join('') + '</ul>' : '';
  }
  function sinceWord(at) {
    var d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 864e5);
    return d < 1 ? 'Since earlier today' : d < 2 ? 'Since yesterday' : d < 7 ? 'Since ' + new Date(at).toLocaleDateString('en-US', { weekday: 'long' }) : 'Since ' + new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function sinceHtml(d) {
    if (!d.since) return '';
    var n = d.since.n, bits = [[n.mail, one(n.mail, 'thread with new mail', 'threads with new mail')], [n.answered, 'answered by you'], [n.sorted, 'went to a column'], [n.newCards, one(n.newCards, 'new sender in Unsorted', 'new senders in Unsorted')]];
    return '<p class="hm-since" title="Counted from the read you last saw (' + h(new Date(d.since.at).toLocaleString('en-US')) + ') to this one"><span>' + sinceWord(d.since.at) + '</span>' +
      (n.mail || n.answered ? bits.filter(function (b, i) { return b[0] || i < 2; }).map(function (b) { return '<span><b>' + fmt(b[0]) + '</b> ' + h(b[1]) + '</span>'; }).join('') : '<span>no new mail in your inbox</span>') + '</p>';
  }
  function nextLine(d) {
    var x = next(d);
    return '<div class="hm-next"><p><b>' + h(x.h) + '</b> ' + (x.raw ? x.p : h(x.p)) + '</p>' + button(x.act, x.btn, d.state === 'done' ? '' : 'primary') + '</div>';
  }

  // ---------- small pictures of each view, drawn from the same numbers (viewBox W×H, scaled by CSS) ----------
  // bars stretch to the box; Inbox's bubbles keep their shape
  function svg(v, W, H, d) { return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="' + (v === 'inbox' ? 'xMinYMax meet' : 'none') + '" aria-hidden="true">' + PIC[v](d, W, H) + '</svg>'; }
  var PIC = {
    board: function (d, W, H) { // columns of cards
      var cols = d.cols.slice(0, 8), cw = W / cols.length, rh = Math.max(4, H / 9), cap = Math.floor(H / (rh * 1.5));
      return cols.map(function (c, i) { var out = ''; for (var k = 0; k < Math.min(cap, c.cards); k++) out += '<rect x="' + (i * cw + 2) + '" y="' + (k * rh * 1.5) + '" width="' + (cw - 4) + '" height="' + rh + '" rx="1.5" fill="' + colorOf(c.b) + '"/>'; return out; }).join('');
    },
    gmail: function (d, W, H) { // columns on the left, in the inbox or not on the right
      var tot = d.cols.reduce(function (s, c) { return s + c.after; }, 0) || 1, k = H / tot, y = 0, stay = 0, skip = d.cols.reduce(function (s, c) { return s + c.leaves; }, 0), ys = 0, yk = (tot - skip) * k, out = '';
      d.cols.forEach(function (c) {
        var a = (c.after - c.leaves) * k, b = c.leaves * k, col = colorOf(c.b);
        if (a) out += band(6, y, W - 6, ys, a, col); if (b) out += band(6, y + a, W - 6, yk, b, col);
        out += '<rect x="0" y="' + y + '" width="5" height="' + Math.max(1, a + b - 1) + '" fill="' + col + '"/>'; y += a + b; ys += a; yk += b; stay += c.after - c.leaves;
      });
      return out + '<rect x="' + (W - 5) + '" y="0" width="5" height="' + Math.max(1, stay * k - 1) + '" fill="var(--accent)"/><rect x="' + (W - 5) + '" y="' + stay * k + '" width="5" height="' + skip * k + '" fill="var(--muted)"/>';
    },
    inbox: function (d, W, H) { // the biggest cards as bubbles
      var top = d.people.top.slice(0, 6), r0 = H / 2, max = top.length ? top[0].n : 1, x = 0;
      return top.map(function (c) { var r = Math.max(3, r0 * Math.sqrt(c.n / max)), b = ctx.bucket(c.bucket), out = '<circle cx="' + (x + r) + '" cy="' + (H - r) + '" r="' + (r - 0.5) + '" fill="' + (b ? colorOf(b) : 'var(--hatch)') + '"/>'; x += 2 * r + 3; return x - 3 > W ? '' : out; }).join('');
    },
    priorities: function (d, W, H) { // how long they have waited
      var ag = d.pr.ages, A = [ag.week, ag.month, ag.quarter, ag.older], max = Math.max.apply(null, A.concat(1)), bh = H / 5;
      return A.map(function (n, i) { return '<rect x="0" y="' + (i * bh * 1.3) + '" width="' + Math.max(n ? 3 : 0, W * n / max) + '" height="' + bh + '" rx="2" fill="var(--accent)" opacity="' + [1, .7, .45, .25][i] + '"/>'; }).join('');
    },
  };
  function band(x0, y0, x1, y1, w, col) { var m = (x0 + x1) / 2; return '<path d="M' + x0 + ' ' + y0 + 'C' + m + ' ' + y0 + ' ' + m + ' ' + y1 + ' ' + x1 + ' ' + y1 + 'v' + w + 'C' + m + ' ' + (y1 + w) + ' ' + m + ' ' + (y0 + w) + ' ' + x0 + ' ' + (y0 + w) + 'Z" fill="' + col + '" opacity=".5"/>'; }
  // Each view's number: [big, what it counts, a short line for the tile's head]
  function said(v, d) {
    return v === 'board' ? [fmt(d.cols.length), one(d.cols.length, 'column', 'columns') + ', ' + plural(S.built.cards.filter(function (c) { return c.threads.length; }).length, 'card'), d.tri.unsorted ? plural(d.tri.unsorted, 'card') + ' unsorted' : 'every card placed']
      : v === 'gmail' ? gmailSaid(d)
      : v === 'inbox' ? [d.people.inbox ? Math.round(100 * d.people.people / d.people.inbox) + '%' : '–', 'of your inbox is from people', 'who fills your inbox']
      : [fmt(d.pr.waiting.length), one(d.pr.waiting.length, 'thread waits', 'threads wait') + ' on your answer', d.pr.waiting.length ? hours(d) + ' to clear' : 'nothing waits on you'];
  }
  function gmailSaid(d) {
    var f = d.filters, ls = ctx.labelState(); if (!f) return ['–', 'Gmail\'s filters weren\'t read', 'filters and labels'];
    var left = ls ? ls.rows.filter(function (r) { return r.kind === 'leftover'; }).length : 0;
    return [fmt(f.all), one(f.all, 'Gmail filter', 'Gmail filters') + ', ' + fmt(f.ours) + ' of them Labelboard\'s' + (ls ? '; ' + plural(ls.rows.length, 'label') : '') + (f.make ? '; ' + fmt(f.make) + ' made on Apply' : ''),
      left ? plural(left, 'label') + ' left over' : 'filters and labels'];
  }
  function doors(d) {
    return '<nav class="hm-doors" aria-label="Views">' + VIEWS.map(function (v) {
      var s = said(v[0], d);
      return '<button type="button" class="hm-door" data-goto="' + v[0] + '"><span class="hm-door-t">' + v[1] + '</span>' + svg(v[0], 120, 34, d) + '<span class="hm-door-l">' + h(s[0] + ' ' + s[1]) + '</span></button>';
    }).join('') + '</nav>';
  }

  // ---------- the three looks ----------
  function nowHtml(d) {
    var x = next(d), q = queue(d, d.state);
    return '<div class="hm-now' + (q ? '' : ' solo') + '"><section class="hm-hero">' + trail(d) + '<h2 class="hm-h">' + h(x.h) + '</h2><p class="hm-p">' + (x.raw ? x.p : h(x.p)) + '</p>' +
      '<div class="rack-bar hm-bar" role="img" aria-label="' + h(fmt(d.st.before.inbox) + ' inbox threads now, ' + fmt(d.st.after.inbox) + ' after you apply') + '">' + ctx.rackBar() + '</div>' +
      '<div class="hm-cta">' + button(x.act, x.btn, 'primary big') + (x.act === 'goto:board' ? '' : button('goto:board', 'Open the board', 'big')) + '</div></section>' + q + '</div>' + sinceHtml(d) + doors(d);
  }
  function galleryHtml(d) {
    return nextLine(d) + sinceHtml(d) + '<div class="hm-gal">' + VIEWS.map(function (v) {
      var s = said(v[0], d);
      return '<button type="button" class="hm-tile" data-goto="' + v[0] + '"><span class="hm-tile-h"><b>' + v[1] + '</b><small>' + h(s[2]) + '</small></span>' +
        '<span class="hm-tile-pic">' + svg(v[0], 240, 90, d) + '</span><span class="hm-tile-n"><b' + (v[0] === 'priorities' ? ' class="acc"' : '') + '>' + h(s[0]) + '</b> ' + h(s[1]) + '</span></button>';
    }).join('') + '</div>';
  }
  function tagsHtml(d) {
    var cols = d.cols.slice().sort(function (a, z) { return z.inbox - a.inbox; });
    return '<div class="hm-tags-head"><p class="hm-big"><b>' + fmt(d.st.before.inbox) + '</b><span>to</span><b class="acc">' + fmt(d.st.after.inbox) + '</b></p>' +
      '<p class="hm-p">threads in your inbox, now and after you apply. Each tag is a column: open one to see its cards on the board.</p></div>' + nextLine(d) + sinceHtml(d) +
      '<div class="hm-tags">' + cols.map(function (c) {
        var b = c.b, what = b.label ? (b.archive ? 'skip the inbox' : b.later ? 'leave the inbox later' : 'stay in the inbox') : b.id === 'unsorted' ? 'no rule yet' : 'stay as they are';
        return '<button type="button" class="hm-tag' + (b.label ? '' : ' nolabel') + (b.label && b.archive ? ' leaves' : '') + '" data-col="' + h(b.id) + '" style="--band:' + colorOf(b) + ';flex-grow:' + Math.sqrt(c.inbox + 1).toFixed(2) + '">' +
          '<span class="hm-tag-name">' + h(b.name) + '</span><span class="hm-tag-lab">' + h(b.label || 'no label') + '</span>' +
          '<span class="hm-tag-row"><b>' + fmt(c.inbox) + '</b><span>' + h(what) + (c.change ? '<em>' + fmt(c.change) + ' to sort on Apply</em>' : '') + '</span></span></button>';
      }).join('') + '</div>';
  }
  var LOOKS = { now: nowHtml, gallery: galleryHtml, tags: tagsHtml };

  function render() {
    var d = data(), look = LOOKS[ctx.ui().home] ? ctx.ui().home : 'now';
    $('view').innerHTML = '<div class="home hm-' + look + '-look">' + LOOKS[look](d) + '</div>';
  }
  $('view').addEventListener('click', function (e) {
    var a = e.target.closest('[data-home]'), c = e.target.closest('[data-col]');
    if (a) return a.dataset.home === 'triage' ? ctx.openTriage() : ctx.openReview();
    if (c) ctx.showColumn(c.dataset.col);
  });
  return { render: render };
};
