/* Labelboard board — talks to the server only through window.LabelboardAPI (see adapters). */
(function () {
  'use strict';
  var R = window.LabelboardRules, LB = window.LabelboardLabels, API = window.LabelboardAPI;
  var KIND = { process: 'Mail with a signal word', entity: 'In your contacts', alias: 'Group address', pattern: 'Subject rule', domain: 'Everyone at a domain', sender: 'One sender', firm: 'Your colleagues' };
  var S = {}; // snapshot, recent (the window), mail (both), config, seeds, gmail (filters, labels), record (Applies, undo), built, byId, cardByKey, filters, yoursBy, mode
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var plural = function (n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many || one + 's'); };

  // keep === true: hold on to the settings on the page (changed while a quiet read ran; their save is on its way).
  // Strictly true, since .then(load) hands it a server reply.
  function load(keep) {
    return API.load().then(function (st) {
      var first = opening();
      S.snapshot = st.snapshot; S.config = keep === true ? S.config : st.config; S.seeds = st.seeds || []; S.mode = st.mode; S.gmail = st.gmail || {}; S.recent = st.recent || null;
      S.record = st.record || { applies: [] }; S.canUndo = !!(API.undo && st.record); // the preview undoes only with a record.json
      S.config.cards = S.config.cards || {};
      visit(); applyUi(); rebuild(); render();
      if (opening()) { clearTimeout(slow); $('shell').classList.remove('is-loading'); $('progress').hidden = true; }
      if (first) quietRead();
    }).catch(function (e) {
      if (!opening()) return oops(e, 'The board could not load. Nothing in Gmail changed. Reload the page to try again.', 9000);
      if (!said(e)) console.error(e);
      clearTimeout(slow); $('shell').classList.add('is-failed');
      $('progress-label').textContent = 'The board didn\'t open. ' + (said(e) || 'Nothing in Gmail changed. Try again, or reload the page.');
      $('btn-retry').hidden = false; $('btn-retry').focus();
    });
  }
  // Opening: index.html starts on the rack's progress bar (.shell.is-loading) until the first load lands; a failure stays there with Try again.
  var slow;
  function opening() { return $('shell').classList.contains('is-loading'); }
  function boot() {
    $('shell').classList.remove('is-failed'); $('btn-retry').hidden = true; $('progress-label').textContent = 'Opening your board…';
    slow = setTimeout(function () { $('progress-label').textContent = 'Still opening: Apps Script can take a while to start. Nothing in Gmail changes.'; }, 8000);
    return load();
  }
  $('btn-retry').onclick = boot;
  // A read over an hour old catches up on its own, on opening and on coming back to the tab: the incremental read
  // (seconds) while the board shows the old one, "Reading what changed…" in the header. Not over another job or Review.
  function quietRead() {
    if (!API.refresh || S.reading || !S.snapshot.threads.length || !R.readAge(S.snapshot.generatedAt, Date.now()).stale || !$('progress').hidden || !$('review').hidden) return;
    var edits = S.edits;
    S.reading = true; renderMeta();
    return API.refresh(null).then(function (r) {
      return load(S.edits !== edits).then(function () { if (r && r.kept && r.fetched) toast('Caught up: ' + plural(r.fetched, 'thread') + ' new or changed since the last read.', 5000); });
    }).catch(function (e) { if (said(e)) toast('The board shows the last read. ' + said(e), 8000); else console.error(e); }) // the header stays red: Read mail again is there
      .then(function () { S.reading = false; renderMeta(); });
  }
  function reading() { if (S.reading) toast('Labelboard is reading what changed. Try again in a few seconds.'); return !!S.reading; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.snapshot && !opening()) quietRead(); });
  // Errors say what stopped, what's safe, what to do (docs/BRAND.md rule 6). An error that already says it in
  // plain words (e.plain, or a server message starting "Labelboard: ") is shown; anything else goes to the console.
  function said(e) {
    if (e && e.plain) return e.message;
    var m = /Labelboard: ([\s\S]*)$/.exec(String(e && e.message || e || ''));
    return m ? m[1] : null;
  }
  function oops(e, msg, ms) {
    if (!said(e)) console.error(e);
    toast(msg, ms || 8000);
  }
  // config.ui: { theme: system|light|dark, density: roomy|compact, collapsed: [column ids], home: now|gallery|tags,
  // open: home|board|last, seen: the read you saw last, hidden / colleaguesOut: Priorities' (prioOpts) }, saved with the settings
  function ui() { return S.config.ui = S.config.ui || {}; }
  // The first load of a visit picks what opens and keeps the read seen last time, for Home's "since"; every load marks this read seen.
  function visit() {
    var u = ui();
    if (!S.visit) { S.visit = { since: Date.parse(u.seen || '') || null }; if (u.open !== 'last') u.view = u.open === 'board' ? 'board' : 'home'; }
    if (S.snapshot.threads.length && u.seen !== S.snapshot.generatedAt) { u.seen = S.snapshot.generatedAt; save(); }
  }
  function applyUi() {
    var u = ui(), root = document.documentElement;
    if (u.theme === 'light' || u.theme === 'dark') root.setAttribute('data-theme', u.theme); else root.removeAttribute('data-theme');
    try { localStorage.setItem('labelboard.theme', u.theme || ''); } catch (e) {} // index.html reads it before the next load
    $('board').classList.toggle('compact', u.density === 'compact');
  }
  // The filters lane starts folded until you open it, unless one of Labelboard's filters changed in Gmail.
  function isCollapsed(id) {
    if (id === 'lane' && ui().lane) return ui().lane === 'folded';
    if (id === 'lane' && (ui().collapsed || []).indexOf(id) < 0) return !((S.gmail || {}).gone || []).length;
    return (ui().collapsed || []).indexOf(id) >= 0;
  }
  // Cards are built over the inbox plus the window's mail outside it (what skipped the inbox, minus threads
  // only you wrote in). Counts, backfill and re-sort still take the inbox alone (they check the INBOX label).
  function rebuild() {
    S.mail = R.mailOf(S.snapshot, S.recent);
    S.built = R.buildCards(S.mail, S.config, S.seeds);
    S.byId = {}; S.mail.threads.forEach(function (t) { S.byId[t.id] = t; });
    S.cardByKey = {}; S.built.cards.forEach(function (c) { S.cardByKey[c.key] = c; });
  }
  function inInbox(t) { return t.labels.indexOf('INBOX') >= 0; }
  function bucket(id) { return S.config.buckets.filter(function (b) { return b.id === id; })[0]; }
  // Colours reach style/fill attributes raw, and an imported settings file sets them: only #rrggbb passes.
  function hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null; }
  function bandOf(b) { return b && b.color ? hex(b.color.backgroundColor) : null; }
  function textOn(bg) {
    var c = bg.replace('#', ''), r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000000' : '#ffffff';
  }
  // A sub-label in its column's lighter shade, as Gmail shows it after Apply (rules.js labelColor).
  function labelChip(b, sub) {
    if (!b || !b.label) return '';
    var c = sub ? R.shadeOf(b.color) : b.color, bg = c && hex(c.backgroundColor) || '#cccccc';
    return '<span class="chip" style="background:' + bg + ';color:' + (c && hex(c.textColor) || textOn(bg)) + '">' + h(sub ? b.label + '/' + sub : b.label) + '</span>';
  }
  // A chip for any Gmail label name: in its column's color when it belongs to one.
  function nameChip(name) {
    var b = R.bucketOfLabel(name, S.config);
    return b ? labelChip(b, name === b.label ? null : name.slice(b.label.length + 1)) : '<span class="chip" style="background:#cccccc;color:#000000">' + h(name) + '</span>';
  }

  // ---------- render ----------
  function render() {
    document.body.classList.toggle('is-new', !S.snapshot.threads.length);
    rendering = true; renderMeta(); renderRack(); renderBoard(); renderBanner(); rendering = false;
    applyView();
  }
  var rendering = false; // render() draws the view once, at the end
  // ---------- views: the board, or one of the views beside it (views.js), kept in config.ui.view ----------
  var MERGED = { flow: 'gmail', filters: 'gmail', labels: 'gmail', overview: 'inbox', threads: 'inbox' }; // tabs before Oct 2026, kept in config.ui.view
  function view() { var v = MERGED[ui().view] || ui().view; return S.snapshot && S.snapshot.threads.length && VIEWS.NAMES[v] ? v : 'board'; }
  function applyView() {
    var v = view(), board = v === 'board';
    document.body.dataset.view = v;
    $('board').hidden = !board; $('view').hidden = board;
    document.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === v); b.tabIndex = b.dataset.view === v ? 0 : -1; });
    if (!board) { $('rack').classList.add('compact'); drawView(v); } else { VIEWS.hideTip(); $('rack').classList.remove('compact'); if (S.st) VIEWS.pane(); }
  }
  function drawView(v) { if (v === 'home') { VIEWS.hideTip(); HOME.render(); } else if (v === 'gmail') GMAIL.render(); else VIEWS.render(v); }
  function refreshView() { if (!rendering && S.snapshot && view() !== 'board') drawView(view()); }
  $('brand').addEventListener('click', function () { if (S.snapshot) showView('home'); });
  $('views').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    ui().view = b.dataset.view; applyView(); save();
  });
  $('views').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var tabs = Array.prototype.slice.call(this.querySelectorAll('[data-view]')), i = tabs.indexOf(document.activeElement);
    var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; next.focus(); next.click();
  });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(refreshView, 150); });
  // Cards or settings that name a column this board doesn't have (a preset swap, a contacts file for another setup)
  function renderBanner() {
    var lost = R.orphans(S.config, S.built, S.seeds), n = lost.reduce(function (s, o) { return s + o.cards; }, 0), el = $('banner');
    el.hidden = !lost.length || !S.snapshot.threads.length;
    if (el.hidden) return;
    var ids = lost.map(function (o) { return o.id; }).join(', ');
    el.innerHTML = '<p>' + (n ? plural(n, 'card') + ' wait in Unsorted because their column is gone (' + h(ids) + ').' : 'Your settings still name columns this board doesn\'t have (' + h(ids) + ').') +
      '</p><button class="btn" type="button" data-open-settings="orphans">Choose where they go</button>';
  }
  function renderMeta() {
    var snap = S.snapshot, age = R.readAge(snap.generatedAt, Date.now()), rd = snap.read;
    // how the last read went stays here after its toast is gone; the tooltip says how long and why
    var how = new Date(snap.generatedAt).toLocaleString('en-US') + (rd ? '. Took ' + rd.secs + ' s' +
      (rd.relabeled ? '; labels checked again on ' + fmt(rd.relabeled) + ' threads (the last read was too long ago for Gmail\'s change log)' : '') + '.' : '');
    var out = S.mail.threads.length - snap.threads.length, days = snap.window && snap.window.days || 30;
    $('meta').innerHTML = '<span>' + h(snap.account) + '</span>' + (!snap.threads.length ? '' : '<span>' + fmt(snap.threads.length) + ' inbox threads</span>' +
      (out ? '<span title="Mail of the last ' + days + ' days that is out of your inbox: archived by you or by a filter. Cards count it; the inbox numbers don\'t.">+' + fmt(out) + ' archived, last ' + days + ' days</span>' : '') +
      (S.reading ? '<span class="reading" role="status">Reading what changed…</span>'
        : '<span class="' + (age.stale ? 'stale' : '') + '" title="' + h(how) + '">read ' + (rd && rd.auto ? 'on its own ' : '') + h(age.text) + (rd ? ', ' + fmt(rd.fetched) + ' new or changed' : '') + '</span>') + appliedHtml()) +
      (S.mode === 'apps-script' ? '' : snap.source === 'demo' ? '<span class="pill" title="A made-up mailbox (dev/demo.mjs). Nothing here is real mail.">Demo: made-up mail</span>'
        : '<span class="pill" title="Changes save on this computer and Gmail is not touched. To see new mail, ask Claude to refresh the snapshot.">Preview: Gmail is not touched</span>');
    $('btn-refresh').hidden = !API.refresh; // only the Apps Script version can read Gmail itself
    $('btn-review').disabled = $('btn-refresh').disabled = !!S.reading; // a quiet read takes the server: Apply and a read wait for it
  }

  var shown = { before: null, after: null, unsorted: null }; // the first paint sets the numbers, later ones count to them
  // S.st: R.stats, the numbers and what Apply changes in the inbox (cards, heads and Review read it), so this runs first.
  function renderRack() {
    var st = S.st = R.stats(S.snapshot, S.built, S.config, S.gmail), a = st.apply;
    tween('n-before', 'before', st.before.inbox);
    tween('n-after', 'after', st.after.inbox);
    tween('n-unsorted', 'unsorted', st.after.unsortedInInbox);
    var bar = $('rack-bar');
    bar.innerHTML = rackBar();
    bar.setAttribute('aria-label', fmt(st.before.inbox) + ' inbox threads now, ' + fmt(st.after.inbox) + ' after you apply');
    $('rack-sync').className = 'rack-sync' + (a.threads ? ' wait' : '');
    $('rack-sync').innerHTML = a.threads ? TAG + '<span><b>' + fmt(a.threads) + '</b> inbox threads change in Gmail when you apply' +
      (a.add || a.leave ? ': ' + [a.add && fmt(a.add) + ' get labels', a.leave && fmt(a.leave) + ' leave the inbox'].filter(Boolean).join(', ') : '') +
      (a.off ? (a.add || a.leave ? ', ' : ': ') + fmt(a.off) + ' lose an old label' : '') + '. Until then Gmail shows them as they are' + (a.sorted ? '; ' + fmt(a.sorted) + ' already have their labels.' : '.') +
      (st.after.later ? ' ' + fmt(st.after.later) + ' more leave within the hour after, as their column says.' : '') + '</span>'
      : TAG + '<span>Your inbox in Gmail matches the board: ' + (a.sorted ? fmt(a.sorted) + ' inbox threads have their labels and nothing waits on Apply.' : 'nothing in your inbox waits on Apply.') + '</span>';
    var n = TRIAGE.counts(), tb = $('btn-triage');
    tb.hidden = !n.open;
    tb.textContent = n.unsorted ? 'Sort ' + plural(n.unsorted, 'unsorted card') + ' one by one' : 'Check ' + plural(n.open, 'suggested card') + ' one by one';
    VIEWS.pane(); // the pane under the board recounts with the rack
  }
  // The rack's slices: a column each after Apply, hatched for what leaves the inbox (Home draws it too).
  function rackBar() {
    var st = S.st, parts = [];
    S.config.buckets.forEach(function (b) {
      var total = st.after.byBucket[b.id] || 0, gone = st.after.archivedByBucket[b.id] || 0;
      if (!total) return;
      var bg = bandOf(b) || (b.id === 'unsorted' ? 'var(--hatch)' : 'var(--muted)');
      if (total - gone) parts.push(seg(b, total - gone, bg, false));
      if (gone) parts.push(seg(b, gone, bg, true));
    });
    return parts.join('');
  }
  // A column's cards and mail for Home: cards, inbox and archived threads, and inbox threads Apply changes.
  function colInfo(b) {
    var cards = S.built.cards.filter(function (c) { return c.threads.length && R.placement(c, S.config).bucket === b.id; }), ids = [];
    cards.forEach(function (c) { ids = ids.concat(c.threads); });
    var gone = archivedIn(ids);
    return { cards: cards.length, inbox: ids.length - gone, archived: gone, change: mailOf(ids, b).change };
  }
  function showColumn(id) {
    showView('board');
    var col = document.querySelector('.col[data-bucket="' + CSS.escape(id) + '"]');
    if (col) { col.scrollIntoView({ block: 'nearest', inline: 'center' }); var card = col.querySelector('.card'); if (card) card.focus({ preventScroll: true }); }
  }
  function seg(b, n, bg, leaves) {
    return '<div class="seg' + (leaves ? ' leaves' : '') + '" style="flex-grow:' + n + ';background-color:' + bg + '" title="' +
      h(b.name + ': ' + fmt(n) + (leaves ? ' leave the inbox' : ' stay in the inbox')) + '"></div>';
  }
  function tween(id, key, to) {
    var from = shown[key], start = performance.now(), el = $(id);
    shown[key] = to;
    if (from === null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
    (function step(now) {
      var p = Math.min(1, (now - start) / 450), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  // Biggest first: inbox threads, then archived ones. The board and triage share this order.
  function bySize(a, z) { return inboxIn(z.threads) - inboxIn(a.threads) || z.threads.length - a.threads.length || a.title.localeCompare(z.title); }
  function visibleCards(b) {
    var q = $('q').value.trim().toLowerCase(), who = $('only-who').value, wait = $('only-wait').checked;
    return S.built.cards.filter(function (c) {
      if (!c.threads.length) return false;
      var p = R.placement(c, S.config);
      if (p.bucket !== b.id) return false;
      if (who && (who === 'open' ? p.decided : !p.decided || p.who !== who)) return false;
      if (wait && !mailOf(c.threads).change && !/^(new|change|plan)$/.test(cardFs(c).state)) return false;
      if (q && (c.title + ' ' + (c.subtitle || '') + ' ' + c.terms.map(function (t) { return t.value; }).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(bySize);
  }
  // Numbers count the inbox; archived mail is only ever a suffix (docs/DESIGN.md, Numbers).
  // A card whose mail is all archived shows that count, muted, so it doesn't read as empty.
  function cardHtml(c, b) {
    var p = R.placement(c, S.config), band = bandOf(b);
    var why = p.lost ? 'Its column is gone' : p.who === 'you' ? 'Placed here' : p.decided ? p.why || 'Placed here' : c.suggestion.reason;
    var moved = c.threads.filter(function (id) { var m = R.threadMove(id, S.built, S.config, S.cardByKey); return m && m.bucket !== p.bucket; }).length;
    if (moved) why += ' · ' + plural(moved, 'thread') + (moved > 1 ? ' go' : ' goes') + ' elsewhere';
    var yours = c.threads.filter(function (id) { return S.yoursBy[id]; }).length, gone = archivedIn(c.threads), inbox = c.threads.length - gone;
    if (gone) why += ' · ' + (inbox ? '+' + fmt(gone) + ' archived' : 'all archived');
    var count = inbox ? '<span class="count">' + fmt(inbox) + '</span>' : '<span class="count out" title="' + plural(gone, 'thread') + ', all archived: none in your inbox">' + fmt(gone) + '</span>';
    var does = ownDoes(c, b);
    return '<button type="button" class="card' + (p.who === 'you' ? ' mine' : p.decided ? ' by-claude' : '') + '" data-key="' + h(c.key) + '" style="--band:' + (band || 'var(--hatch)') + '">' +
      '<div class="card-top"><span class="card-title">' + h(c.title).replace(/([.@])/g, '$1<wbr>') + '</span>' + cardMarks(c, yours) + count + '</div>' + // narrow columns wrap domains at their dots
      '<div class="card-kind"><span>' + h(KIND[c.kind]) + '</span>' + (c.also ? '<span>+' + c.also + ' shared</span>' : '') + '</div>' +
      (p.sublabel && b && b.label ? '<div class="sub">' + labelChip(b, p.sublabel) + '</div>' : '') +
      (does ? '<div class="card-does" title="' + h('Its own rule: ' + does) + '">' + BOLT + '<span>' + h(does) + '</span></div>' : '') +
      '<div class="card-why">' + whoChip(p.lost ? 'none' : p.who) + h(why) + '</div></button>';
  }
  // ---------- what a card does to its mail (rules.js cardDoes): its own actions, condition, archiving later ----------
  // In words: "Skips inbox, marks read · when through portfolio@x.com · archives 3 days after". Column defaults aren't said.
  var ACT_WORDS = { read: ['marks read', 'stays unread'], star: ['stars it'], trash: ['deletes it'] };
  function doesWords(c, b) {
    var own = (S.config.cards || {})[c.key] || {}, act = own.act || {}, d = R.cardDoes(c, S.config, b), w = d.when, out = [], lv = R.cardLeaves(own);
    if (lv) out.push(leavesWords(lv).toLowerCase());
    Object.keys(ACT_WORDS).forEach(function (k) { if (act[k] !== undefined && act[k] !== null) { var x = ACT_WORDS[k][act[k] ? 0 : 1]; if (x) out.push(x); } });
    if (act.important) out.push(act.important === 'always' ? 'always important' : 'never important');
    var s = out.join(', ');
    if (w && d.extra) s += ' · when ' + whenWords(w);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  // When mail leaves the inbox (rules.js leavesOf): one menu for a column, its filter row on the Gmail tab and a card.
  var LEAVES = [['never', 'Stays in the inbox'], ['now', 'Leaves right away'], ['d1', 'Leaves after 1 day'], ['d3', 'Leaves after 3 days'], ['d7', 'Leaves after a week'],
    ['d14', 'Leaves after 2 weeks'], ['d30', 'Leaves after a month'], ['read', 'Leaves once read']];
  function leavesWords(v) { var x = LEAVES.filter(function (l) { return l[0] === v; })[0]; return x ? x[1] : /^d\d+$/.test(v || '') ? 'Leaves after ' + plural(+v.slice(1), 'day') : ''; }
  // inherit: the column's answer, for a card's "as the column" (its value is ''); terse: just "As the column", the row above says it
  function leavesSelect(attrs, v, inherit, terse) {
    var list = LEAVES.slice();
    if (v && !list.some(function (l) { return l[0] === v; })) list.push([v, leavesWords(v)]); // set in an imported settings file
    if (inherit != null) list.unshift(['', terse ? 'As the column' : 'As the column: ' + leavesWords(inherit).toLowerCase()]);
    return '<select ' + attrs + '>' + list.map(function (o) { return '<option value="' + h(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + h(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function whenWords(w) {
    return [w.via && 'through ' + w.via, w.notMe && 'not sent to you by name', w.att && 'with an attachment', w.subject.length && 'the subject has ' + w.subject.join(' or '),
      w.except.length && 'not ' + w.except.join(', ')].filter(Boolean).join(', ');
  }
  function ownDoes(c, b) { var own = (S.config.cards || {})[c.key]; return own && (own.act || own.when || own.later) && b && b.label ? doesWords(c, b) : ''; }
  var BOLT = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
  // Who put a card where it is (docs/DESIGN.md, The tag card): you, Claude, a rule, or labels already in Gmail.
  var WHO = { you: 'You', claude: 'Claude', rule: 'Rule', gmail: 'Gmail' };
  var WHO_TIP = { you: 'You placed it: it stays here whatever the suggestions say.', claude: 'Claude placed it, from a review you imported. Moving it or keeping it makes it yours.',
    rule: 'A guess from your contacts, topics or the sender: it follows the suggestion until you place it.', gmail: 'A guess from labels the mail already has in Gmail, from before Labelboard.' };
  function whoChip(w) { return WHO[w] ? '<span class="who who-' + w + '" title="' + h(WHO_TIP[w]) + '">' + WHO[w] + '</span>' : ''; }
  // The card's filters at a glance: Labelboard's for its label, and yours when they match its mail too.
  var CF = { live: 'Filter live', new: 'Filter on Apply', change: 'Changes on Apply', out: 'Filter left out', none: 'No filter', plan: 'Makes a filter' };
  function cardMarks(c, yours) {
    var f = cardFs(c);
    return '<div class="card-fs"><span class="cf cf-' + f.state + '" title="' + h(f.state === 'none' ? 'No Gmail filter: new mail like this lands in your inbox as usual.' : FS_TIP[f.state] || 'Becomes a Gmail filter when you apply.') + '">' +
      FUNNEL + '<span class="cf-t">' + h(CF[f.state]) + '</span></span>' +
      (yours ? '<span class="cf cf-yours" title="' + h(plural(yours, 'thread') + ' here also match a Gmail filter of yours. Gmail runs both.') + '">' + FUNNEL + '<span class="cf-t">Yours · ' + fmt(yours) + '</span></span>' : '') +
      cardMail(c) + '</div>';
  }
  // The funnel is the filter (new mail), the tag is the mail already in the inbox: plain when Gmail has it, accent until Apply.
  function cardMail(c) {
    var b = bucket(R.placement(c, S.config).bucket), n = mailOf(c.threads, b);
    if (n.change) return '<span class="cf cf-mail cf-new" title="' + h(mailTip(n)) + '">' + TAG + '<span class="cf-n">' + fmt(n.change) + '</span><span class="cf-t"> to sort on Apply</span></span>';
    return n.sorted ? '<span class="cf cf-mail cf-live" title="' + h(sortedTip(n, b)) + '">' + TAG + '<span class="cf-t">Sorted in Gmail</span></span>' : '';
  }
  // What Apply does to these threads in the inbox, against the labels Gmail has on them now (S.st.apply).
  // sorted: threads Apply leaves alone that already carry b's label, archived ones included.
  function mailOf(ids, b) {
    var by = S.st ? S.st.apply.byThread : {}, n = { change: 0, add: 0, leave: 0, read: 0, off: 0, sorted: 0 };
    ids.forEach(function (id) {
      var ch = by[id];
      if (!ch) { if (b && b.label && S.byId[id].labels.indexOf(b.label) >= 0) n.sorted++; return; }
      n.change++; if (ch.add.length) n.add++; if (ch.leaves) n.leave++; if (ch.read) n.read++; if (ch.off.length) n.off++;
    });
    return n;
  }
  function mailTip(n) {
    var one = function (k, a, b) { return n[k] ? fmt(n[k]) + ' ' + (n[k] === 1 ? a : b) : ''; };
    return 'When you apply: ' + [one('add', 'gets its label', 'get their label'), one('leave', 'leaves the inbox', 'leave the inbox'), one('read', 'is marked read', 'are marked read'), one('off', 'loses a label Labelboard gave it before', 'lose a label Labelboard gave them before')]
      .filter(Boolean).join(', ') + ' (' + plural(n.change, 'inbox thread') + '). Until then Gmail shows ' + (n.change === 1 ? 'it as it is' : 'them as they are') + '.' + (n.sorted ? ' ' + fmt(n.sorted) + ' already sorted.' : '');
  }
  function sortedTip(n, b) { return plural(n.sorted, 'thread') + ' here already ' + (n.sorted === 1 ? 'has ' : 'have ') + b.label + ' in Gmail' + (b.archive ? (n.sorted === 1 ? ' and is' : ' and are') + ' out of the inbox' : '') + '. Apply has nothing to change.'; }
  var FUNNEL = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>';
  var TAG = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M1 12l6.5-8H23v16H7.5zM9 10.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z"/></svg>';
  function foldBtn(id, name) {
    var f = isCollapsed(id);
    return '<button class="btn ghost icon fold" type="button" data-fold="' + h(id) + '" aria-expanded="' + !f + '" aria-label="' + (f ? 'Open ' : 'Fold ') + h(name) + '" title="' + (f ? 'Open' : 'Fold') + ' this column">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>';
  }
  // A folded column is a narrow rail: its head sits inside the well, so the whole rail still takes drops.
  function railHead(id, name, n, dot) {
    return '<div class="col-head">' + foldBtn(id, name) + (dot ? '<span class="dot" style="background:' + dot + '"></span>' : '') + '<h3>' + h(name) + '</h3><span class="count">' + fmt(n) + '</span></div>';
  }
  function archivedIn(ids) { return ids.filter(function (id) { return !inInbox(S.byId[id]); }).length; }
  function inboxIn(ids) { return ids.length - archivedIn(ids); }
  // Cards in this column you haven't made yours: suggestions and Claude's placements (Unsorted's aren't a suggestion to accept)
  function suggested(b, cards) {
    return b.id === 'unsorted' ? [] : cards.filter(function (c) { var p = R.placement(c, S.config); return p.who !== 'you' && !p.lost; });
  }
  // column id → the visible cards' threads that land there: a thread you moved on its own counts where it went, as in the rack
  function landing(cardsBy) {
    var out = {};
    Object.keys(cardsBy).forEach(function (id) { cardsBy[id].forEach(function (c) { c.threads.forEach(function (t) {
      var m = R.threadMove(t, S.built, S.config, S.cardByKey), to = m ? (bucket(m.bucket) ? m.bucket : 'unsorted') : id;
      (out[to] = out[to] || []).push(t);
    }); }); });
    return out;
  }
  function cardsByColumn() { var m = {}; S.config.buckets.forEach(function (b) { m[b.id] = visibleCards(b); }); return m; }
  function colHead(b, cards, lands) {
    var ids = lands[b.id] || [], threads = ids.length, gone = archivedIn(ids);
    var special = !b.label, sugg = suggested(b, cards), open = sugg.length, pills;
    var cl = sugg.filter(function (c) { return R.placement(c, S.config).decided; }).length;
    if (isCollapsed(b.id)) return railHead(b.id, b.name, threads - gone, bandOf(b));
    return '<div class="col-head"><div class="col-title">' +
      (special ? '' : '<button class="stamp" type="button" data-settings="' + h(b.id) + '" aria-label="Edit ' + h(b.name) + '" title="Edit this column" style="background:' + (bandOf(b) || '#ccc') + '"></button>') +
      '<h3 class="col-grab" title="Drag to reorder">' + h(b.name) + '</h3>' + foldBtn(b.id, b.name) + '</div>' +
      (special ? '<p class="col-desc">' + h(b.description || '') + '</p>' : '<div class="col-sub">' + labelChip(b) +
        leavesSelect('class="leaves" data-leaves="' + h(b.id) + '" aria-label="When mail in ' + h(b.name) + ' leaves the inbox"', R.leavesOf(b)) + '</div>') +
      ((pills = colFsHtml(b) + colMailHtml(b, cards)) ? '<div class="col-sub col-gmail">' + pills + '</div>' : '') +
      '<div class="col-sub"><span><b>' + fmt(threads - gone) + '</b> in your inbox' + (gone ? ' +' + fmt(gone) + ' archived' : '') + '</span><span>' + plural(cards.length, 'card') + '</span></div>' +
      (open ? '<div class="col-sub"><button type="button" class="linkish" data-accept="' + h(b.id) + '" title="Mark ' + (open === 1 ? 'it' : 'them') + ' as placed by you: ' + (open === 1 ? 'it stays' : 'they stay') + ' here whatever the suggestions say later">Accept ' + (cl === open ? 'Claude\'s ' + (open === 1 ? 'card' : fmt(open) + ' cards') : (open === 1 ? 'the suggested card' : 'the ' + fmt(open) + ' suggested cards') + (cl ? ' (' + fmt(cl) + ' from Claude)' : '')) + '</button></div>' : '') + '</div>';
  }
  var sortables = [], FIT = 6;
  function renderBoard() {
    sortables.forEach(function (s) { s.destroy(); }); sortables = [];
    if (!S.snapshot.threads.length) return SET.firstRun($('board'), refresh);
    var tops = {}; // a re-render keeps each column where you had scrolled it
    document.querySelectorAll('.board [data-scroll]').forEach(function (el) { tops[el.dataset.scroll] = el.scrollTop; });
    filterInfo(); renderReview();
    var lane = laneHtml();
    $('board').classList.toggle('fit', S.config.buckets.length <= FIT); // up to FIT columns share the width (style.css .board.fit)
    var cardsBy = cardsByColumn(), lands = landing(cardsBy);
    var html = S.config.buckets.map(function (b) {
      var cards = cardsBy[b.id], folded = isCollapsed(b.id);
      return '<section class="col movable' + (b.label ? '' : ' special') + (folded ? ' collapsed' : '') + '" data-bucket="' + h(b.id) + '" aria-label="' + h(b.name) + '">' + (folded ? '' : colHead(b, cards, lands)) +
        '<div class="cards" data-bucket="' + h(b.id) + '" data-scroll="' + h(b.id) + '">' + (folded ? colHead(b, cards, lands) : cards.length ? cards.map(function (c) { return cardHtml(c, b); }).join('') : '<p class="empty">Nothing here yet</p>') + '</div></section>';
    }).join('') + lane + '<button class="add-col" type="button" id="add-bucket">Add a column</button>';
    $('board').innerHTML = html;
    document.querySelectorAll('.board [data-scroll]').forEach(function (el) { if (tops[el.dataset.scroll]) el.scrollTop = tops[el.dataset.scroll]; });
    refreshView(); // a change made from a view's drawer (a card moved) shows there too
    if (!window.Sortable) return;
    var cold = function () { document.querySelectorAll('.col.drop-hot').forEach(function (c) { c.classList.remove('drop-hot'); }); };
    Array.prototype.forEach.call(document.querySelectorAll('.cards:not(.lane-cards)'), function (el) {
      sortables.push(Sortable.create(el, {
        group: 'cards', sort: false, draggable: '.card', animation: 180, easing: 'cubic-bezier(.2,.8,.2,1)',
        onMove: function (e) { cold(); e.to.parentNode.classList.add('drop-hot'); },
        onEnd: cold,
        onAdd: function (e) {
          var to = e.to.dataset.bucket;
          moveCard(e.item.dataset.key, to, e.item);
          if (isCollapsed(to)) { e.item.remove(); refreshHeads(); }
        },
      }));
    });
    // columns reorder by their heading; the filters lane and "Add a column" stay at the end
    sortables.push(Sortable.create($('board'), {
      draggable: '.col.movable', handle: '.col-grab', animation: 180, easing: 'cubic-bezier(.2,.8,.2,1)',
      onEnd: function (e) { if (e.oldIndex !== e.newIndex) orderColumns(Array.prototype.map.call(document.querySelectorAll('.col.movable'), function (c) { return c.dataset.bucket; })); },
    }));
  }
  function orderColumns(ids) {
    S.config.buckets.sort(function (a, z) { return ids.indexOf(a.id) - ids.indexOf(z.id); });
    renderRack(); save();
  }
  function fold(id) {
    var u = ui(), list = u.collapsed = u.collapsed || [], i = list.indexOf(id);
    if (id === 'lane') { u.lane = isCollapsed(id) ? 'open' : 'folded'; if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list.splice(i, 1); else list.push(id);
    renderBoard(); save();
    var btn = document.querySelector('[data-fold="' + CSS.escape(id) + '"]'); if (btn) btn.focus();
  }

  // ---------- changes ----------
  // Records the card as placed by you in that column; the caller redraws (placed() for the heads, rack and save).
  function place(key, bucketId) {
    var cur = S.config.cards[key] || {}, c = S.cardByKey[key];
    // A sub-label belongs to the bucket it was set in: moving to another bucket drops it.
    var sub = cur.sublabel !== undefined && cur.bucket === bucketId ? cur.sublabel : (bucketId === c.suggestion.bucket ? undefined : null);
    S.config.cards[key] = sub === undefined ? { bucket: bucketId } : { bucket: bucketId, sublabel: sub };
  }
  function placed() { filterInfo(); renderRack(); renderReview(); refreshHeads(); refreshLane(); refreshMarks(); save(); }
  function moveCard(key, bucketId, el) {
    var c = S.cardByKey[key], b = bucket(bucketId), cur = S.config.cards[key];
    // the pane's last-move line: numbers before the move, compared once the rack has recounted (moveLine)
    S.lastMove = { key: key, title: c.title, from: R.placement(c, S.config).bucket, to: bucketId, prev: cur ? Object.assign({}, cur) : null,
      by: Object.assign({}, S.st.after.byBucket), inbox: S.st.after.inbox, apply: S.st.apply.threads, fs: S.fs ? S.fs.pending : null, text: null };
    place(key, bucketId);
    if (el) {
      el.style.setProperty('--band', bandOf(b) || 'var(--hatch)');
      el.classList.add('mine'); el.classList.remove('by-claude');
      el.querySelector('.card-why').innerHTML = whoChip('you') + 'Placed here';
      var sub = el.querySelector('.sub'); if (sub) sub.remove();
      var empty = el.parentNode.querySelector('.empty'); if (empty) empty.remove();
    }
    placed();
    toast(c.title + ' moved to ' + b.name);
  }
  // "stripe.com → Portfolio: Portfolio +14, Unsorted −14, inbox after Apply −14, 1 more filter change". Frozen once worked out.
  function moveLine() {
    var m = S.lastMove; if (!m || !S.st) return '';
    if (m.text == null) {
      var a = S.st.after, sign = function (d) { return (d > 0 ? '+' : '−') + fmt(Math.abs(d)); }, parts = [];
      (m.to === m.from ? [m.to] : [m.to, m.from]).forEach(function (id) { var d = (a.byBucket[id] || 0) - (m.by[id] || 0); if (d) parts.push(h(bucket(id).name) + ' ' + sign(d)); });
      if (a.inbox !== m.inbox) parts.push('inbox after Apply ' + sign(a.inbox - m.inbox));
      var df = S.fs && S.fs.pending != null && m.fs != null ? S.fs.pending - m.fs : 0;
      if (df) parts.push(plural(Math.abs(df), 'filter change') + (df > 0 ? ' more' : ' fewer') + ' on Apply');
      m.text = '<b>' + h(m.title) + '</b> → ' + h(bucket(m.to).name) + ': ' + (parts.length ? parts.join(', ') : 'no change to your inbox') + '.';
    }
    var still = S.config.cards[m.key] && S.config.cards[m.key].bucket === m.to;
    return m.text + (still ? ' <button type="button" class="linkish" data-undo-move>Undo</button>' : '');
  }
  function undoMove() {
    var m = S.lastMove; if (!m) return;
    if (m.prev) S.config.cards[m.key] = m.prev; else delete S.config.cards[m.key];
    S.lastMove = null; renderBoard(); placed(); toast(m.title + ' is back where it was');
  }
  function acceptColumn(id) {
    var b = bucket(id), cards = suggested(b, visibleCards(b)); S.lastMove = null;
    cards.forEach(function (c) { place(c.key, id); });
    renderBoard(); renderRack(); save();
    toast(plural(cards.length, 'card') + ' in ' + b.name + ' marked as placed by you');
  }
  function refreshHeads() {
    var cardsBy = cardsByColumn(), lands = landing(cardsBy);
    S.config.buckets.forEach(function (b) {
      var col = document.querySelector('.col[data-bucket="' + CSS.escape(b.id) + '"]');
      if (!col) return;
      var tmp = document.createElement('div'), old = col.querySelector('.col-head'); tmp.innerHTML = colHead(b, cardsBy[b.id], lands);
      old.parentNode.replaceChild(tmp.firstChild, old); // a folded column keeps its head inside the well
    });
  }
  var saveTimer;
  function save() {
    S.edits = (S.edits || 0) + 1; clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      API.saveConfig(S.config).catch(function (e) { oops(e, 'Your last change was not saved. Nothing in Gmail changed. Your next change saves everything again; if this repeats, reload the page.'); });
    }, 500);
  }

  // ---------- where the board's filters stand in Gmail ----------
  // planFilters is the plan without the inbox backfill (~10 ms on a real inbox), so this runs on every move.
  // S.fs = { filters, status (null when Gmail's filters weren't read), byCard: key → labels, pending }
  function adoptIds() { var a = S.config.adopted || {}; return (S.gmail.filters || []).filter(function (f) { return a[f.id] && !f.owned; }).map(function (f) { return f.id; }); }
  function filterInfo() {
    var g = S.gmail || {}, pf = R.planFilters(S.built, S.config), adopt = adoptIds(), byCard = {};
    Object.keys(pf.groups).forEach(function (k) { var gr = pf.groups[k]; gr.cards.forEach(function (c) { var l = byCard[c] = byCard[c] || []; if (l.indexOf(gr.label) < 0) l.push(gr.label); }); });
    var st = g.filters ? LabelboardSync.filterStatus(pf.filters, g.filters, g.gone, adopt, S.config.release, S.config.restoreFilters) : null;
    var newLabels = g.labels ? pf.labels.filter(function (l) { return g.labels.indexOf(l.name) < 0; }).length : 0;
    var later = R.laterRules(S.built, S.config, pf), laterNew = JSON.stringify(later) !== JSON.stringify(g.later ? g.later.rules : []) ? 1 : 0; // the timed rules, as one change
    var ls = labelState(pf), hk = ls ? ls.hk : null, labelsNew = hk ? hk.recolor.length + hk.repaint + hk.moves.length + hk.adoptLabels.length : 0;
    S.fs = { filters: pf.filters, status: st, byCard: byCard, later: later, laterNew: laterNew, pending: st ? st.actions.create.length + st.actions.remove.length + adopt.length + (S.config.release || []).length + newLabels + laterNew + labelsNew : null };
  }
  // Gmail's labels against the board (labels.js): rows for the Gmail tab and what Apply does about them (hk). plan: a
  // buildPlan, or planFilters when only counting (its labels lack the inbox's AI-read sub-labels). null: labels not read.
  function labelState(plan) {
    var g = S.gmail || {};
    if (!g.labelInfo) return null;
    plan = plan || R.buildPlan(S.snapshot, S.built, S.config, S.seeds, g);
    var rows = LB.classify(g.labelInfo, g.ownedLabels || [], LB.layout(S.built, S.config, plan, g.adoptedLabels), S.config);
    return { rows: rows, hk: LB.housekeeping(rows, plan, S.config, g.filters), plan: plan };
  }
  // The header's Review button says whether Gmail has caught up with the board.
  // The badge counts filter and label changes plus the inbox threads Apply sorts: everything not in Gmail yet.
  function renderReview() {
    var btn = $('btn-review'), f = S.fs && S.fs.pending, t = S.st ? S.st.apply.threads : 0, n = (f || 0) + t, known = f != null && S.snapshot.threads.length;
    btn.classList.toggle('primary', !known || n > 0);
    btn.innerHTML = known && !n ? 'Gmail is up to date' : 'Review changes' + (n ? ' <span class="badge">' + fmt(n) + '</span>' : '');
    var parts = [f && plural(f, 'filter or label change', 'filter and label changes'), t && plural(t, 'inbox thread') + ' to sort'].filter(Boolean);
    btn.title = n ? parts.join(' and ') + ': not in Gmail yet. Gmail shows mail as it is until you apply.'
      : known ? 'Every filter, label and inbox thread on the board is in Gmail.' : '';
  }
  var FS = { live: 'live in Gmail', new: 'made on Apply', change: ['changes on Apply', 'change on Apply'], gone: 'removed on Apply', out: 'left out of Apply' };
  var FS_TIP = { live: 'Gmail labels new mail like this as it arrives.', new: 'Until you apply, new mail like this arrives without a label.',
    change: 'A card here moved or changed: Gmail runs the old filter until you apply.', gone: 'No card here makes a filter any more: Apply removes Labelboard\'s old one.',
    out: 'Labelboard\'s filter here was deleted or edited in Gmail, so Apply leaves it out until you restore it.', none: 'No card here makes a rule for new mail yet.' };
  function inLabel(b) { return function (l) { return b ? l === b.label || l.indexOf(b.label + '/') === 0 : !R.bucketOfLabel(l, S.config); }; }
  // Summed counts for a column's labels (and sub-labels), or with b null for labels no column owns any more.
  function colStatus(b) {
    var st = S.fs && S.fs.status, sum = { want: 0, create: 0, remove: 0, skipped: 0 }, mine = inLabel(b);
    if (!st || b && !b.label) return null;
    Object.keys(st.byLabel).forEach(function (l) { if (mine(l)) Object.keys(sum).forEach(function (k) { sum[k] += st.byLabel[l][k]; }); });
    return sum;
  }
  // b (optional): a column with no filter whose colleague card is labelled every hour says so instead
  function fsText(s, b) {
    var state = LabelboardSync.filterState(s), many = Math.max(s.want, s.remove) > 1, verb = FS[state], hr = state === 'none' && hourly(b);
    return hr ? (hr === 'live' ? 'Labelled every hour' : 'Labelled every hour once you apply') : state === 'none' ? 'No filter yet' : (many ? 'Filters ' : 'Filter ') + (Array.isArray(verb) ? verb[many ? 1 : 0] : verb);
  }
  // A column's colleague card rule (rules.js peopleRules): 'live' once the server has it as the board has it, 'new' before; '' with none.
  function hourly(b) {
    var r = b && (S.fs && S.fs.later || []).filter(function (x) { return x.kind === 'people' && x.bucket === b.id; })[0]; if (!r) return '';
    var g = S.gmail || {}, on = (g.later && g.later.rules || []).filter(function (x) { return x.id === r.id; })[0];
    return on && JSON.stringify(on) === JSON.stringify(r) ? 'live' : 'new';
  }
  function colFsHtml(b) {
    var s = colStatus(b); if (!s) return '';
    var state = LabelboardSync.filterState(s), hr = state === 'none' && hourly(b);
    if (hr) return '<span class="fs fs-pill fs-' + hr + '" title="Gmail filters can\'t tell who else is on a thread: Labelboard labels this column\'s colleague mail every hour.">' + FUNNEL + h(fsText(s, b)) + '</span>';
    return state === 'none' ? '<span class="fs fs-pill fs-none" title="' + h(FS_TIP.none) + '">' + FUNNEL + h(fsText(s)) + '</span>'
      : '<button type="button" class="fs fs-pill fs-' + state + '" data-ours="' + h(b.id) + '" title="' + h(FS_TIP[state] + ' Click to see the filters.') + '">' + FUNNEL + h(fsText(s)) + '</button>';
  }
  // Its mail already in the inbox: sorted in Gmail, or how many threads Apply still changes (the filter pill is new mail).
  function colMailHtml(b, cards) {
    var n = mailOf(cards.reduce(function (all, c) { return all.concat(c.threads); }, []), b);
    if (n.change) return '<span class="fs fs-pill fs-new" title="' + h(mailTip(n)) + '">' + TAG + h(fmt(n.change) + ' to sort on Apply') + '</span>';
    return n.sorted ? '<span class="fs fs-pill fs-live" title="' + h(sortedTip(n, b)) + '">' + TAG + 'Sorted in Gmail</span>' : '';
  }
  function fsTag(state, text) { return '<span class="fs fs-' + state + '">' + h(text) + '</span>'; }

  // ---------- how labels got onto the mail (insights.js filterTrace, for the Filters view and the drawers) ----------
  // Every filter with a label: Gmail's (one entry per label it adds) and the ones Apply would make. Kept until
  // that list changes: matching every filter against every thread takes ~300 ms on a big inbox.
  function trace() {
    var g = S.gmail || {}, a = S.config.adopted || {}, st = S.fs && S.fs.status, list = [];
    (g.filters || []).forEach(function (f) {
      f.labels.forEach(function (l, i) { list.push({ id: f.id + (i ? '#' + i : ''), gid: f.id, query: f.query, label: l, live: true, ours: !!(f.owned || a[f.id]), at: f.at || null }); });
    });
    (st ? st.actions.create : S.fs ? S.fs.filters : []).forEach(function (f, i) { list.push({ id: 'new:' + i, query: f.query, label: f.label, live: false, ours: true }); });
    // the colleague cards' hourly rules count as filters here: live once Apply handed them to the server
    var on = (g.later && g.later.rules || []).map(function (r) { return r.id; });
    (S.fs ? S.fs.later : []).forEach(function (r) {
      if (r.kind !== 'people') return;
      var who = { me: r.me, firmDomains: r.firm }, match = function (t) { return R.whoIsOn(t, who) === r.side; };
      r.labels.forEach(function (l, i) { list.push({ id: r.id + (i ? '#' + i : ''), query: r.side + ':' + r.firm.concat(r.me).join(','), label: l, live: on.indexOf(r.id) >= 0, ours: true, match: match }); });
    });
    var key = list.map(function (f) { return [f.query, f.label, f.live, f.at].join('|'); }).join('\n') + '\n' + S.config.buckets.map(function (b) { return b.label; }).join('|');
    if (!S.tr || S.tr.key !== key || S.tr.mail !== S.mail) S.tr = { key: key, mail: S.mail, filters: list, t: window.LabelboardInsights.filterTrace(S.mail, list, S.config) };
    return S.tr;
  }
  // One line on how a set of threads got (or would get) its labels: "40 by a filter · 3 came before it, no label"
  var HOW_TEXT = { filter: 'labelled by a filter', early: 'labelled when the filter was made', hand: 'labelled by hand (no filter matches)',
    missed: 'came before the filter: no label', would: 'caught once you apply' };
  function howLine(n) {
    var parts = ['filter', 'early', 'hand', 'missed', 'would'].filter(function (k) { return n[k]; }).map(function (k) { return fmt(n[k]) + ' ' + HOW_TEXT[k]; });
    return parts.length ? parts.join(' · ') : '';
  }
  function howOf(node, ids) {
    var n = {}, m = trace().t.nodes[node] || {};
    ids.forEach(function (id) { var x = m[id]; if (x) n[x.how] = (n[x.how] || 0) + 1; });
    return n;
  }

  // ---------- Gmail filters: a lane after the columns ----------
  // Labelboard's own filters, one card per column; then the ones the board doesn't write: yours (read-only
  // until you adopt one), the ones you adopted, and Labelboard's you deleted or edited in Gmail.
  function oursList() {
    if (!S.fs || !S.fs.status) return [];
    return S.config.buckets.concat([null]).map(function (b) { return { b: b, s: colStatus(b) }; }).filter(function (x) { return x.s && (x.s.want || x.s.remove); });
  }
  function laneHtml() {
    var g = S.gmail || {}, gone = g.gone || [], ours = oursList();
    S.filters = g.filters ? R.gmailFilters(g, S.mail, S.built, S.config) : [];
    S.yoursBy = {};
    S.filters.forEach(function (f) { if (!f.adopted) (f.threads || []).forEach(function (t) { S.yoursBy[t] = 1; }); });
    var nOurs = ours.reduce(function (n, x) { return n + x.s.want; }, 0);
    var desc = g.error ? 'Could not read your filters: ' + g.error : !g.filters ? 'Your Gmail filters show here once Labelboard runs as your Apps Script.'
      : 'Gmail runs all of these on new mail. Labelboard\'s come from the columns; yours it never changes unless you adopt one.';
    if (isCollapsed('lane')) return '<section class="col special lane collapsed" aria-label="Gmail filters"><div class="cards lane-cards" data-scroll="lane">' + railHead('lane', 'Gmail filters', nOurs + S.filters.length) + '</div></section>';
    var cards = gone.map(goneHtml).join('') + (ours.length ? '<h4 class="lane-h">Labelboard\'s</h4>' + ours.map(oursHtml).join('') : '') +
      (S.filters.length ? '<h4 class="lane-h">Yours</h4>' + S.filters.map(filterHtml).join('') : '');
    return '<section class="col special lane" aria-label="Gmail filters"><div class="col-head"><div class="col-title"><h3>Gmail filters</h3>' + foldBtn('lane', 'Gmail filters') + '</div>' +
      '<p class="col-desc">' + h(desc) + '</p><div class="col-sub"><span><b>' + fmt(nOurs) + '</b> Labelboard\'s · <b>' + fmt(S.filters.length) + '</b> yours</span>' +
      (gone.length ? '<span class="stale">' + plural(gone.length, 'changed in Gmail', 'changed in Gmail') + '</span>' : '') + '</div></div>' +
      '<div class="cards lane-cards" data-scroll="lane">' + (cards || '<p class="empty">None</p>') + '</div></section>';
  }
  function oursHtml(x) {
    var b = x.b, state = LabelboardSync.filterState(x.s);
    return '<button type="button" class="card fcard ours" data-ours="' + h(b ? b.id : '') + '" style="--band:' + (bandOf(b) || 'var(--hatch)') + '">' +
      '<div class="card-top"><span class="card-title">' + h(b ? b.name : 'Labels no column uses') + '</span></div>' +
      '<div class="card-kind"><span>' + plural(x.s.want, 'filter') + '</span>' + (b && b.archive ? '<span>skips the inbox</span>' : '') + '</div>' +
      (b ? '<div class="sub">' + labelChip(b) + '</div>' : '') + '<div class="card-why">' + fsTag(state, fsText(x.s)) + '</div></button>';
  }
  // A column's filters in Gmail, read-only: each one's search and whether Apply makes, keeps or removes it.
  function openOurs(id) {
    var b = id ? bucket(id) : null, st = S.fs && S.fs.status; if (!st || id && !b) return;
    var fa = st.actions, mine = inLabel(b), s = colStatus(b), state = LabelboardSync.filterState(s), byId = {};
    (S.gmail.filters || []).forEach(function (f) { byId[f.id] = f; });
    var row = function (label, query, archive, tag, text) {
      return '<li class="ofl"><div class="ofl-h">' + nameChip(label) + fsTag(tag, text) + (archive ? '<span>skips the inbox</span>' : '') + '</div>' +
        '<div class="query">' + h(query) + '</div><a href="' + gmailSearch(query) + '" target="_blank" rel="noopener">See matching mail in Gmail</a></li>';
    };
    var rows = S.fs.filters.filter(function (f) { return mine(f.label); }).map(function (f) {
      var t = fa.create.indexOf(f) >= 0 ? ['new', 'Made on Apply'] : fa.skipped.indexOf(f) >= 0 ? ['out', 'Left out'] : ['live', 'Live in Gmail'];
      return row(f.label, f.query, f.archive, t[0], t[1] + (/^adopted:/.test(f.id) ? ', adopted' : ''));
    }).concat(fa.remove.map(function (i) { return byId[i]; }).filter(function (f) { return f && mine(f.labels.join(',')); }).map(function (f) {
      return row(f.labels.join(','), f.query, f.archive, 'gone', 'Removed on Apply');
    }));
    $('dr-kind').textContent = 'Labelboard\'s filters';
    $('dr-title').textContent = b ? b.name : 'Labels no column uses';
    var how = b ? howLine(howOf('col:' + b.id, Object.keys(trace().t.nodes['col:' + b.id] || {}))) : '';
    $('dr-body').innerHTML = '<p>' + h(fsText(s)) + '. ' + h(FS_TIP[state]) + '</p>' +
      (state === 'live' ? '' : '<p class="note">Review changes, then Apply, writes this to Gmail.</p>') + howHtml(how) + '<ul class="ofls">' + rows.join('') + '</ul>';
    wireGoto(); showDrawer();
  }
  // The trace in a drawer: one line, and the way to the Filters view, which shows it day by day.
  function howHtml(line) {
    return line ? '<div class="field how"><span class="fs-head">' + FUNNEL + 'In the mail Labelboard read</span><p>' + h(line) + '.</p>' +
      '<p class="note">Gmail doesn\'t record who added a label: this checks which filters match. <button type="button" class="linkish" data-goto="gmail">See it day by day</button></p></div>' : '';
  }
  function wireGoto() {
    document.querySelectorAll('#dr-body [data-goto]').forEach(function (el) { el.onclick = function () { closeDrawer(); showView(el.dataset.goto); }; });
  }
  function showView(v) { ui().view = v; applyView(); save(); }
  // Priorities' memory in config.ui (I.priorities opts), so Home counts the same: threads you hid, kept while
  // they are in the inbox with no newer message, and the colleagues switch.
  function prioOpts() {
    var u = ui(), hid = u.hidden || {}, keep = {}, n = 0;
    S.snapshot.threads.forEach(function (t) { if (hid[t.id] && hid[t.id] >= t.date) { keep[t.id] = hid[t.id]; n++; } });
    if (n !== Object.keys(hid).length) { if (n) u.hidden = keep; else delete u.hidden; save(); }
    return { hidden: keep, colleaguesOut: !!u.colleaguesOut };
  }
  function refreshLane() {
    var el = document.querySelector('.lane'); if (!el) return;
    var tmp = document.createElement('div'); tmp.innerHTML = laneHtml();
    el.parentNode.replaceChild(tmp.firstChild, el);
  }
  // what the board has read, for "N threads … match it"
  function where() { return S.recent ? 'in your inbox or archived in the last ' + (S.snapshot.window && S.snapshot.window.days || 30) + ' days' : 'in your inbox'; }
  function overlapText(f) {
    var ls = Object.keys(f.overlap);
    if (f.threads == null) return 'Can\'t preview: it searches more than sender and subject';
    if (!f.threads.length) return 'Nothing ' + where() + ' matches';
    if (!ls.length) return 'The board gives these no label';
    return ls.map(function (l) { return fmt(f.overlap[l]) + (l === f.label ? ' already get it from the board' : ' get ' + l + ' from the board'); }).join(' · ');
  }
  function filterHtml(f) {
    var a = f.adopted, b = R.bucketOfLabel(f.label, S.config);
    var kind = a ? (a.off ? 'Adopted · deleted on Apply' : !f.inGmail ? 'Adopted · changed on Apply' : f.pending ? 'Adopted · handed over on Apply' : 'Adopted by Labelboard') : 'Yours';
    return '<button type="button" class="card fcard' + (a ? ' mine' : '') + '" data-filter="' + h(f.id) + '" style="--band:' + (bandOf(b) || 'var(--hatch)') + '">' +
      '<div class="card-top"><span class="card-title">' + h(f.query) + '</span><span class="count">' + (f.threads ? f.threads.length : '–') + '</span></div>' +
      '<div class="card-kind"><span>' + h(kind) + '</span>' + (f.archive ? '<span>skips the inbox</span>' : '') + (f.extras.length ? '<span>' + h(f.extras.join(', ')) + '</span>' : '') + '</div>' +
      (f.label ? '<div class="sub">' + nameChip(f.label) + '</div>' : '') + '<div class="card-why">' + h(overlapText(f)) + '</div></button>';
  }
  function goneHtml(s) {
    var k = LabelboardSync.specKey(s), back = (S.config.restoreFilters || []).indexOf(k) >= 0;
    return '<button type="button" class="card fcard drift" data-gone="' + h(k) + '">' +
      '<div class="card-top"><span class="card-title">' + h(s.query) + '</span></div>' +
      '<div class="card-kind"><span>Labelboard\'s filter, ' + (s.why === 'edited' ? 'edited in Gmail' : 'no longer in Gmail') + '</span></div>' +
      '<div class="sub">' + nameChip(s.label) + '</div><div class="card-why">' + (back ? 'Restored on the next Apply' : 'Left out of Apply until you restore it') + '</div></button>';
  }
  function openFilter(id) {
    var f = S.filters.filter(function (x) { return x.id === id; })[0]; if (!f) return;
    var a = f.adopted, over = Object.keys(f.overlap);
    $('dr-kind').textContent = a ? 'Gmail filter adopted by Labelboard' : 'Your Gmail filter';
    $('dr-title').textContent = f.label || 'No label';
    var does = [f.label ? 'adds ' + f.label : '', f.archive ? 'skips the inbox' : ''].concat(f.extras).filter(Boolean).join(', ');
    var seen = f.threads == null ? 'Its search uses terms Labelboard can\'t check from sender and subject (such as list: or words in the body), so the board can\'t count it.'
      : plural(f.threads.length, 'thread') + ' ' + where() + ' match it' + (archivedIn(f.threads) ? ' (' + fmt(archivedIn(f.threads)) + ' archived)' : '') + '.' + (!over.length ? ''
        : over.length === 1 && over[0] === f.label ? ' The board already gives ' + (f.overlap[over[0]] === f.threads.length ? 'all of them' : f.overlap[over[0]]) + ' the same label.'
        : ' The board gives them ' + over.map(function (l) { return l + ' (' + f.overlap[l] + ')'; }).join(', ') + '. Gmail runs every matching filter, so new mail like this gets both labels.');
    var n = {}; trace().filters.forEach(function (x) { if (x.gid === id) { var b = trace().t.byFilter[x.id]; ['filter', 'early', 'missed'].forEach(function (k) { n[k] = (n[k] || 0) + b[k].length; }); } });
    var html = '<div class="field">Gmail rule<div class="query">' + h(f.query) + '</div></div><p>It ' + h(does || 'does nothing the board can show') + '.</p><p class="note">' + h(seen) + '</p>' + howHtml(howLine(n));
    if (!a) {
      html += f.why ? '<p class="note"><b>Can\'t adopt.</b> ' + h(f.why) + '</p>'
        : '<div class="field"><button class="btn primary" type="button" id="fl-adopt">Adopt this filter</button></div>' +
          '<p class="note">Adopting hands it to Labelboard: you can then change its label, skip-inbox or search here, or delete it, and the next Apply writes that to Gmail. Until you adopt it, Labelboard never touches it.</p>';
    } else {
      var opts = [a.label].concat(S.config.buckets.filter(function (b) { return b.label; }).map(function (b) { return b.label; }))
        .filter(function (l, i, all) { return all.indexOf(l) === i; });
      html += '<label class="field">Label<select id="fl-label">' + opts.map(function (l) { return '<option' + (l === a.label ? ' selected' : '') + '>' + h(l) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Search<input id="fl-query" value="' + h(a.query) + '"></label>' +
        '<label class="field"><span><input type="checkbox" id="fl-archive"' + (a.archive ? ' checked' : '') + '> Skip the inbox</span></label>' +
        '<label class="field"><span><input type="checkbox" id="fl-off"' + (a.off ? ' checked' : '') + '> Delete this filter on the next Apply</span></label>' +
        '<p class="note">' + (f.inGmail && !a.off ? (f.pending ? 'The next Apply hands it to Labelboard, unchanged.' : 'In Gmail as shown.') : 'The next Apply writes this to Gmail.') + ' <button type="button" class="linkish" id="fl-back">Hand it back</button> makes it yours again, untouched.</p>';
    }
    var ts = (f.threads || []).map(function (t) { return S.byId[t]; }).sort(function (x, z) { return z.date.localeCompare(x.date); });
    html += '<ul class="threads">' + ts.slice(0, 40).map(function (t) {
      return '<li><div class="t-subj">' + h(t.subject || '(no subject)') + '</div><div class="t-meta"><span>' + h(t.from) + '</span><span>' +
        h(new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) + '</span></div></li>';
    }).join('') + '</ul>' + (ts.length > 40 ? '<p class="note">Showing the latest 40 of ' + ts.length + '.</p>' : '');
    $('dr-body').innerHTML = html;
    var redo = function (msg) { renderBoard(); save(); openFilter(id); if (msg) toast(msg); };
    if ($('fl-adopt')) $('fl-adopt').onclick = function () {
      S.config.adopted = S.config.adopted || {};
      S.config.adopted[id] = { query: f.query, label: f.label, archive: f.archive };
      redo('Adopted: the next Apply hands it to Labelboard');
    };
    if (a) {
      var upd = function () {
        a.label = $('fl-label').value; a.query = $('fl-query').value.trim() || a.query; a.archive = $('fl-archive').checked; a.off = $('fl-off').checked;
        redo();
      };
      ['fl-label', 'fl-query', 'fl-archive', 'fl-off'].forEach(function (i) { $(i).onchange = upd; });
      $('fl-back').onclick = function () {
        // once applied it is Labelboard's in Gmail: Apply hands that filter back (release) instead of deleting it
        (S.gmail.filters || []).forEach(function (g) {
          if (g.owned && g.query === a.query && g.labels.join(',') === a.label && g.archive === !!a.archive) S.config.release = (S.config.release || []).concat(g.id);
        });
        delete S.config.adopted[id]; renderBoard(); save(); closeDrawer(); toast('Handed back: Labelboard won\'t touch it');
      };
    }
    wireGoto(); showDrawer();
  }
  function openGone(k) {
    var s = (S.gmail.gone || []).filter(function (x) { return LabelboardSync.specKey(x) === k; })[0]; if (!s) return;
    var list = S.config.restoreFilters || [], back = list.indexOf(k) >= 0;
    $('dr-kind').textContent = 'Labelboard\'s filter, ' + (s.why === 'edited' ? 'edited in Gmail' : 'no longer in Gmail');
    $('dr-title').textContent = s.label;
    $('dr-body').innerHTML = '<div class="field">Gmail rule<div class="query">' + h(s.query) + '</div></div>' +
      '<p>' + (s.why === 'edited' ? 'You changed this filter in Gmail, so it is yours now (it shows with your filters) and Labelboard won\'t touch it.'
        : 'This filter was deleted in Gmail, or edited there (Gmail may save an edit as a new filter).') +
      ' Apply leaves the board\'s version out instead of quietly writing it again.</p>' +
      '<div class="field"><button class="btn' + (back ? '' : ' primary') + '" type="button" id="gn-toggle">' + (back ? 'Keep it left out' : 'Restore it on the next Apply') + '</button></div>';
    $('gn-toggle').onclick = function () {
      S.config.restoreFilters = back ? list.filter(function (x) { return x !== k; }) : list.concat(k);
      renderBoard(); save(); openGone(k);
    };
    showDrawer();
  }

  // ---------- drawer: one card ----------
  // Its Gmail filter: whether it makes one, and where that filter stands. Filters are per label, so the status is the label's.
  var NO_FS = {
    column: function (b) { return h(b.name) + ' has no Gmail label, so this card makes no filter: new mail like this lands in your inbox as usual.' + (b.id === 'unsorted' ? ' Move it to a column to make one.' : ''); },
    context: function () { return 'Not made yet: this contact writes about several things, so it makes a filter only once you place it in a column yourself.'; },
    people: function () { return 'Not made yet: until you place this card, only people already known at this company get a filter, and none is known yet.'; },
  };
  var FS_TAG = { live: 'Live in Gmail', new: 'Made on Apply', change: 'Changes on Apply', out: 'Left out' };
  // Where a card's filter stands: state is filterState() over its labels, 'none' (why says why), or 'plan' when Gmail's filters weren't read.
  function cardFs(c) {
    var labels = S.fs && S.fs.byCard[c.key] || [], st = S.fs && S.fs.status, sum = { want: 0, create: 0, remove: 0, skipped: 0 };
    if (!labels.length) return { state: 'none', labels: labels, why: R.noFilterWhy(c, S.config) || 'column' };
    if (st) labels.forEach(function (l) { var s = st.byLabel[l]; if (s) Object.keys(sum).forEach(function (k) { sum[k] += s[k]; }); });
    return { state: st ? LabelboardSync.filterState(sum) : 'plan', labels: labels };
  }
  function refreshMarks() {
    document.querySelectorAll('.board .card[data-key]').forEach(function (el) {
      var c = S.cardByKey[el.dataset.key], m = el.querySelector('.card-fs'); if (!c || !m) return;
      m.outerHTML = cardMarks(c, c.threads.filter(function (id) { return S.yoursBy[id]; }).length);
    });
  }
  function cardFsHtml(c, b, query) {
    var f = cardFs(c), labels = f.labels, note, tag;
    if (f.why === 'hourly') return peopleFsHtml(c);
    if (f.why) { tag = fsTag('none', 'None'); note = NO_FS[f.why](b || { name: 'Its column', id: '' }); }
    else {
      var chips = labels.map(nameChip).join(' '), state = f.state === 'plan' ? null : f.state, skips = b && R.cardDoes(c, S.config, b).base.archive ? ' and skips the inbox' : '';
      tag = state ? fsTag(state, FS_TAG[state]) : '';
      note = state === 'live' ? 'In Gmail: new mail like this gets ' + chips + skips + ' as it arrives.'
        : state === 'new' ? 'Made on the next Apply. Until then, new mail like this arrives without a label.'
        : state === 'change' ? 'The filter for ' + chips + ' changes on the next Apply. Until then Gmail runs the old one.'
        : state === 'out' ? 'Left out: Labelboard\'s filter for ' + chips + ' was deleted or edited in Gmail. Restore it under Gmail filters, at the end of the board.'
        : 'Becomes a Gmail filter for ' + chips + ' when you apply: new mail like this gets the label' + skips + '.';
    }
    var how = b && b.label ? howLine(howOf('col:' + b.id, c.threads)) : '';
    return '<div class="field" id="dr-fs"><span class="fs-head">Gmail filter ' + tag + '</span><div class="query">' + h(query) + '</div><p class="note">' + note + '</p>' +
      (how ? '<p class="note">Its mail so far: ' + h(how) + '. <button type="button" class="linkish" data-goto="gmail">See it day by day</button></p>' : '') + '</div>';
  }
  // A colleague card makes no filter (Gmail can't tell who else is on a thread): Labelboard labels its mail every hour (rules.js peopleRules).
  function peopleFsHtml(c) {
    var g = S.gmail.later || {}, id = 'who:' + c.key, rule = (S.fs && S.fs.later || []).filter(function (r) { return r.id === id; })[0];
    var live = (g.rules || []).filter(function (r) { return r.id === id; })[0], log = (g.log || {})[id], n = log ? log.reduce(function (m, x) { return m + x[1]; }, 0) : 0;
    var same = live && JSON.stringify(live) === JSON.stringify(rule), state = same ? 'live' : live ? 'change' : 'new';
    var what = c.side === 'only' ? 'Labelboard checks your mail every hour and labels the threads with nobody but you and your colleagues on them, and takes the label off one when someone outside joins.'
      : 'Labelboard checks your mail every hour and labels the threads a colleague wrote with someone outside on them.';
    var when = state === 'live' ? (n ? plural(n, 'thread') + ' labelled this way in the last 14 days.' : '') : state === 'change' ? 'What it does changes on the next Apply.' : 'It starts on the next Apply. Until then, new mail like this arrives without a label.';
    return '<div class="field" id="dr-fs"><span class="fs-head">Labelled every hour ' + fsTag(state, { live: 'On', change: 'Changes on Apply', new: 'Starts on Apply' }[state]) + '</span>' +
      '<p class="note">Gmail filters can\'t tell who else is on a thread, so this card makes none. ' + h(what) + ' New mail gets its label within the hour. ' + h(when) + '</p></div>';
  }
  // The drawer's "What happens to its mail": when it leaves the inbox and Gmail's other actions (the column's by default),
  // a condition for the yeses, and an idea from its mail (R.actionHint). Every change makes the card yours, like a sub-label.
  function doesHtml(c, b) {
    if (!b || !b.label) return '';
    var own = (S.config.cards || {})[c.key] || {}, act = own.act || {}, w = R.whenOf(own.when) || { via: '', notMe: false, att: false, subject: [], except: [] }, d = R.cardDoes(c, S.config, b), col = R.colActs(b);
    var yn = function (k, name) {
      var v = act[k] === undefined || act[k] === null ? '' : act[k] ? '1' : '0';
      return '<label class="field">' + name + '<select data-act="' + k + '"><option value=""' + (v === '' ? ' selected' : '') + '>As the column (' + (col[k] ? 'yes' : 'no') + ')</option>' +
        '<option value="1"' + (v === '1' ? ' selected' : '') + '>Yes</option><option value="0"' + (v === '0' ? ' selected' : '') + '>No</option></select></label>';
    };
    var opt = function (v, text, cur) { return '<option value="' + h(v) + '"' + (v === cur ? ' selected' : '') + '>' + h(text) + '</option>'; };
    var aliases = (S.config.aliases || []).map(R.addr).filter(Boolean), rid = laterId(c, b), hint = R.actionHint(c, S.byId, S.config), byLater = S.gmail.later && S.gmail.later.log && S.gmail.later.log[rid];
    var gone = byLater ? byLater.reduce(function (n, x) { return n + x[1]; }, 0) : 0, live = S.gmail.later && (S.gmail.later.rules || []).some(function (r) { return r.id === rid; });
    return '<div class="field does" id="dr-does"><span class="fs-head">What happens to its mail</span>' +
      (hint ? '<p class="note does-hint">' + h(hint.text) + ' <button type="button" class="linkish" id="dr-hint">Do that</button></p>' : '') +
      '<div class="does-grid"><label class="field">Leaves the inbox' + leavesSelect('data-card-leaves', R.cardLeaves(own), R.leavesOf(b)) + '</label>' + yn('read', 'Mark as read') +
      '<label class="field">Important<select data-act="important">' + opt('', 'As Gmail decides', act.important || '') + opt('always', 'Always', act.important || '') + opt('never', 'Never', act.important || '') + '</select></label>' +
      '</div>' +
      '<div class="does-checks"><label><input type="checkbox" data-act="star"' + (act.star ? ' checked' : '') + '> Star it</label>' +
      (c.kind === 'firm' ? '' : '<label class="danger-text"><input type="checkbox" data-act="trash"' + (act.trash ? ' checked' : '') + '> Delete it</label>') + '</div>' +
      '<p class="note does-confirm" id="dr-trash" hidden>New mail like this goes straight to the trash, where Gmail deletes it after 30 days. Mail already in your inbox only leaves it. <button type="button" class="btn danger-fill" id="dr-trash-yes">Delete new mail like this</button> <button type="button" class="btn" id="dr-trash-no">Keep it</button></p>' +
      '<details class="does-when"' + (own.when && R.whenOf(own.when) ? ' open' : '') + '><summary>Only when… <span class="note">' + h(R.whenOf(own.when) ? whenWords(w) : 'always') + '</span></summary>' +
      '<p class="note">The yeses above wait for this; the label and the noes always apply.</p>' +
      (aliases.length ? '<label class="field">It came through<select data-when="via">' + opt('', 'Any address', w.via) + aliases.map(function (a) { return opt(a, a, w.via); }).join('') + '</select></label>' : '') +
      '<label><input type="checkbox" data-when="notMe"' + (w.notMe ? ' checked' : '') + '> It isn\'t sent to you by name (you\'re not in To or Cc)</label>' +
      '<label><input type="checkbox" data-when="att"' + (w.att ? ' checked' : '') + '> It has an attachment</label>' +
      '<label class="field">The subject has any of<input data-when="subject" value="' + h(w.subject.join(', ')) + '" placeholder="report, invoice"></label>' +
      '<label class="field">Except from or about<input data-when="except" value="' + h(w.except.join(', ')) + '" placeholder="ceo@acme.com, urgent"></label>' +
      '</details>' + doesNote(c, b, d, d.later, live, gone) + '</div>';
  }
  // What the settings above do, in numbers: inbox threads on Apply, new mail, the hourly archiving.
  // The hourly rule a card's archiving runs in (rules.js laterRules): its own, or its column's when it follows the column.
  function laterId(c, b) {
    var own = (S.config.cards || {})[c.key];
    return c.kind === 'firm' || R.cardLeaves(own) || R.whenOf(own && own.when) || (c.must && c.must.length) ? c.key : 'col:' + b.id;
  }
  function doesNote(c, b, d, later, live, gone) {
    var inbox = c.threads.filter(function (id) { return inInbox(S.byId[id]); }), ts = inbox.map(function (id) { return S.byId[id]; }), out = [];
    if (d.extra) {
      var hit = ts.filter(function (t) { return R.whenMatches(d.when, t); }).length, old = (d.when.notMe || d.when.att) ? ts.filter(function (t) { return t.dir === undefined || t.att === undefined; }).length : 0;
      out.push(fmt(hit) + ' of its ' + plural(ts.length, 'inbox thread') + ' match the condition.' + (old ? ' ' + plural(old, 'thread') + ' were read before Labelboard noted who they were sent to and attachments, so ' + (old === 1 ? 'it counts' : 'they count') + ' as not matching; Gmail checks new mail itself.' : ''));
    }
    var n = mailOf(c.threads, b);
    if (n.leave || n.read) out.push('On Apply: ' + [n.leave && plural(n.leave, 'thread') + ' leave' + (n.leave === 1 ? 's' : '') + ' the inbox', n.read && fmt(n.read) + ' marked read'].filter(Boolean).join(', ') + '.');
    if (d.base.star || d.base.trash || d.base.important || d.extra && (d.extra.star || d.extra.trash || d.extra.important)) out.push('Starring, importance and deleting are for new mail; mail already here keeps its stars' + (d.base.trash || d.extra && d.extra.trash ? ' and only leaves the inbox' : '') + '.');
    var nf = R.noFilterWhy(c, S.config);
    if (later && nf && nf !== 'hourly') out.push('Archiving later waits until this card makes a Gmail filter (see below), so it never archives mail it doesn\'t label.');
    else if (later) out.push((live ?'Archiving later is on: Labelboard checks every hour.' : 'Archiving later starts when you apply; Labelboard then checks every hour.') + (gone ? ' It archived ' + plural(gone, 'thread') + ' in the last 14 days.' : ''));
    return out.length ? '<p class="note does-sum">' + out.map(h).join(' ') + '</p>' : '';
  }
  // A change to a card's own settings (its drawer, the Gmail tab): your edit makes it yours, like a move. The caller redraws.
  function cardEdit(key, fn) {
    var p = R.placement(S.cardByKey[key], S.config), cur = S.config.cards[key] || { bucket: p.bucket };
    cur.bucket = cur.bucket || p.bucket; delete cur.by; delete cur.why;
    fn(cur);
    ['act', 'when', 'later'].forEach(function (k) { if (cur[k] && !Object.keys(cur[k]).length) delete cur[k]; });
    if (cur.when && !R.whenOf(cur.when)) delete cur.when;
    S.config.cards[key] = cur;
  }
  function wireDoes(key, c, b) {
    if (!$('dr-does')) return;
    var edit = function (fn) {
      cardEdit(key, fn);
      var top = $('dr-body').scrollTop; renderRack(); renderBoard(); placed(); openCard(key); $('dr-body').scrollTop = top;
    };
    var setAct = function (k, v) { edit(function (cur) { cur.act = cur.act || {}; if (v === undefined) delete cur.act[k]; else cur.act[k] = v; }); };
    $('dr-does').querySelectorAll('select[data-act]').forEach(function (el) {
      el.onchange = function () { var k = el.dataset.act, v = el.value; setAct(k, v === '' ? undefined : k === 'important' ? v : v === '1'); toast('Saved: ' + (doesWords(c, b) || 'as the column')); };
    });
    $('dr-does').querySelector('[data-act="star"]').onchange = function () { setAct('star', this.checked || undefined); };
    var trash = $('dr-does').querySelector('[data-act="trash"]');
    if (trash) trash.onchange = function () {
      if (!this.checked) return setAct('trash', undefined);
      this.checked = false; $('dr-trash').hidden = false; $('dr-trash-yes').focus(); // asks first
    };
    $('dr-trash-yes').onclick = function () { setAct('trash', true); toast('New mail like this goes to the trash once you apply'); };
    $('dr-trash-no').onclick = function () { $('dr-trash').hidden = true; };
    $('dr-does').querySelector('[data-card-leaves]').onchange = function () {
      var v = this.value;
      edit(function (cur) { R.setCardLeaves(cur, v); });
      toast('Saved: ' + (v ? leavesWords(v).toLowerCase() : 'as the column'));
    };
    var list = function (s) { return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    $('dr-does').querySelectorAll('[data-when]').forEach(function (el) {
      el.onchange = function () {
        var k = el.dataset.when, v = el.type === 'checkbox' ? el.checked : k === 'subject' || k === 'except' ? list(el.value) : el.value;
        edit(function (cur) { cur.when = Object.assign({}, cur.when || {}); if (!v || v.length === 0) delete cur.when[k]; else cur.when[k] = v; });
      };
    });
    if ($('dr-hint')) $('dr-hint').onclick = function () {
      var hint = R.actionHint(c, S.byId, S.config);
      edit(function (cur) { ['act', 'when', 'later'].forEach(function (k) { if (hint[k]) cur[k] = Object.assign({}, cur[k] || {}, hint[k]); }); });
      toast('Saved: ' + doesWords(c, b));
    };
  }
  function openCard(key) {
    var c = S.cardByKey[key], p = R.placement(c, S.config), b = bucket(p.bucket);
    $('dr-kind').textContent = KIND[c.kind] + (c.subtitle && c.subtitle !== c.title ? ': ' + c.subtitle : '');
    $('dr-title').textContent = c.title;
    var opts = S.config.buckets.map(function (x) { return '<option value="' + h(x.id) + '"' + (x.id === p.bucket ? ' selected' : '') + '>' + h(x.name) + '</option>'; }).join('');
    var query = c.terms.map(R.termQuery).join(' OR ');
    var threads = c.threads.map(function (id) { return S.byId[id]; }).sort(function (a, z) { return z.date.localeCompare(a.date); });
    var mail = mailOf(c.threads, b), by = S.st.apply.byThread;
    $('dr-body').innerHTML =
      '<label class="field">Column<select id="dr-bucket">' + opts + '</select></label>' +
      (b && b.subLabels ? '<label class="field">Sub-label (optional)<input id="dr-sub" value="' + h(p.sublabel || '') + '" placeholder="e.g. Acme or Clients/Acme"></label>' : '') +
      '<p class="note">' + whoChip(p.lost ? 'none' : p.who) + h(p.lost ? 'Its column is gone, so it waits in Unsorted.' : p.who === 'you' ? 'You placed this card.' : p.decided ? 'Claude placed this card' + (p.why ? ': ' + p.why.replace(/\.$/, '') : '') + '.' : c.suggestion.reason + '.') +
      (p.who === 'claude' && p.decided ? ' <button type="button" class="linkish" data-claude="keep">Keep it here</button> · <button type="button" class="linkish" data-claude="drop">Back to the suggestion</button>' : '') +
      (c.also ? ' Another ' + c.also + ' threads match this rule too but sit under a different card.' : '') + '</p>' +
      (mail.change ? '<p class="note mail-note wait">' + TAG + '<span>' + h(mailTip(mail)) + '</span></p>' : mail.sorted ? '<p class="note mail-note">' + TAG + '<span>' + h(sortedTip(mail, b)) + '</span></p>' : '') +
      doesHtml(c, b) + cardFsHtml(c, b, query) +
      '<p><a href="' + gmailSearch(query) + '" target="_blank" rel="noopener">See these in Gmail</a></p>' +
      '<ul class="threads">' + threads.slice(0, 60).map(function (t) {
        var labels = t.labels.filter(function (l) { return !/^(INBOX|UNREAD|IMPORTANT|STARRED|SENT|CATEGORY_)/.test(l); });
        var m = R.threadMove(t.id, S.built, S.config, S.cardByKey), v = (S.config.threadVotes || {})[t.id];
        if (m && m.bucket === p.bucket) m = null; // kept with the card on purpose: nothing to flag
        var goes = m ? m.bucket : p.bucket;
        // archived mail keeps its labels (backfill is the inbox only): nothing to move, only the card's rule for new mail
        var pick = !inInbox(t) ? '<span class="t-out" title="Out of your inbox. Apply leaves it as it is; mail like it that arrives later follows this card.">Archived</span>' : '<select class="t-move" data-thread="' + h(t.id) + '" aria-label="Where this thread goes">' + S.config.buckets.map(function (x) {
          return '<option value="' + h(x.id) + '"' + (x.id === goes ? ' selected' : '') + '>' + h(x.name) + '</option>'; }).join('') + '</select>';
        var note = m ? '<div class="t-moved">' + (m.by === 'ai' ? 'Claude moved it here' + (v && v.w ? ': ' + h(v.w) : '') : 'You moved it here') +
          ' <button type="button" class="linkish" data-unmove="' + h(t.id) + '">' + (m.by === 'ai' ? 'Keep it with this card' : 'Undo') + '</button></div>' : '';
        // Gmail now (its labels) against what Apply does to it
        var ch = by[t.id], sync = ch ? '<div class="t-sync wait">' + TAG + '<span>On Apply: ' + [ch.add.length && 'gets ' + ch.add.map(nameChip).join(' '), ch.leaves && 'leaves the inbox', ch.read && 'marked read',
          ch.off.length && 'loses ' + ch.off.map(nameChip).join(' ')].filter(Boolean).join(', ') + '</span></div>'
          : inInbox(t) && b && b.label && t.labels.indexOf(b.label) >= 0 ? '<div class="t-sync">' + TAG + '<span>Sorted in Gmail</span></div>' : '';
        return '<li' + (m ? ' class="moved"' : '') + '><div class="t-row"><div class="t-subj">' + h(t.subject || '(no subject)') + '</div>' + pick + '</div>' + note + sync +
          '<div class="t-meta"><span>' + h(t.from) + '</span><span>' +
          h(new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) + '</span>' +
          (t.count > 1 ? '<span>' + t.count + ' messages</span>' : '') + (labels.length ? '<span>In Gmail: ' + h(labels.join(', ')) + '</span>' : '') +
          '</div><div class="t-snip">' + h(t.snippet) + '</div></li>';
      }).join('') + '</ul>' + (threads.length > 60 ? '<p class="note">Showing the latest 60 of ' + threads.length + '.</p>' : '');
    $('dr-bucket').onchange = function () {
      moveCard(key, this.value, null); renderBoard(); openCard(key);
    };
    // one thread at a time: only mail already in the inbox, future mail still follows the card's rule
    var setMove = function (id, o) {
      S.config.threadOverrides = S.config.threadOverrides || {};
      if (o) S.config.threadOverrides[id] = o; else delete S.config.threadOverrides[id];
      var top = $('dr-body').scrollTop; renderRack(); renderBoard(); save(); openCard(key); $('dr-body').scrollTop = top;
    };
    Array.prototype.forEach.call($('dr-body').querySelectorAll('.t-move'), function (sel) {
      sel.onchange = function () { setMove(this.dataset.thread, { bucket: this.value }); toast('Thread moved'); };
    });
    Array.prototype.forEach.call($('dr-body').querySelectorAll('[data-claude]'), function (btn) {
      btn.onclick = function () {
        if (this.dataset.claude === 'keep') { place(key, p.bucket); toast(c.title + ' is yours now'); }
        else { delete S.config.cards[key]; toast(c.title + ' follows the suggestion again'); }
        renderBoard(); placed(); openCard(key);
      };
    });
    Array.prototype.forEach.call($('dr-body').querySelectorAll('[data-unmove]'), function (btn) {
      btn.onclick = function () {
        var id = this.dataset.unmove, mine = (S.config.threadOverrides || {})[id];
        setMove(id, mine ? null : { bucket: p.bucket, sublabel: p.sublabel }); // undo yours, or overrule the AI
      };
    });
    if ($('dr-sub')) $('dr-sub').onchange = function () {
      var cur = S.config.cards[key] || { bucket: p.bucket };
      cur.bucket = cur.bucket || p.bucket; cur.sublabel = this.value.trim() || null; delete cur.by; delete cur.why; // your edit makes it yours
      S.config.cards[key] = cur; renderBoard(); save(); toast('Sub-label saved');
      $('dr-fs').outerHTML = cardFsHtml(c, b, query); wireGoto(); // a new sub-label is a new filter
    };
    wireDoes(key, c, b); wireGoto(); showDrawer();
  }
  function gmailSearch(q) {
    return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(S.snapshot.account) + '#search/' + encodeURIComponent(q);
  }

  function showDrawer() { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('dr-close').focus(); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); }

  // ---------- the apply record and undo (server: Code.js applyUndo; pure parts: Sync.js planUndo) ----------
  // S.record = { applies: [entries, oldest first], undo: progress of an undo that stopped, undone: {at, kind, summary} }
  var SY = LabelboardSync;
  function lastApply() { var a = S.record.applies; return a.length ? a[a.length - 1] : null; }
  function ago(ms) { return R.readAge(new Date(ms).toISOString(), Date.now()).text; }
  // "363 threads lose …; 120 go back": the labelled and the archived of an Apply, which needn't overlap (`had`).
  function twoCounts(a, aText, b, bText) { return [a && plural(a, 'thread') + ' ' + aText(a === 1), b && fmt(b) + (a ? '' : b === 1 ? ' thread' : ' threads') + ' ' + bText(b === 1)].filter(Boolean).join(a ? '; ' : ''); }
  // The last Apply in numbers: filters it made, threads it changed, and the plain-word lines Review shows.
  function applyLines(e) {
    var c = SY.undoCounts(SY.planUndo([e]));
    return { filters: e.filtersCreated.length, threads: c.threads, lines: [
      [e.labelsCreated.length && plural(e.labelsCreated.length, 'label') + ' created', e.filtersCreated.length && plural(e.filtersCreated.length, 'filter') + ' made',
        e.filtersRemoved.length && plural(e.filtersRemoved.length, 'old filter') + ' removed'].filter(Boolean).join(', '),
      twoCounts(c.unlabel, function () { return 'labelled'; }, c.inbox, function () { return 'left the inbox'; }),
      c.relabel && plural(c.relabel, 'thread') + ' lost a label Labelboard gave ' + (c.relabel === 1 ? 'it' : 'them') + ' before',
      !e.done && 'It stopped before it finished; applying again finishes it.'].filter(Boolean) };
  }
  // In the header next to the read: the last Apply, an undo, or an undo that stopped. Each opens Review.
  function appliedHtml() {
    var rec = S.record, e = lastApply();
    if (rec.undo) return '<button type="button" class="meta-link stale" data-review title="Open Review changes to finish undoing">' + (rec.undo.kind === 'all' ? 'removing everything stopped' : 'undo stopped') + '</button>';
    if (rec.undone) return '<button type="button" class="meta-link" data-review title="' + h(rec.undone.summary) + '">' + (rec.undone.kind === 'all' ? 'removed everything ' : 'undone ') + h(ago(rec.undone.at)) + '</button>';
    if (!e) return '';
    var a = applyLines(e), n = [a.filters && plural(a.filters, 'filter'), a.threads && plural(a.threads, 'thread')].filter(Boolean).join(', ');
    return '<button type="button" class="meta-link" data-review title="' + h('Applied ' + (e.auto ? 'on its own ' : '') + new Date(e.at).toLocaleString('en-US') + ': ' + a.lines.join('; ') + '. Open Review changes to see it or undo it.') + '">applied ' + (e.auto ? 'on its own ' : '') + h(ago(e.at)) + (n ? ': ' + n : '') + '</button>';
  }
  // The top of Review: an undo to finish, what the last Apply did with its Undo, or what the undo did.
  function recordHtml() {
    var rec = S.record, e = lastApply(), can = S.canUndo;
    if (rec.undo) {
      var u = rec.undo, all = u.kind === 'all', where = u.phase === 'filters' ? ' while taking Labelboard\'s filters out of Gmail' : u.phase === 'threads'
        ? ' at ' + fmt(u.op) + ' of ' + fmt(SY.undoOps(SY.planUndo(rec.applies.slice(rec.applies.length - u.n).reverse(), all), u.since).length) + ' threads' : u.phase === 'labels' ? ' while deleting labels' : '';
      return '<div class="warn"><p><b>' + (all ? 'Removing everything' : 'Undo') + ' stopped' + where + '.</b> What it did so far stays done; nothing else changed. Apply waits until it finishes.</p>' +
        (can ? '<button class="btn primary" type="button" data-undo="' + u.kind + '" data-go="1">' + (all ? 'Finish removing' : 'Finish undoing') + '</button>' : '') + '</div>';
    }
    if (rec.undone) return '<div class="last"><div class="last-h"><b>' + (rec.undone.kind === 'all' ? 'Removed everything Labelboard made, ' : 'Last Apply undone, ') + h(ago(rec.undone.at)) + '</b></div><p class="note">' + h(rec.undone.summary.replace(/^[^:]*: /, '')) + '.</p></div>'; // the heading already says what it was
    if (!e) return '';
    return '<div class="last"><div class="last-h"><b>Your last Apply, ' + h(ago(e.at)) + '</b>' + (can ? '<button class="btn danger" type="button" data-undo="last">Undo this Apply…</button>' : '') +
      '</div><ul>' + applyLines(e).lines.map(function (l) { return '<li>' + h(l) + '</li>'; }).join('') + '</ul></div>';
  }
  // Filters you handed over before Labelboard marked adopted ones: Remove everything gives these back too, never deletes them.
  function adoptedIds() {
    var a = S.config.adopted || {}, specs = Object.keys(a).map(function (k) { return a[k]; });
    return (S.gmail.filters || []).filter(function (f) {
      return f.owned && (a[f.id] || specs.some(function (s) { return s.query === f.query && s.label === f.labels.join(',') && !!s.archive === f.archive; }));
    }).map(function (f) { return f.id; });
  }
  // The confirm, in Review's sheet: what goes back and what stays, in numbers (docs/BRAND.md rule 5).
  function openUndo(kind) {
    var all = kind === 'all', rec = S.record, e = lastApply(), entries = all ? rec.applies.slice().reverse() : [e];
    if (rec.undo || !all && (!e || rec.undone)) return openReview(); // a stopped undo finishes first; Undo is the last Apply, once
    var plan = SY.planUndo(entries, all), c = SY.undoCounts(plan), since = SY.sinceMail(S.mail.threads, plan).length, li = function (s) { return s ? '<li>' + s + '</li>' : ''; };
    var keep = all ? adoptedIds() : [], gf = S.gmail.filters || [], owned = gf.filter(function (f) { return f.owned; });
    var back = all ? owned.filter(function (f) { return f.adopted || keep.indexOf(f.id) >= 0; }).length : plan.filters.handBack.length;
    var ownedLabels = (S.gmail.ownedLabels || []), labels = all ? ownedLabels.length : plan.labels.length, left = all ? SY.unrecorded(S.mail.threads, ownedLabels, entries) : null;
    var nothing = all && !owned.length && !labels && !c.threads;
    var threads = twoCounts(c.unlabel, function (one) { return (one ? 'loses the label ' : 'lose the labels ') + (all ? 'Labelboard' : 'it') + ' gave ' + (one ? 'it' : 'them'); },
      c.inbox, function (one) { return (one ? 'goes' : 'go') + ' back to your inbox'; });
    $('rv-title').textContent = all ? 'Remove everything Labelboard made?' : 'Undo the Apply from ' + ago(e.at) + '?';
    $('rv-body').innerHTML = nothing ? '<p>Labelboard hasn\'t made anything in Gmail yet.</p><div class="plan-actions"><button class="btn" type="button" id="un-keep">Back</button></div>' :
      '<h3 class="rv-h">What goes back</h3><ul class="rv-list">' +
      li(all ? (owned.length - back ? plural(owned.length - back, 'filter') + ' Labelboard made ' + (owned.length - back === 1 ? 'is' : 'are') + ' deleted.' : '')
        : plan.filters.remove.length ? 'The ' + plural(plan.filters.remove.length, 'filter') + ' it made ' + (plan.filters.remove.length === 1 ? 'is' : 'are') + ' deleted' + (plan.filters.restore.length ? '; the ' + fmt(plan.filters.restore.length) + ' it removed ' + (plan.filters.restore.length === 1 ? 'is' : 'are') + ' made again' : '') + '.' : '') +
      li(back ? plural(back, 'filter') + ' you adopted ' + (back === 1 ? 'goes' : 'go') + ' back to you, unchanged.' : '') +
      li(threads && threads + '.') + li(c.relabel ? plural(c.relabel, 'thread') + ' get' + (c.relabel === 1 ? 's' : '') + ' back a label ' + (all ? 'an Apply' : 'it') + ' took off.' : '') +
      li(since ? 'About ' + plural(since, 'thread') + ' a filter kept out of your inbox since ' + (since === 1 ? 'comes' : 'come') + ' back to it, with ' + (since === 1 ? 'its' : 'their') + ' label.' : '') +
      li(labels ? (all ? 'Its ' : 'The ') + plural(labels, 'label') + ' ' + (all ? 'Labelboard' : 'it') + ' created ' + (labels === 1 ? 'is' : 'are') + ' deleted once ' + (labels === 1 ? 'it is' : 'they are') + ' empty.' : '') +
      '</ul><h3 class="rv-h">What stays</h3><ul class="rv-list">' +
      li(left && left.threads ? plural(left.threads, 'thread') + ' with Labelboard\'s labels that no recorded Apply gave ' + (left.threads === 1 ? 'it' : 'them') + ' (labelled by hand, by its filters, or by an Apply from before Labelboard kept a record) keep' + (left.threads === 1 ? 's it' : ' them') +
        ', so ' + (left.labels.length === 1 ? 'this label stays' : 'these labels stay') + ': ' + left.labels.map(nameChip).join(' ') + '.' : '') +
      li('Labels and filters you made yourself' + (plan.handBack.length || plan.moves.some(function (m) { return !m.owned; }) || all && (S.gmail.adoptedLabels || []).length ? ' (ones you handed over come back to you)' : '') + '. No mail is deleted or sent.') +
      li(all ? 'Your board and settings, so you can apply again later.' : 'Your board: Review changes then offers this Apply again.') + '</ul>' +
      '<div class="plan-actions"><button class="btn danger-fill" type="button" data-undo="' + kind + '" data-go="1">' + (all ? 'Remove everything' : 'Undo this Apply') + '</button><button class="btn" type="button" id="un-keep">Keep it</button></div>';
    $('un-keep').onclick = function () { openReview(); };
    $('review').hidden = false; $('rv-close').focus();
  }
  // Runs in slices like Apply, then reads again so the board shows what Gmail has. A stopped one resumes from the record.
  function runUndo(kind) {
    if (reading()) return;
    closeReview();
    API.undo(kind, kind === 'all' ? adoptedIds() : [], showProgress).then(function (res) {
      var done = res && res.summary || 'Undone';
      toast(done + '. Reading your inbox again…', 60000);
      return refresh(null, done);
    }).catch(function (e) {
      hideProgress();
      return load().then(function () { oops(e, (kind === 'all' ? 'Removing everything' : 'Undo') + ' stopped before it finished. ' + (said(e) || 'What it did so far stays done; nothing else changed.') + ' Open Review changes to finish it.', 12000); });
    });
  }

  // ---------- review ----------
  // What Apply sends: the plan, plus filter hand-overs (adopt), hand-backs (release) and restores.
  // The backfill keeps only what Gmail doesn't have yet: a thread that has the label and stays in the inbox is left alone.
  // `had`: threads of a skip-inbox label that already carry it (they only leave the inbox), so an undo leaves their label on.
  // Labels (labels.js housekeeping): colours fixed on labels already in Gmail, labels moved (left over, or yours folded in),
  // labels of yours taken as they are; filters of yours that go with a fold are adopted first (GMAIL.syncFilters).
  function applyPlan() {
    var ls = labelState();
    if (ls && GMAIL.syncFilters(ls.rows)) { save(); ls = labelState(); }
    var plan = ls ? ls.plan : R.buildPlan(S.snapshot, S.built, S.config, S.seeds, S.gmail);
    S.house = ls; // for Review's words
    if (ls) {
      plan.labels = plan.labels.concat(ls.hk.create);
      plan.recolor = ls.hk.recolor; plan.moves = ls.hk.moves; plan.adoptLabels = ls.hk.adoptLabels; plan.handover = ls.hk.handover;
    }
    plan.backfill = R.trimBackfill(plan.backfill, S.byId);
    plan.adopt = adoptIds();
    plan.release = S.config.release || [];
    plan.restore = S.config.restoreFilters || [];
    plan.settings = R.settingsKey(S.config); // applying on its own waits until the settings are the ones applied
    return plan;
  }
  // What Apply does to labels beyond the board's own, in Review's words (S.house: labelState, set by applyPlan).
  function houseLines() {
    var ls = S.house; if (!ls) return { lines: [], moves: 0, handed: 0 };
    var hk = ls.hk, by = {}, out = [], folds = {}, left = [], tidy = 0, paint = hk.recolor.length + hk.repaint, many = function (n, one, more) { return n === 1 ? one : more; };
    ls.rows.forEach(function (r) { by[r.name] = r; });
    hk.moves.forEach(function (m) {
      var r = by[m.from]; if (!r) return;
      if (r.kind === 'yours') (folds[r.hand.top] = folds[r.hand.top] || []).push(m); else if (m.to) left.push(m); else tidy++;
    });
    if (paint) out.push(plural(paint, 'label') + ' get' + many(paint, 's', '') + ' ' + many(paint, 'its', 'their') + ' column\'s colour: the column\'s own label its colour, sub-labels and folders a lighter shade.');
    Object.keys(folds).forEach(function (top) {
      var n = folds[top].length;
      out.push('Your label <b>' + h(top) + '</b>' + (n > 1 ? ' and ' + plural(n - 1, 'label') + ' under it merge' : ' merges') + ' into ' + h(by[top].hand.into) + ': the mail moves, inbox and archived, then the old ' + many(n, 'label is', 'labels are') + ' deleted.');
    });
    if (hk.adoptLabels.length) out.push(plural(hk.adoptLabels.length, 'label') + ' of yours become' + many(hk.adoptLabels.length, 's', '') + ' the board\'s, as ' + many(hk.adoptLabels.length, 'it is', 'they are') + ': ' + hk.adoptLabels.slice(0, 4).map(h).join(', ') + (hk.adoptLabels.length > 4 ? '…' : '') + '.');
    if (left.length) out.push(plural(left.length, 'label') + ' Labelboard made for an earlier layout: the mail moves to where each card is now (' + left.slice(0, 2).map(function (m) { return h(m.from) + ' → ' + h(m.to); }).join(', ') + (left.length > 2 ? ', …' : '') + '), then ' + many(left.length, 'it is', 'they are') + ' deleted.');
    if (tidy) out.push(plural(tidy, 'more left-over label') + ' ' + many(tidy, 'is', 'are') + ' deleted if no mail has ' + many(tidy, 'it', 'them') + '.');
    if (hk.blocked.length) out.push('<span class="lb-block">' + plural(hk.blocked.length, 'label') + ' of yours stay' + many(hk.blocked.length, 's', '') + ' where ' + many(hk.blocked.length, 'it is', 'they are') + ': a filter of yours adds ' + many(hk.blocked.length, 'it', 'them') + ' and Labelboard can\'t take it over.</span>');
    return { lines: out, moves: hk.moves.length, handed: hk.handover.length };
  }
  // Review in plain words: what Apply changes and what it leaves alone. Filter numbers come from the same
  // LabelboardSync.filterActions the server runs, against your filters as read on load.
  function changesHtml(plan, st) {
    var g = S.gmail, li = function (s) { return s ? '<li>' + s + '</li>' : ''; }, add = {}, leave = {}, off = {}, read = {};
    plan.backfill.forEach(function (e) {
      e.threadIds.forEach(function (t) { if (S.byId[t].labels.indexOf(e.label) < 0) add[t] = 1; if (e.archive) leave[t] = 1; });
      (e.unread || []).forEach(function (t) { read[t] = 1; });
    });
    (plan.unlabel || []).forEach(function (e) { e.threadIds.forEach(function (t) { off[t] = 1; }); });
    var nAdd = Object.keys(add).length, nLeave = Object.keys(leave).length, nRead = Object.keys(read).length, nOff = Object.keys(off).length, done = st.apply.sorted;
    var arch = function (r) { return r.kind !== 'people'; }, later = (plan.later || []).filter(arch), laterWas = g.later ? g.later.rules.filter(arch).length : 0;
    var who = (plan.later || []).filter(function (r) { return !arch(r); });
    var moved = function (list, keep) { return JSON.stringify(list) !== JSON.stringify(g.later ? g.later.rules.filter(keep) : []); };
    var laterNew = moved(later, arch), whoNew = moved(who, function (r) { return !arch(r); });
    var filters = plural(plan.filters.length, 'filter') + ' for new mail';
    if (g.filters) {
      var fa = LabelboardSync.filterStatus(plan.filters, g.filters, g.gone, plan.adopt, plan.release, plan.restore).actions;
      var kept = plan.filters.length - fa.create.length - fa.skipped.length;
      filters += ': ' + [fa.create.length && fmt(fa.create.length) + ' new', kept && fmt(kept) + ' already in Gmail', fa.remove.length && fmt(fa.remove.length) + ' of Labelboard\'s removed']
        .filter(Boolean).join(', ') + (fa.skipped.length ? '. ' + plural(fa.skipped.length, 'filter') + ' you deleted in Gmail stay' + (fa.skipped.length === 1 ? 's' : '') + ' out' : '');
    }
    var newLabels = g.labels ? plan.labels.filter(function (l) { return g.labels.indexOf(l.name) < 0; }).length : null;
    var yours = (g.filters || []).filter(function (f) { return !f.owned && plan.adopt.indexOf(f.id) < 0; }).length, house = houseLines();
    return '<p class="rv-lead">Apply makes the Gmail filters, so new mail sorts itself from then on, and labels the mail in your inbox now.</p>' +
      '<h3 class="rv-h">What changes</h3><ul class="rv-list">' +
      li(plural(plan.labels.length, 'label') + (newLabels != null ? ' (' + fmt(newLabels) + ' new, the rest already in Gmail)' : '') + '.') +
      li(h(filters) + '.') +
      li(plan.adopt.length ? plural(plan.adopt.length, 'filter') + ' of yours handed over to Labelboard.' : '') +
      li(plan.release.length ? plural(plan.release.length, 'filter') + ' handed back to you.' : '') +
      li('Your inbox: ' + (nAdd || nLeave || nRead ? [nAdd && plural(nAdd, 'thread') + ' get labels', nLeave && fmt(nLeave) + (nAdd ? '' : ' threads') + ' leave the inbox', nRead && fmt(nRead) + (nAdd || nLeave ? '' : ' threads') + ' are marked read'].filter(Boolean).join(', ') : 'no thread needs a label') +
        '. It goes from <b>' + fmt(st.before.inbox) + '</b> to <b>' + fmt(st.after.inbox) + '</b>.') +
      li(laterNew ? (later.length ? 'Mail leaves the inbox later for ' + plural(later.length, 'column or card', 'columns and cards') + ': Labelboard checks your inbox every hour and archives what is due (' + h(later.map(function (r) { return r.title; }).slice(0, 4).join(', ') + (later.length > 4 ? '…' : '')) + ').' : 'Archiving later stops' + (laterWas ? ' for the ' + plural(laterWas, 'card') + ' that had it' : '') + '.') : '') +
      li(whoNew ? (who.length ? 'New mail with ' + who.map(function (r) { return (r.side === 'only' ? 'only your colleagues on it' : 'a colleague and someone outside on it') + ' gets ' + h(r.labels[0]); }).join('; with ') +
        ' within the hour: Gmail filters can\'t tell who else is on a thread, so Labelboard checks every hour.' : 'Labelboard stops labelling colleague mail every hour.') : '') +
      li(nOff ? plural(nOff, 'thread') + ' lose a label Labelboard gave them before (' + h(plan.unlabel.map(function (e) { return e.label; }).join(', ')) + '): their card moved.' : '') +
      house.lines.map(li).join('') + (house.lines.length ? '<li><button type="button" class="linkish" id="rv-labels">See every label on the Gmail tab</button></li>' : '') +
      '</ul><h3 class="rv-h">What doesn\'t change</h3><ul class="rv-list">' +
      li(done ? plural(done, 'inbox thread') + ' already ' + (done === 1 ? 'has its' : 'have their') + ' labels in Gmail: Apply leaves ' + (done === 1 ? 'it' : 'them') + ' as ' + (done === 1 ? 'it is' : 'they are') + '.' : '') +
      li('Mail outside your inbox (archived, sent) keeps the labels it has' + (house.moves ? ', apart from the labels that move above' : '') + '. Re-sorting only touches the inbox threads in this read.') +
      li(g.filters ? (yours ? 'Your own ' + plural(yours, 'filter') : 'Filters you make later') + ': Labelboard never edits or deletes them' + (house.handed ? ', unless one goes with a label you handed over' : '') + '.' : 'Filters you made yourself: never edited or deleted.') +
      li('Labels you made yourself stay as they are' + (house.handed ? ', apart from the ones you handed over above' : '') + '. Merge or hand one over on the Gmail tab.') +
      li('No mail is deleted or sent, and Labelboard never opens message bodies.') + '</ul>';
  }
  // A filter's actions in words, and a label's (all its filters): "Label and skip inbox", "Label; some filters also star".
  function filterWords(f) {
    return [f.archive && 'skip inbox', f.read && 'mark read', f.star && 'star', f.important === 'always' && 'mark important', f.important === 'never' && 'never important', f.trash && 'delete'].filter(Boolean);
  }
  function actionText(lists) {
    var n = {}; lists.forEach(function (l) { l.forEach(function (w) { n[w] = (n[w] || 0) + 1; }); });
    var every = Object.keys(n).filter(function (w) { return n[w] === lists.length; }), some = Object.keys(n).filter(function (w) { return n[w] < lists.length; });
    return 'Label' + (every.length ? ' and ' + every.join(', ') : some.length ? '' : ' only') + (some.length ? '; some filters ' + some.join(', ') : '');
  }
  function openReview() {
    var plan = applyPlan(), st = S.st, age = R.readAge(S.snapshot.generatedAt, Date.now());
    var byLabel = {}, has = {}; // has: inbox threads with the label in Gmail now
    S.snapshot.threads.forEach(function (t) { if (inInbox(t)) t.labels.forEach(function (l) { has[l] = (has[l] || 0) + 1; }); });
    plan.filters.forEach(function (f) { var x = byLabel[f.label] = byLabel[f.label] || { filters: 0, bucket: f.bucket, does: [] }; x.filters++; x.does.push(filterWords(f)); });
    var bf = {}; plan.backfill.forEach(function (x) { bf[x.label] = { threadIds: (bf[x.label] ? bf[x.label].threadIds : []).concat(x.threadIds) }; });
    var firstQuery = {}; plan.filters.forEach(function (f) { if (!firstQuery[f.label]) firstQuery[f.label] = f.query; });
    var rows = plan.labels.map(function (l) {
      // a label with no filter (an AI-found deal, old mail only) still names its column by prefix
      var info = byLabel[l.name] || {}, b = bucket(info.bucket) || S.config.buckets.filter(function (x) { return x.label && (l.name === x.label || l.name.indexOf(x.label + '/') === 0); })[0];
      if (!b) return '';
      var sub = l.name.indexOf(b.label + '/') === 0 ? l.name.slice(b.label.length + 1) : null;
      var n = bf[l.name] ? bf[l.name].threadIds.filter(function (id) { return S.byId[id].labels.indexOf(l.name) < 0; }).length : 0;
      return '<tr><td>' + labelChip(b, sub) + '</td><td class="n">' + (info.filters || 0) + '</td><td class="n">' + fmt(has[l.name] || 0) + '</td><td class="n">' + fmt(n) + '</td><td>' +
        actionText(info.does || []) + '</td><td>' + (firstQuery[l.name] ? '<a target="_blank" rel="noopener" href="' + gmailSearch('in:inbox ' + firstQuery[l.name]) + '">Open in Gmail</a>' : '') + '</td></tr>';
    }).join('');
    var applyOk = S.mode === 'apps-script' && !S.record.undo, stale = age.stale && S.snapshot.threads.length; // an undo that stopped finishes first
    $('rv-title').textContent = 'Review changes';
    $('rv-body').innerHTML = recordHtml() +
      (stale ? '<div class="warn"><p><b>Your inbox was read ' + h(age.text) + '.</b> Apply sorts only the threads that read saw: mail that came in since keeps its place (new filters still catch what arrives after Apply).</p>' +
        (API.refresh ? '<button class="btn" type="button" id="rv-reread">Read the inbox again first</button>' : '') + '</div>' : '') +
      changesHtml(plan, st) +
      '<details class="rv-detail"><summary>Label by label</summary><table class="plan-table"><thead><tr><th>Label</th><th>Filters</th><th title="Inbox threads with this label in Gmail now">Has it</th><th title="Inbox threads Apply gives it to">Gets it</th><th>Action</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></details>' +
      '<div class="plan-actions">' +
      '<button class="btn primary" type="button" id="rv-apply"' + (applyOk ? '' : ' disabled') + '>' + (stale ? 'Apply labels and filters anyway' : 'Apply labels and filters') + '</button>' +
      '<button class="btn" type="button" id="rv-xml">Download filters for Gmail import</button></div>' +
      (applyOk ? '' : S.record.undo ? '<p class="note">Apply waits until the undo above finishes.</p>'
        : '<p class="note">Apply works once Labelboard runs as your Apps Script. Until then, download the filters and import them in Gmail: Settings, Filters and blocked addresses, Import filters.</p>');
    if ($('rv-reread')) $('rv-reread').onclick = function () { closeReview(); refresh().then(openReview); };
    if ($('rv-labels')) $('rv-labels').onclick = function () { closeReview(); showView('gmail'); };
    $('rv-xml').onclick = function () {
      var blob = new Blob([R.toGmailXml(plan, S.snapshot.account)], { type: 'application/xml' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'labelboard-filters.xml'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Filters downloaded');
    };
    if (applyOk) $('rv-apply').onclick = function () {
      if (reading()) return;
      closeReview();
      // then a read (labels changes come from Gmail's change log: quick), so the board shows what Gmail has now
      API.apply(plan, showProgress).then(function (res) {
        var done = res && res.summary || 'Applied';
        toast(done + '. Reading your inbox again…', 60000);
        if (S.config.release) { delete S.config.release; return API.saveConfig(S.config).then(function () { return refresh(null, done); }); } // handed back: done
        return refresh(null, done);
      })
        .catch(function (e) { hideProgress(); oops(e, 'Apply stopped before it finished. ' + (said(e) || 'Nothing was sent, and your own labels and filters weren\'t touched.') + ' Open Review changes and apply again to finish.', 10000); });
    };
    $('review').hidden = false; $('rv-close').focus();
  }
  function closeReview() { $('review').hidden = true; }

  var toastTimer;
  // stays up while the pointer is on it, so it can be read or copied
  function toast(msg, ms) {
    var t = $('toast'), hide = function () { clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200); };
    t.textContent = msg; t.classList.add('show'); hide();
    t.onmouseenter = function () { clearTimeout(toastTimer); }; t.onmouseleave = hide;
  }

  // ---------- wiring ----------
  document.addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (card) return card.dataset.filter ? openFilter(card.dataset.filter) : card.dataset.gone ? openGone(card.dataset.gone) : card.dataset.ours != null ? openOurs(card.dataset.ours) : openCard(card.dataset.key);
    var t = e.target.closest('[data-fold],[data-settings],[data-open-settings],[data-accept],[data-ours],[data-undo],[data-review],#add-bucket,#btn-triage'); if (!t) return;
    if (t.id === 'btn-triage') return TRIAGE.open();
    if (t.dataset.undo) return t.dataset.go ? runUndo(t.dataset.undo) : openUndo(t.dataset.undo);
    if (t.dataset.review != null) return openReview();
    if (t.dataset.ours != null) return openOurs(t.dataset.ours);
    if (t.dataset.accept) return acceptColumn(t.dataset.accept);
    if (t.dataset.fold) return fold(t.dataset.fold);
    if (t.dataset.settings) return SET.open('columns', t.dataset.settings);
    if (t.dataset.openSettings) return SET.open(t.dataset.openSettings);
    SET.open('columns', SET.addColumn());
  });
  // Keyboard: arrows walk the cards, Shift + ← → moves the focused card one column over.
  $('board').addEventListener('keydown', function (e) {
    var card = e.target.closest && e.target.closest('.card'), k = e.key;
    if (!card || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(k) < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    var well = card.parentNode, list = Array.prototype.slice.call(well.querySelectorAll('.card')), i = list.indexOf(card), dir = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1;
    if (k === 'ArrowUp' || k === 'ArrowDown') return list[i + dir] && list[i + dir].focus();
    if (e.shiftKey) return card.dataset.key && stepCard(card.dataset.key, dir, i);
    var wells = Array.prototype.slice.call(document.querySelectorAll('.board .cards'));
    for (var j = wells.indexOf(well) + dir; j >= 0 && j < wells.length; j += dir) {
      var cs = wells[j].querySelectorAll('.card'); if (cs.length) return cs[Math.min(i, cs.length - 1)].focus();
    }
  });
  function stepCard(key, dir, i) {
    var from = R.placement(S.cardByKey[key], S.config).bucket, ids = S.config.buckets.map(function (b) { return b.id; }), to = ids[ids.indexOf(from) + dir];
    if (!to) return toast('No column further ' + (dir > 0 ? 'right' : 'left'));
    moveCard(key, to, null); renderBoard();
    var el = document.querySelector('.card[data-key="' + CSS.escape(key) + '"]');
    if (el) { el.focus(); return el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    var left = document.querySelectorAll('.cards[data-bucket="' + CSS.escape(from) + '"] .card'); // it went into a folded column
    if (left.length) left[Math.min(i, left.length - 1)].focus();
  }
  // The rack folds to a slim strip while you scroll down a long column, and opens again at the top.
  var rackRaf = 0;
  $('board').addEventListener('scroll', function () {
    if (rackRaf) return;
    rackRaf = requestAnimationFrame(function () {
      rackRaf = 0;
      var rack = $('rack'), was = rack.classList.contains('compact');
      rack.classList.toggle('compact', !!(ui().pane || {}).open || Array.prototype.some.call(document.querySelectorAll('.board .cards'), function (w) {
        return was ? w.scrollTop > 0 : w.scrollTop > 24 && w.scrollHeight - w.clientHeight > 160;
      }));
    });
  }, true);
  document.addEventListener('change', function (e) {
    var a = e.target.dataset && e.target.dataset.leaves;
    if (a) {
      R.setLeaves(bucket(a), e.target.value); placed(); if (view() !== 'board') render(); toast(bucket(a).name + ': ' + leavesWords(e.target.value).toLowerCase() + (/^d|read/.test(e.target.value) ? '. Labelboard checks every hour once you apply.' : ''));
      var sw = document.querySelector('[data-leaves="' + CSS.escape(a) + '"]'); if (sw) sw.focus(); // the head was redrawn
    }
  });
  var qTimer; // a redraw is ~150 ms on a 1,200-thread inbox: wait for the typing to pause
  $('q').addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(renderBoard, 120); }); // views follow the search too (renderBoard refreshes them)
  $('only-who').addEventListener('change', function () { renderBoard(); });
  $('only-wait').addEventListener('change', function () { renderBoard(); });
  $('dr-close').onclick = closeDrawer;
  $('btn-review').onclick = openReview;
  $('rv-close').onclick = closeReview;
  $('review').addEventListener('click', function (e) { if (e.target === this) closeReview(); });
  // One progress bar for long jobs (reading the inbox, applying). Buttons stay off while it runs.
  function showProgress(p) {
    $('progress').hidden = false;
    $('progress-label').textContent = p.text;
    $('progress-fill').style.width = Math.max(2, p.total ? Math.round(100 * p.done / p.total) : 2) + '%';
    document.querySelectorAll('#btn-refresh, #btn-review, #first-scan').forEach(function (b) { b.disabled = true; });
  }
  function hideProgress() {
    $('progress').hidden = true;
    document.querySelectorAll('#btn-refresh, #btn-review, #first-scan').forEach(function (b) { b.disabled = false; });
  }
  // opts.window: true turns the 30-day read back on after it was stopped or didn't fit. applied: Apply's summary, when the read follows it.
  function refresh(opts, applied) {
    var res;
    if (!applied && reading()) return Promise.resolve();
    return (API.refresh ? API.refresh(showProgress, opts) : Promise.resolve()).then(function (r) { res = r; return load(); })
      .then(function () {
        hideProgress();
        // says how the read went, so a slow one explains itself (the header keeps it, with more in its tooltip)
        var w = res && res.window;
        toast((applied ? applied + '. ' : '') + 'Inbox read: ' + fmt(S.snapshot.threads.length) + ' threads' + (res && res.fetched != null && res.kept ? ', ' + fmt(res.fetched) + ' new or changed' : '') +
          (w && w.error ? '. The last 30 days of archived mail didn\'t fit in Apps Script\'s storage, so the board shows your inbox only' : w && w.threads ? ', plus ' + plural(w.threads, 'archived or sent thread') + ' from the last ' + w.days + ' days' : '') +
          (res && res.secs != null ? ' (' + res.secs + ' s)' : ''), w && w.error ? 10000 : 6000);
      })
      .catch(function (e) {
        hideProgress();
        if (applied) return load().then(function () { oops(e, applied + '. The read after it stopped, so the board still shows your inbox from before Apply: read it again to catch up.', 12000); });
        oops(e, 'Reading stopped. ' + (said(e) || 'Nothing in Gmail changed. Read again to start over.'), 10000);
      });
  }
  function windowOff() {
    return API.windowOff().then(load).then(function () { toast('Stopped reading archived mail. Its threads were deleted from Labelboard and the board shows your inbox only; Gmail is unchanged.', 6000); })
      .catch(function (e) { oops(e, 'Archived mail is still being read: turning it off didn\'t go through. Nothing changed. Try again.'); });
  }
  setInterval(function () { if (S.snapshot && $('progress').hidden) renderMeta(); }, 60000); // "read 5 min ago" stays true
  $('btn-refresh').onclick = function () { refresh(); };

  // the gear: Settings holds the rest (look, import and export, remove everything), where you left it
  $('btn-settings').onclick = function () { SET.open(); };
  $('import-file').onchange = function () { var f = this.files[0]; this.value = ''; if (f) SET.importFile(f); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); closeReview(); SET.close(); TRIAGE.close(); $('keys').hidden = true; } });
  // Keys anywhere: / search, 1–5 the tabs, ? the list (#keys). Never while typing, nor over a sheet or the drawer.
  var TABS = ['home', 'board', 'gmail', 'inbox', 'priorities'];
  document.addEventListener('keydown', function (e) {
    var k = e.key, t = e.target, keys = $('keys'), open = document.querySelector('.sheet:not([hidden])') || $('drawer').classList.contains('open');
    var typing = /^(SELECT|TEXTAREA)$/.test(t.tagName) || t.tagName === 'INPUT' && !/^(checkbox|radio|button|range|color)$/.test(t.type) || t.isContentEditable;
    if (e.altKey || e.ctrlKey || e.metaKey || typing || !S.snapshot || !S.snapshot.threads.length) return;
    if (k === '?' && (!open || !keys.hidden)) { e.preventDefault(); keys.hidden = !keys.hidden; if (!keys.hidden) $('ky-close').focus(); return; }
    if (open) return;
    var n = k.length === 1 ? '12345'.indexOf(k) : -1;
    if (n >= 0) { e.preventDefault(); return showView(TABS[n]); }
    if (k === '/') { e.preventDefault(); if (view() === 'home') showView('board'); $('q').focus(); $('q').select(); }
  });
  $('ky-close').onclick = function () { $('keys').hidden = true; };
  $('keys').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });

  // what settings.js needs from the board
  var SET = window.LabelboardSettings({
    S: S, R: R, API: API, $: $, h: h, fmt: fmt, plural: plural, PALETTE: R.PALETTE, textOn: textOn, bandOf: bandOf, labelChip: labelChip,
    bucket: bucket, rebuild: rebuild, render: render, renderBoard: renderBoard, renderRack: renderRack, save: save, load: load, toast: toast, said: said,
    unsave: function () { clearTimeout(saveTimer); }, ui: ui, applyUi: applyUi, openUndo: openUndo, leavesSelect: leavesSelect, leavesWords: leavesWords,
  });
  var TRIAGE = window.LabelboardTriage({
    S: S, R: R, $: $, h: h, fmt: fmt, plural: plural, KIND: KIND, bucket: bucket, bandOf: bandOf, bySize: bySize, inboxIn: inboxIn, whoChip: whoChip,
    place: place, placed: function () { filterInfo(); renderRack(); renderReview(); save(); }, renderBoard: renderBoard, openReview: openReview,
  });
  var VIEWS = window.LabelboardViews({
    S: S, $: $, h: h, fmt: fmt, plural: plural, bucket: bucket, bandOf: bandOf, textOn: textOn, ui: ui, save: save,
    openCard: openCard, openFilter: openFilter, openOurs: openOurs, refresh: refresh, moveLine: moveLine, undoMove: undoMove,
    moveCard: function (key, to) { moveCard(key, to, null); renderBoard(); }, windowOff: windowOff, canRead: !!API.refresh,
    trace: trace, showView: showView, colStatus: colStatus, fsText: fsText, labelChip: labelChip, nameChip: nameChip, FUNNEL: FUNNEL, prioOpts: prioOpts,
    threadUrl: function (id, archived) { return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(S.snapshot.account) + '#' + (archived ? 'all' : 'inbox') + '/' + id; },
  });
  var GMAIL = window.LabelboardGmailView({
    S: S, API: API, $: $, h: h, fmt: fmt, plural: plural, hex: hex, textOn: textOn, bucket: bucket, bandOf: bandOf, labelChip: labelChip, nameChip: nameChip, view: view,
    labelState: function () { return labelState(); }, rebuild: rebuild, render: render, save: save, toast: toast, placed: placed,
    trace: trace, colStatus: colStatus, fsText: fsText, leavesSelect: leavesSelect, leavesWords: leavesWords, cardEdit: cardEdit,
    tip: VIEWS.tip, resetTips: VIEWS.resetTips, hideTip: VIEWS.hideTip, dayRows: VIEWS.dayRows, colorOf: VIEWS.colorOf,
  });
  var HOME = window.LabelboardHome({
    S: S, $: $, h: h, fmt: fmt, plural: plural, bucket: bucket, bandOf: bandOf, ui: ui, rackBar: rackBar, colInfo: colInfo, showColumn: showColumn, openReview: openReview, labelState: function () { return labelState(); },
    prioOpts: prioOpts, triage: function () { return TRIAGE.counts(); }, openTriage: function () { TRIAGE.open('unsorted'); }, since: function () { return S.visit && S.visit.since; },
  });
  boot();
})();
