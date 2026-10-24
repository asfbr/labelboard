/* Labelboard triage: a sheet over the board that walks the cards one at a time, biggest first. Keys 1–9
   and 0 pick a column, Enter keeps the suggestion, S skips, ← goes back. Picks go through the board's place(). */
window.LabelboardTriage = function (B) {
  'use strict';
  var S = B.S, R = B.R, $ = B.$, h = B.h, fmt = B.fmt, plural = B.plural;
  var SCOPES = { unsorted: 'Unsorted', open: 'Not placed by you' };
  var T = null; // { scope, keys, i, picks: { key: column id | 'skip' } }

  // Cards still to decide: in Unsorted, or anywhere you haven't placed them yourself.
  function queue(scope) {
    return S.built.cards.filter(function (c) {
      var p = R.placement(c, S.config);
      return c.threads.length && p.who !== 'you' && (scope === 'open' || p.bucket === 'unsorted');
    }).sort(B.bySize);
  }
  function counts() { return { unsorted: queue('unsorted').length, open: queue('open').length }; }
  // the columns keys 1–9, 0 reach: the board's order, Unsorted left out (the card is already there or is leaving it)
  function keyed() { return S.config.buckets.filter(function (b) { return b.id !== 'unsorted'; }).slice(0, 10); }

  function open(scope) {
    var n = counts();
    scope = scope || (n.unsorted ? 'unsorted' : 'open');
    T = { scope: scope, keys: queue(scope).map(function (c) { return c.key; }), i: 0, picks: {} };
    $('triage').hidden = false; draw();
  }
  function close() {
    if (!T) return;
    T = null; $('triage').hidden = true; B.renderBoard();
    var btn = $('btn-triage'); if (btn && !btn.hidden) btn.focus();
  }

  function draw() {
    var body = $('tr-body'), key = T.keys[T.i], c = key && S.cardByKey[key];
    if (!c) return drawEnd();
    var p = R.placement(c, S.config), here = B.bucket(p.bucket), sugg = !p.lost && p.bucket !== 'unsorted' ? here : null;
    var inbox = B.inboxIn(c.threads), out = c.threads.length - inbox, n = counts();
    $('tr-kind').textContent = B.KIND[c.kind] + (c.subtitle && c.subtitle !== c.title ? ': ' + c.subtitle : '');
    $('tr-title').textContent = c.title;
    var sample = c.threads.map(function (id) { return S.byId[id]; }).sort(function (a, z) { return z.date.localeCompare(a.date); }).slice(0, 5);
    var keys = keyed(), cols = keys.concat(S.config.buckets.filter(function (b) { return keys.indexOf(b) < 0; }));
    body.innerHTML =
      '<div class="tr-top"><div class="seg-pick" role="radiogroup" aria-label="Which cards">' + Object.keys(SCOPES).map(function (s) {
        return '<button type="button" role="radio" data-scope="' + s + '" aria-checked="' + (s === T.scope) + '">' + SCOPES[s] + ' (' + fmt(s === T.scope ? T.keys.length : n[s]) + ')</button>';
      }).join('') + '</div><span class="tr-step">' + fmt(T.i + 1) + ' of ' + fmt(T.keys.length) + '</span></div>' +
      '<div class="tr-track" aria-hidden="true"><i style="width:' + (100 * T.i / T.keys.length).toFixed(1) + '%"></i></div>' +
      '<p class="tr-n"><b>' + plural(inbox, 'thread') + '</b> in your inbox' + (out ? ' +' + fmt(out) + ' archived' : '') + '</p>' +
      '<p class="tr-why">' + B.whoChip(p.lost ? 'none' : p.who) + h(p.lost ? 'Its column is gone, so it waits in Unsorted.' : p.decided ? 'Claude placed it here' + (p.why ? ': ' + p.why.replace(/\.$/, '') : '') + '.' : c.suggestion.reason + '.') + '</p>' +
      '<ul class="threads tr-sample">' + sample.map(function (t) {
        return '<li><div class="t-subj">' + h(t.subject || '(no subject)') + '</div><div class="t-meta"><span>' + h(t.from) + '</span><span>' +
          h(new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) + '</span></div></li>';
      }).join('') + '</ul>' + (c.threads.length > 5 ? '<p class="note tr-more">The latest 5 of ' + fmt(c.threads.length) + '.</p>' : '') +
      '<h3 class="tr-h">Where does it go?</h3><div class="tr-cols">' + cols.map(function (b) {
        var k = keys.indexOf(b), bg = B.bandOf(b) || 'var(--hatch)';
        return '<button type="button" class="tr-col' + (b === sugg ? ' is-sugg' : '') + '" data-pick="' + h(b.id) + '"' + (b === sugg ? ' aria-describedby="tr-sugg"' : '') + '>' +
          (k >= 0 ? '<kbd>' + ((k + 1) % 10) + '</kbd>' : '') + '<span class="dot" style="background:' + bg + '"></span><span class="nm">' + h(b.name) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="plan-actions"><button type="button" class="btn' + (sugg ? ' primary' : '') + '" data-keep>' + (sugg ? 'Keep it in ' + h(sugg.name) : 'Leave it in Unsorted') + '</button>' +
      '<button type="button" class="btn" data-skip>Skip for now</button>' + (T.i ? '<button type="button" class="btn ghost" data-back>Back</button>' : '') + '</div>' +
      (sugg ? '<p class="sr" id="tr-sugg">Suggested</p>' : '') +
      '<p class="tr-keys"><kbd>1</kbd>–<kbd>9</kbd> pick a column · <kbd>Enter</kbd> ' + (sugg ? 'keeps the suggestion' : 'leaves it in Unsorted') + ' · <kbd>S</kbd> skips · <kbd>←</kbd> goes back · <kbd>Esc</kbd> closes</p>';
    focusCard();
  }
  function drawEnd() {
    var ks = Object.keys(T.picks), skipped = ks.filter(function (k) { return T.picks[k] === 'skip'; }), done = ks.length - skipped.length;
    $('tr-kind').textContent = SCOPES[T.scope];
    $('tr-title').textContent = T.keys.length ? 'That was the last card' : 'Nothing left to sort here';
    $('tr-body').innerHTML = '<p>' + (T.keys.length ? plural(done, 'card') + ' placed' + (skipped.length ? ', ' + fmt(skipped.length) + ' skipped' : '') + '. ' : '') +
      'Nothing changes in Gmail until you apply: Review changes shows what will.</p>' +
      '<div class="plan-actions"><button type="button" class="btn primary" data-review>Review changes</button>' +
      (skipped.length ? '<button type="button" class="btn" data-again>Go through the ' + plural(skipped.length, 'skipped card') + '</button>' : '') +
      (T.scope === 'unsorted' && counts().open ? '<button type="button" class="btn" data-scope="open">Go through all ' + plural(counts().open, 'card') + ' not placed yet</button>' : '') +
      '<button type="button" class="btn ghost" data-close>Back to the board</button></div>';
    focusCard();
  }
  function focusCard() { $('triage').querySelector('.sheet-card').focus(); }

  function pick(id) { var key = T.keys[T.i]; B.place(key, id); B.placed(); T.picks[key] = id; T.i++; draw(); }
  function keep() { var key = T.keys[T.i]; pick(R.placement(S.cardByKey[key], S.config).bucket); }
  function skip() { T.picks[T.keys[T.i]] = 'skip'; T.i++; draw(); }
  function back() { if (T.i) { T.i--; delete T.picks[T.keys[T.i]]; draw(); } }

  $('triage').addEventListener('click', function (e) {
    if (e.target === this) return close();
    var b = e.target.closest('button'); if (!b || !T) return;
    var d = b.dataset;
    if (b.id === 'tr-close' || d.close != null) return close();
    if (d.scope) return open(d.scope);
    if (d.pick) return pick(d.pick);
    if (d.keep != null) return keep();
    if (d.skip != null) return skip();
    if (d.back != null) return back();
    if (d.again != null) { T.keys = Object.keys(T.picks).filter(function (k) { return T.picks[k] === 'skip'; }); T.i = 0; T.picks = {}; return draw(); }
    if (d.review != null) { close(); B.openReview(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!T || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!T.keys[T.i]) return; // the end screen: its buttons take the keys
    var k = e.key, n = '1234567890'.indexOf(k), cols = keyed();
    if (n >= 0 && cols[n]) { e.preventDefault(); return pick(cols[n].id); }
    if (k === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); return keep(); }
    if (k === 's' || k === 'S') { e.preventDefault(); return skip(); }
    if (k === 'ArrowLeft' || k === 'Backspace') { e.preventDefault(); return back(); }
  });

  return { open: open, close: close, counts: counts };
};
