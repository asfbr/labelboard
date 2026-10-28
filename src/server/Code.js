// Labelboard server (Apps Script). Gmail advanced service only: gmail.modify + gmail.settings.basic, plus
// script.scriptapp for the hourly trigger that archives mail later (runLater).
// Long jobs (scan, apply) run in slices under the 6-minute limit; the board calls them until done.
// Pure helpers (quota pacing, read diff, bulk apply, filter ownership) live in Sync.js (LabelboardSync).
var SLICE_MS = 15 * 1000; // the progress bar moves every slice; the gap between slices refills the budget, so it costs no speed

// Every Gmail call spends from a unit budget that stays just under Gmail's per-minute limit. Slices pass
// it on through their cursor. "Quota exceeded … per minute" still gets a wait-and-retry as a safety net.
var BUDGET = { tokens: 0, at: 0 };
function gmail_(cost, fn) {
  var wait = LabelboardSync.budgetWait(BUDGET, cost, Date.now());
  if (wait) Utilities.sleep(wait);
  for (var attempt = 0; ; attempt++) {
    try { return fn(); } catch (e) {
      if (attempt >= 4 || !/Quota exceeded|Rate Limit|rateLimitExceeded|429/i.test(String(e))) throw e;
      Utilities.sleep(5000 * (attempt + 1));
    }
  }
}
function notFound_(e) { return /not found|404/i.test(String(e)); }
// An error already in plain words for the user: the board shows what follows "Labelboard: " (app.js said()).
function plain_(msg) { return new Error('Labelboard: ' + msg); }
var PROPS = PropertiesService.getUserProperties();

function doGet() {
  return HtmlService.createHtmlOutputFromFile('board').setTitle('Labelboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- storage: gzip + base64, chunked. Durable data in user properties (9 KB/value,
// 500 KB total); a scan or apply in progress in the user cache (100 KB/value, 6 h), since it is rebuildable.
var CACHE = CacheService.getUserCache();
function store_(key) {
  return /^(scan|apply)/.test(key)
    ? { size: 90000, get: function (k) { return CACHE.get(k); }, putAll: function (o) { CACHE.putAll(o, 21600); }, del: function (k) { CACHE.remove(k); } }
    : { size: 8000, get: function (k) { return PROPS.getProperty(k); }, putAll: function (o) { PROPS.setProperties(o); }, del: function (k) { PROPS.deleteProperty(k); } };
}
function putBlob_(key, obj) {
  var st = store_(key);
  var data = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
  var n = Math.ceil(data.length / st.size), all = {};
  for (var i = 0; i < n; i++) all[key + '.' + i] = data.slice(i * st.size, (i + 1) * st.size);
  all[key + '.n'] = String(n);
  var old = Number(st.get(key + '.n') || 0);
  for (var j = n; j < old; j++) st.del(key + '.' + j);
  st.putAll(all);
}
function getBlob_(key, fallback) {
  var st = store_(key), n = Number(st.get(key + '.n') || 0);
  if (!n) return fallback;
  var s = '';
  for (var i = 0; i < n; i++) { var c = st.get(key + '.' + i); if (c == null) return fallback; s += c; } // the cache can drop a chunk
  var blob = Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip');
  return JSON.parse(Utilities.ungzip(blob).getDataAsString());
}
function delBlob_(key) {
  var st = store_(key), n = Number(st.get(key + '.n') || 0);
  for (var i = 0; i < n; i++) st.del(key + '.' + i);
  st.del(key + '.n');
}

// ---------- state for the board ----------
// Settings shipped with a deploy (`build --bake`) replace the stored ones once per new bake. Placements
// made on the board (cards, threadOverrides) and view picks (ui) carry over, with the baked file winning per key.
function takeBaked_() {
  if (typeof BAKED_CONFIG === 'undefined' || !BAKED_CONFIG || PROPS.getProperty('bakedStamp') === BAKED_STAMP) return;
  var stored = getBlob_('config', {}), next = JSON.parse(JSON.stringify(BAKED_CONFIG));
  ['cards', 'threadOverrides', 'ui'].forEach(function (k) { next[k] = Object.assign({}, stored[k] || {}, next[k] || {}); });
  putBlob_('config', next);
  PROPS.setProperty('bakedStamp', BAKED_STAMP);
}
function getState() {
  var me = Session.getActiveUser().getEmail().toLowerCase();
  takeBaked_();
  var config = getBlob_('config', null) || defaultConfig_(me);
  var snapshot = getBlob_('snapshot', null) || { version: 1, account: me, source: 'apps-script', generatedAt: new Date().toISOString(), threads: [] };
  return JSON.stringify({ mode: 'apps-script', snapshot: snapshot, config: config, seeds: getBlob_('seeds', []), gmail: gmailState_(), recent: getBlob_('recent', null), record: readRecord_() });
}
// Stops reading the last 30 days: its threads are deleted here, and reads stay on the inbox until it is turned back on.
function windowOff() {
  delBlob_('recent');
  var snap = getBlob_('snapshot', null);
  if (snap) { snap.window = { off: true }; putBlob_('snapshot', snap); }
  return true;
}
// Owned filters with their specs outgrow one 9 KB property, so they live in a chunked blob with the
// gone list. The first version's bare id list (property ownedFilters) is read once, then dropped.
function readOwned_() {
  return getBlob_('owned', null) || { filters: LabelboardSync.readOwned(PROPS.getProperty('ownedFilters')), gone: [] };
}
function saveOwned_(filters, gone) {
  putBlob_('owned', { filters: filters, gone: gone });
  if (PROPS.getProperty('ownedFilters') != null) PROPS.deleteProperty('ownedFilters');
}
// Your Gmail filters and labels, read live on every load (2 quota units): the board shows them, flags
// overlaps and drift, and diffs its plan against them. labelInfo carries each label's colour for the Gmail tab.
function gmailState_() {
  try {
    var list = labelList_(), names = {};
    list.forEach(function (l) { names[l.id] = l.name; });
    var filters = listFilters_(names), o = readOwned_(), r = LabelboardSync.reconcile(o.filters, filters, o.gone);
    filters.forEach(function (f) { var s = r.owned[f.id]; f.owned = !!s; f.at = s && s.at || null; f.adopted = !!(s && s.adopted); });
    var named = function (key) { return readIds_(key).map(function (id) { return names[id]; }).filter(Boolean); };
    return { filters: filters, gone: r.gone, labels: Object.keys(names).map(function (id) { return names[id]; }), ownedLabels: named('ownedLabels'), adoptedLabels: named('adoptedLabels'),
      labelInfo: list.map(function (l) { return { name: l.name, color: l.color || null, type: l.type }; }),
      later: { rules: readLater_(), log: JSON.parse(PROPS.getProperty('laterLog') || '{}') }, auto: JSON.parse(PROPS.getProperty('autoLog') || 'null') };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}
function saveConfig(json) {
  var c = JSON.parse(json), on = c.auto && c.auto.read ? '1' : '0';
  putBlob_('config', c);
  if (PROPS.getProperty('autoRead') !== on) { PROPS.setProperty('autoRead', on); syncTrigger_(); } // reading on its own was switched
  return true;
}
function saveSeeds(json) {
  var seeds = JSON.parse(json);
  if (!Array.isArray(seeds)) throw plain_('a contacts file is a JSON list of {match, value, bucket, name}');
  putBlob_('seeds', seeds); return seeds.length;
}

// A first run starts from presets/basic.json (inlined by the build as PRESETS) plus who you are.
function defaultConfig_(me) {
  var c = JSON.parse(JSON.stringify(PRESETS.basic)), domain = me.split('@')[1];
  // a webmail address (gmail.com) is not a firm: everyone there would count as a colleague (keep in step with GENERIC_DOMAINS in rules.js)
  var firm = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|aol)\./.test(domain) ? [] : [domain];
  return Object.assign(c, { version: 1, me: [me], firmDomains: firm, aliases: [], aliasBuckets: {}, labelMap: {}, cards: {} });
}

// ---------- scan: read the inbox (and the window) into a snapshot, incremental and resumable ----------
// First slice lists the inbox (threads.list, 10 units per 500) and reads Gmail's change log since the
// last read (history.list, 2 units per page): only threads with new or deleted mail are fetched again
// (threads.get, 40 units each), label changes are patched in place. Each slice caches just its own new
// records (scan.p<n>), so no slice re-packs the growing read.
// The same read also covers the last 30 days of mail outside the inbox (archived by you or a filter,
// sent), stored apart in the `recent` blob: the window. On unless turned off (snapshot.window.off) or
// it didn't fit (.error); optsJson {window: true} turns it back on at 30 days.
function scanInbox(cursorJson, optsJson) {
  var start = Date.now(), me = Session.getActiveUser().getEmail().toLowerCase(), S = LabelboardSync;
  var c = cursorJson ? JSON.parse(cursorJson) : null, st = c ? getBlob_('scan', null) : null;
  BUDGET = c && c.budget || { tokens: 0, at: 0 };
  if (!st) {
    var snap = getBlob_('snapshot', null) || { threads: [] }, opts = optsJson ? JSON.parse(optsJson) : {}, was = snap.window || {};
    if (!opts.auto) notAuto_();
    var win = opts.window != null ? !!opts.window : !(was.off || was.error);
    var days = !opts.window && was.days && !was.error ? was.days : S.WINDOW_DAYS; // fewer when 30 didn't fit
    var now = gmail_(S.COST.getProfile, function () { return Gmail.Users.getProfile('me'); }).historyId; // before listing: later changes show up next time
    var listed = listThreads_({ labelIds: ['INBOX'] }), inboxIds = listed.map(function (t) { return t.id; });
    if (inboxIds.length > S.INBOX_CAP) throw plain_(S.tooBig(inboxIds.length)); // before an hour of reading that can't be saved
    var stored = snap.threads.concat(win ? (getBlob_('recent', null) || { threads: [] }).threads : []);
    if (win) listed = listed.concat(listThreads_({ q: S.windowQuery(days) }));
    var labels = labelList_(), names = {}, mine = labels.filter(function (l) { return l.type === 'user'; });
    labels.forEach(function (l) { names[l.id] = l.name; });
    var changes = historySince_(snap), newMail = changes ? null : mailSince_(snap);
    var d = S.diffInbox(stored, listed, changes, newMail, mine.length), since = new Date(start - days * 864e5).toISOString();
    if (win) d = S.addTimelines(d, stored, since);
    st = { keep: d.keep, fetch: d.fetch, dropped: d.dropped, names: names, historyId: String(now || ''), changes: changes && { add: changes.add, remove: changes.remove },
      relabeled: d.changed.length ? relabeled_(d.changed, mine) : null, inboxIds: inboxIds,
      win: win ? Object.assign({ days: days, since: since }, windowCounts_(days)) : null, auto: !!opts.auto };
    putBlob_('scan', st);
    c = { pos: 0, parts: 0, got: 0, began: start };
  }
  var part = [];
  while (c.pos < st.fetch.length && Date.now() - start < SLICE_MS) {
    var rec = threadRecord_(st.fetch[c.pos], me, st.names);
    if (rec) part.push(rec); // null: deleted since the listing
    c.pos++;
  }
  if (part.length) { putBlob_('scan.p' + c.parts, part); c.parts++; c.got += part.length; }
  var kept = st.keep.length, total = kept + st.fetch.length;
  if (c.pos < st.fetch.length) {
    c.budget = BUDGET;
    var left = Math.round((st.fetch.length - c.pos) * S.COST.threadsGet / (S.RATE * 60));
    return { done: false, next: JSON.stringify(c), count: kept + c.pos, total: total,
      text: 'Reading ' + st.fetch.length + ' new or changed threads: ' + c.pos + ' of ' + st.fetch.length + (kept ? ' (' + kept + ' unchanged)' : '') + (left >= 2 ? ', about ' + left + ' min left' : '') };
  }
  var fetched = [];
  for (var i = 0; i < c.parts; i++) fetched = fetched.concat(getBlob_('scan.p' + i, []));
  if (fetched.length < c.got) throw plain_('Part of this read was dropped from Apps Script\'s cache. Nothing in Gmail changed. Read again to start over.');
  var stored = (getBlob_('snapshot', null) || { threads: [] }).threads.concat(st.win ? (getBlob_('recent', null) || { threads: [] }).threads : []);
  var parts = S.splitWindow(S.mergeInbox(stored, st.keep, fetched, st.changes, st.names, st.relabeled), st.inboxIds), threads = parts.inbox;
  // how the read went, kept with the snapshot so the board can show it after the toast is gone
  var read = { fetched: st.fetch.length, relabeled: st.relabeled ? Object.keys(st.relabeled.threads).length : 0, log: !!st.changes, secs: Math.round((Date.now() - (c.began || start)) / 1000) };
  if (st.auto) read.auto = true; // the header says it read on its own
  var win = st.win && { days: st.win.days, since: st.win.since, threads: parts.window.length, sent: st.win.sent, received: st.win.received };
  var snapshot = { version: 1, account: me, source: 'apps-script', query: 'in:inbox', generatedAt: new Date().toISOString(), historyId: st.historyId, read: read, window: win || { off: true }, threads: threads };
  if (win) delBlob_('recent'); // the inbox is saved first: it has to fit even when the window doesn't
  try { putBlob_('snapshot', snapshot); } catch (e) { throw plain_(S.tooBig(threads.length)); } // under the cap but over 500 KB with the rest

  if (win) win = saveWindow_(snapshot, win, parts.window);
  for (var j = 0; j < c.parts; j++) delBlob_('scan.p' + j);
  delBlob_('scan');
  return Object.assign({ done: true, count: threads.length, total: threads.length, kept: kept, dropped: st.dropped, window: win || null }, read);
}
function listThreads_(params) {
  var out = [], token = null;
  do {
    var page = gmail_(LabelboardSync.COST.threadsList, function () { return Gmail.Users.Threads.list('me', Object.assign({ maxResults: 500, pageToken: token || undefined }, params)); });
    (page.threads || []).forEach(function (t) { out.push({ id: t.id, historyId: t.historyId }); });
    token = page.nextPageToken;
  } while (token);
  return out;
}
// The window over 500 KB of user properties: half the days until it fits (kept for later reads), else off with error 'full'.
function saveWindow_(snapshot, win, threads) {
  for (;;) {
    try { putBlob_('recent', { threads: threads }); break; } catch (e) { delBlob_('recent'); }
    var s = LabelboardSync.windowShrink(threads, win.days, Date.now());
    if (!s) { win = { days: LabelboardSync.WINDOW_DAYS, error: 'full' }; break; }
    threads = s.threads;
    win = Object.assign({ days: s.days, since: s.since, threads: threads.length, shrunk: true }, windowCounts_(s.days));
  }
  snapshot.window = win; putBlob_('snapshot', snapshot);
  return win;
}
function windowCounts_(days) {
  return { sent: countMail_('newer_than:' + days + 'd in:sent'), received: countMail_('newer_than:' + days + 'd -in:sent -in:chats -in:drafts') };
}
// The window's received and sent totals: messages counted from list pages (5 units per 500), none fetched.
function countMail_(q) {
  var n = 0, token = null;
  do {
    var page = gmail_(LabelboardSync.COST.messagesList, function () { return Gmail.Users.Messages.list('me', { q: q, maxResults: 500, pageToken: token || undefined }); });
    n += (page.messages || []).length;
    token = page.nextPageToken;
  } while (token);
  return n;
}
// Threads with a message since the last read (an hour's margin; your replies too), or null with no
// read to count from. Without the change log, these are the only threads fetched again in full.
function mailSince_(snap) {
  var t = Date.parse(snap.generatedAt || ''); if (!t || !(snap.threads || []).length) return null;
  var q = 'after:' + Math.floor(t / 1000 - 3600), ids = {}, token = null;
  do {
    var page = gmail_(LabelboardSync.COST.messagesList, function () { return Gmail.Users.Messages.list('me', { q: q, maxResults: 500, pageToken: token || undefined }); });
    (page.messages || []).forEach(function (m) { ids[m.threadId] = 1; });
    token = page.nextPageToken;
  } while (token);
  return ids;
}
// Changed threads with no new mail get their labels redone instead of a full fetch: each of your labels
// is listed once (threads.list, 10 units per 500: ~15 s for 130 labels, against minutes of threads.get).
function relabeled_(changed, mine) {
  var byLabel = {};
  mine.forEach(function (l) {
    var ids = [], token = null;
    do {
      var page = gmail_(LabelboardSync.COST.threadsList, function () { return Gmail.Users.Threads.list('me', { labelIds: [l.id], maxResults: 500, pageToken: token || undefined }); });
      (page.threads || []).forEach(function (t) { ids.push(t.id); });
      token = page.nextPageToken;
    } while (token);
    byLabel[l.name] = ids;
  });
  return { labels: mine.map(function (l) { return l.name; }), threads: LabelboardSync.relabel(changed, byLabel) };
}
// Changes since the last read, or null when there's no log to use (first read; Gmail keeps about a week
// of it, older → 404): the read then falls back to comparing each thread's historyId. A snapshot from
// before the log was used starts from its newest thread's historyId, which is no later than that read.
function historySince_(snap) {
  var from = snap.historyId || (snap.threads || []).reduce(function (m, t) {
    var h = String(t.historyId || ''); return h.length > m.length || (h.length === m.length && h > m) ? h : m;
  }, '');
  if (!from) return null;
  var recs = [], token = null;
  try {
    do {
      var page = gmail_(LabelboardSync.COST.historyList, function () { return Gmail.Users.History.list('me', { startHistoryId: from, maxResults: 500, pageToken: token || undefined }); });
      recs = recs.concat(page.history || []);
      token = page.nextPageToken;
    } while (token);
  } catch (e) { if (notFound_(e)) return null; throw e; }
  return LabelboardSync.historyChanges(recs);
}
function threadRecord_(id, me, names) {
  var t;
  try {
    t = gmail_(LabelboardSync.COST.threadsGet, function () { return Gmail.Users.Threads.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject'] }); });
  } catch (e) { if (notFound_(e)) return null; throw e; }
  var msgs = t.messages || [], hdr = function (m, n) {
    var h = (m.payload.headers || []).filter(function (x) { return x.name.toLowerCase() === n; })[0];
    return h ? h.value : '';
  };
  var addrs = function (s) { return (s.match(/[\w.+'-]+@[\w.-]+\.\w+/g) || []).map(function (a) { return a.toLowerCase(); }); };
  var first = msgs.filter(function (m) { return addrs(hdr(m, 'from'))[0] !== me; })[0] || msgs[0];
  var last = msgs[msgs.length - 1];
  var collect = function (field) {
    var set = {};
    msgs.forEach(function (m) { addrs(hdr(m, field)).forEach(function (a) { if (a !== me) set[a] = 1; }); });
    return Object.keys(set);
  };
  var labels = {};
  msgs.forEach(function (m) { (m.labelIds || []).forEach(function (l) { labels[names[l] || l] = 1; }); });
  var fromHdr = hdr(first, 'from'), fromName = (fromHdr.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '';
  // dir: you were in To or Cc of a message; att: a message is multipart/mixed (Gmail's has:attachment, near enough)
  var dir = msgs.some(function (m) { return addrs(hdr(m, 'to') + ' ' + hdr(m, 'cc')).indexOf(me) >= 0; }) ? 1 : 0;
  var att = msgs.some(function (m) { return /^multipart\/mixed/i.test(m.payload.mimeType || ''); }) ? 1 : 0;
  return {
    id: id, date: new Date(Number(last.internalDate)).toISOString(), from: addrs(fromHdr)[0] || '', fromName: fromName,
    to: collect('to'), cc: collect('cc'), dir: dir, att: att, subject: hdr(first, 'subject'),
    snippet: String(last.snippet || '').slice(0, 160), labels: Object.keys(labels), count: msgs.length, historyId: String(t.historyId || ''),
    msgs: LabelboardSync.timeline(msgs),
  };
}
function labelList_() { return gmail_(LabelboardSync.COST.labelsList, function () { return Gmail.Users.Labels.list('me'); }).labels || []; }
// Label ids Labelboard keeps in a user property: ownedLabels (created by it, or handed over) and adoptedLabels (handed over).
function readIds_(key) { return JSON.parse(PROPS.getProperty(key) || '[]'); }
function saveIds_(key, ids) { PROPS.setProperty(key, JSON.stringify(ids)); }
// Threads and messages under each label of yours (labels.get, 1 unit each; labels.list leaves counts out). The Labels
// view asks once when it opens.
function labelCounts() {
  BUDGET = { tokens: 0, at: 0 };
  var out = {};
  labelList_().forEach(function (l) {
    if (l.type !== 'user') return;
    var g = gmail_(LabelboardSync.COST.labelsGet, function () { return Gmail.Users.Labels.get('me', l.id); });
    out[l.name] = { threads: g.threadsTotal || 0, messages: g.messagesTotal || 0 };
  });
  return JSON.stringify(out);
}
function labelNames_() {
  var m = {};
  labelList_().forEach(function (l) { m[l.id] = l.name; });
  return m;
}
function listFilters_(names) {
  var list = gmail_(LabelboardSync.COST.filtersList, function () { return Gmail.Users.Settings.Filters.list('me'); }).filter || [];
  return list.map(function (f) { return LabelboardSync.normFilter(f, names); });
}

// ---------- apply: labels, then filters (diff), then the threads already in the inbox, then labels moved ----------
// progress p = { phase, op, ids (label name → id), budget, log }, handed back to the board until done.
// The board decided thread by thread what mail already in the inbox gets; this labels those exact threads.
// plan.recolor fixes colours on labels already in Gmail; plan.adoptLabels / plan.handover / plan.moves: labels.js housekeeping.
function applyPlan(planJson, progressJson) {
  var plan = JSON.parse(planJson), p = progressJson ? JSON.parse(progressJson) : { phase: 'labels', op: 0, log: {} };
  var start = Date.now(), late = function () { return Date.now() - start > SLICE_MS; };
  BUDGET = p.budget || { tokens: 0, at: 0 };
  var pause = function (step, steps, text) { p.budget = BUDGET; return JSON.stringify({ done: false, progress: JSON.stringify(p), step: step, steps: steps, text: text }); };
  if (p.phase === 'labels') {
    if (!plan.auto) notAuto_();
    delBlob_('apply.m'); startRecord_(plan);
    p.ids = ensureLabels_(plan.labels, p, plan.recolor);
    adoptLabels_(plan.adoptLabels, p.ids);
    p.phase = 'filters'; return pause(0, 1, 'Labels ready. Creating filters…');
  }
  if (p.phase === 'filters') {
    if (syncFilters_(plan, p.ids, p, late)) return pause(p.log.filtersCreated || 0, plan.filters.length, 'Creating filters: ' + (p.log.filtersCreated || 0) + ' made so far');
    p.phase = 'threads';
  }
  if (p.phase === 'threads') {
    // The inbox's message ids (messages.list, 5 units per 500) let one batch call label many threads.
    // Relisted if the cache dropped them: every step is safe to repeat, so the steps restart from the top.
    var msgs = getBlob_('apply.m', null);
    if (!msgs) { msgs = inboxMessages_(plan); putBlob_('apply.m', msgs); p.op = 0; }
    var ops = LabelboardSync.applyOps(plan.backfill, ownedOnly_(plan.unlabel, p.ids), p.ids, msgs);
    while (p.op < ops.length) {
      if (late()) return pause(p.op, ops.length, 'Sorting your inbox: step ' + p.op + ' of ' + ops.length);
      runOp_(ops[p.op], p);
      p.op++;
    }
    delBlob_('apply.m');
    p.phase = 'moves'; p.mv = 0;
  }
  var moves = plan.moves || [];
  if (moveLabels_(plan, p, late)) return pause(p.mv, moves.length, 'Moving mail between labels: ' + p.mv + ' of ' + moves.length + ' labels');
  if (plan.later) setLater_(plan.later); // a plan from before timed rules leaves them as they are
  noteApply_(function (e) { e.done = true; });
  return JSON.stringify({ done: true, summary: summary_(p.log, plan) });
}

// ---------- archiving later: the cards' timed rules, run every hour by a trigger while there are any ----------
// Rules live in blob `timed` (rules.js laterRules; a column's searches outgrow one property, so the first version's
// property `later` is read once, then dropped); `laterLog` keeps what each archived, last 14 days.
function readLater_() { return getBlob_('timed', null) || JSON.parse(PROPS.getProperty('later') || '[]'); }
function setLater_(rules) {
  var was = readLater_();
  putBlob_('timed', rules);
  if (PROPS.getProperty('later') != null) PROPS.deleteProperty('later');
  if (rules.length || was.length) syncTrigger_(); // a board that never archives later never touches triggers
}
// The one hourly trigger (handler runLater) exists while a column or card archives later, or you switched on reading on
// its own (config.auto.read). Called when either changes: Apply (setLater_) or a save that switches it (saveConfig).
function syncTrigger_() {
  var c = getBlob_('config', null), want = readLater_().length > 0 || !!(c && c.auto && c.auto.read);
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runLater'; });
  if (want && !mine.length) ScriptApp.newTrigger('runLater').timeBased().everyHours(1).create();
  if (!want) mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
function runLater() {
  var S = LabelboardSync, start = Date.now(), log = JSON.parse(PROPS.getProperty('laterLog') || '{}'), now = Date.now(), rules = readLater_();
  BUDGET = { tokens: 0, at: 0 };
  rules.forEach(function (r) {
    if (Date.now() - start > 4 * 60000) return; // the next run carries on
    var ids = [];
    r.queries.forEach(function (q) {
      var qs = S.laterQueries(r, q), fresh = listThreads_({ q: qs[1] }).map(function (t) { return t.id; });
      ids = ids.concat(S.laterIds(listThreads_({ q: qs[0] }).map(function (t) { return t.id; }), fresh.concat(ids)));
    });
    ids.forEach(function (t) { modifyThread_(t, { addLabelIds: [], removeLabelIds: ['INBOX'] }, { log: {} }); });
    var l = (log[r.id] || []).filter(function (x) { return now - x[0] < 14 * 864e5; });
    if (ids.length) l.push([now, ids.length]);
    if (l.length) log[r.id] = l; else delete log[r.id];
  });
  Object.keys(log).forEach(function (k) { if (!rules.some(function (r) { return r.id === k; })) delete log[k]; });
  PROPS.setProperty('laterLog', JSON.stringify(log));
  if (Date.now() - start < 60000) runAuto_(start); // a long archiving hour leaves the read for the next one: Apps Script stops a run at 6 min
}

// ---------- on its own (Settings → Runs on its own): read what changed every 6 hours, then maybe apply ----------
// Never a first read, never while a read, an Apply or an undo of yours runs (they refuse to start while this one does,
// cache key `auto`). It applies only when your settings are the ones you last applied (rules.js autoPlan), so the
// only news is what the rules placed; each one is an Apply in the record, undone like yours. `autoLog`: the last run.
var AUTO_EVERY = 6 * 3600e3;
function runAuto_(start) {
  var config = getBlob_('config', null), auto = config && config.auto || {}, snap = getBlob_('snapshot', null);
  if (!auto.read || !snap || !snap.threads.length || Date.now() - Date.parse(snap.generatedAt) < AUTO_EVERY) return;
  if (getBlob_('scan', null) || CACHE.get('apply.m.n') || readRecord_().undo) return; // yours is running: the next hour tries again
  var lock = LockService.getUserLock(); if (!lock.tryLock(1000)) return;
  CACHE.put('auto', String(Date.now()), 600);
  var log = { at: Date.now() };
  try {
    var c = null, res;
    do { res = scanInbox(c, JSON.stringify({ auto: true })); c = res.next; } while (!res.done && Date.now() - start < 3 * 60000);
    if (!res.done) { delBlob_('scan'); log.read = 'unfinished'; return; }
    log.read = { fetched: res.fetched || 0 };
    if (auto.apply) log.apply = Date.now() - start < 3.5 * 60000 ? autoApply_(config, start) : { waits: 'time' };
  } catch (e) {
    log.error = String(e && e.message || e).replace(/^Labelboard: /, '');
  } finally {
    PROPS.setProperty('autoLog', JSON.stringify(log)); CACHE.remove('auto'); lock.releaseLock();
  }
}
// What autoPlan finds to do, as Apply would do it: { applied: summary } | { nothing } | { waits: 'settings' | 'stopped' }.
function autoApply_(config, start) {
  var rec = readRecord_(), last = rec.applies[rec.applies.length - 1], R = LabelboardRules;
  if (!last || !last.done) return { waits: 'stopped' };
  if (last.settings !== R.settingsKey(config)) return { waits: 'settings' };
  var g = gmailState_(); if (g.error) throw new Error(g.error);
  var plan = R.autoPlan(getBlob_('snapshot', null), getBlob_('recent', null), config, getBlob_('seeds', []), g);
  var names = {}; labelList_().forEach(function (l) { names[l.id] = l.name; });
  var o = readOwned_(), live = listFilters_(names), r = LabelboardSync.reconcile(o.filters, live, o.gone), a = LabelboardSync.filterActions(plan.filters, live, r.owned, r.gone, []);
  if (!a.create.length && !a.remove.length && !plan.backfill.length) return { nothing: true };
  var p = null, out;
  do { out = JSON.parse(applyPlan(JSON.stringify(plan), p)); p = out.progress; } while (!out.done && Date.now() - start < 4.5 * 60000);
  return out.done ? { applied: out.summary } : { waits: 'stopped' };
}
// A read, an Apply or an undo of yours waits while one on its own runs (a minute or two).
function notAuto_() { if (CACHE.get('auto')) throw plain_('Labelboard is reading your mail on its own right now. Nothing changed. Try again in a minute.'); }
// The record (blob `record`: not "apply…", which would put it in the 6 h cache) keeps every Apply so it can be
// undone. Its entry is written before the first Gmail write, so a full storage stops Apply with nothing changed.
function readRecord_() { return getBlob_('record', null) || { applies: [] }; }
function saveRecord_(rec) { putBlob_('record', rec); }
function noteApply_(fn) { var rec = readRecord_(), e = rec.applies[rec.applies.length - 1]; if (e) { fn(e); saveRecord_(rec); } }
function startRecord_(plan) {
  var rec = readRecord_(), last = rec.applies[rec.applies.length - 1], e = LabelboardSync.recordApply(plan, Date.now());
  if (rec.undo) throw plain_('An undo is still unfinished. Nothing was applied. Open Review changes and finish undoing first.');
  if (plan.later) e.later = readLater_(); // the timed rules before this Apply, for its undo
  if (plan.settings) e.settings = plan.settings; // what applying on its own compares with
  if (plan.auto) e.auto = true;
  if (last && !last.done) rec.applies[rec.applies.length - 1] = LabelboardSync.mergeRecord(last, e); else rec.applies.push(e);
  delete rec.undone;
  try { saveRecord_(rec); } catch (err) {
    throw plain_('Labelboard\'s storage in Apps Script is full, so it can\'t keep the record that undoes this Apply. Nothing in Gmail changed. Archive older inbox mail in Gmail, read again, then apply.');
  }
}
function inboxMessages_(plan) {
  var want = {}, msgs = {}, token = null;
  plan.backfill.concat(plan.unlabel || []).forEach(function (e) { e.threadIds.forEach(function (t) { want[t] = 1; }); });
  do {
    var page = gmail_(LabelboardSync.COST.messagesList, function () { return Gmail.Users.Messages.list('me', { labelIds: ['INBOX'], maxResults: 500, pageToken: token || undefined }); });
    (page.messages || []).forEach(function (m) { if (want[m.threadId]) (msgs[m.threadId] = msgs[m.threadId] || []).push(m.id); });
    token = page.nextPageToken;
  } while (token);
  return msgs;
}
// Re-sorting only ever takes off labels Labelboard created itself (ownedLabels), never one you made or handed over as it is.
function ownedOnly_(unlabel, ids) {
  var owned = readIds_('ownedLabels'), adopted = readIds_('adoptedLabels');
  return (unlabel || []).filter(function (e) { var id = ids[e.label]; return owned.indexOf(id) >= 0 && adopted.indexOf(id) < 0; });
}
function runOp_(op, p) {
  var body = { addLabelIds: op.add, removeLabelIds: op.remove };
  if (op.thread) return modifyThread_(op.thread, body, p);
  try {
    gmail_(LabelboardSync.COST.batchModify, function () { return Gmail.Users.Messages.batchModify({ ids: op.ids, addLabelIds: op.add, removeLabelIds: op.remove }, 'me'); });
  } catch (e) {
    if (!notFound_(e) && !/invalid/i.test(String(e))) throw e;
    op.threads.forEach(function (t) { modifyThread_(t, body, p); }); // a message gone since the listing: one thread at a time
  }
}
function modifyThread_(t, body, p) {
  try { gmail_(LabelboardSync.COST.threadsModify, function () { return Gmail.Users.Threads.modify(body, 'me', t); }); }
  catch (e) { if (!notFound_(e)) throw e; p.log.missing = (p.log.missing || 0) + 1; } // deleted since the read: skipped
}
// recolor: [{name, color}] for labels already in Gmail that the plan doesn't name (a company with no mail in this read,
// one left over and kept); a missing one is left alone.
function ensureLabels_(labels, p, recolor) {
  var byName = {}, owned = readIds_('ownedLabels');
  labelList_().forEach(function (l) { byName[l.name] = l; });
  var want = {};
  labels.forEach(function (l) {
    var parts = l.name.split('/');
    for (var i = 1; i < parts.length; i++) { var parent = parts.slice(0, i).join('/'); if (!want[parent]) want[parent] = { name: parent, color: null }; }
    want[l.name] = l;
  });
  Object.keys(want).sort().forEach(function (name) {
    var l = want[name], have = byName[name];
    if (!have) {
      var body = { name: name, labelListVisibility: 'labelShow', messageListVisibility: 'show' };
      if (l.color) body.color = l.color;
      byName[name] = gmail_(LabelboardSync.COST.labelsCreate, function () { return Gmail.Users.Labels.create(body, 'me'); });
      owned.push(byName[name].id);
      saveIds_('ownedLabels', owned);
      noteApply_(function (e) { e.labelsCreated.push(name); });
      p.log.labelsCreated = (p.log.labelsCreated || 0) + 1;
    } else recolor_(name, have, l.color, p);
  });
  (recolor || []).forEach(function (r) { if (byName[r.name] && !want[r.name]) recolor_(r.name, byName[r.name], r.color, p); });
  var ids = {};
  Object.keys(byName).forEach(function (n) { ids[n] = byName[n].id; });
  return ids;
}
function recolor_(name, have, color, p) {
  if (!color || have.color && have.color.backgroundColor === color.backgroundColor) return;
  noteApply_(function (e) { if (!(name in e.recolored)) e.recolored[name] = have.color || null; }); // the colour before the first Apply that changed it
  gmail_(LabelboardSync.COST.labelsPatch, function () { return Gmail.Users.Labels.patch({ color: color }, 'me', have.id); });
  p.log.labelsRecolored = (p.log.labelsRecolored || 0) + 1;
}
// Labels of yours handed over as they are: Labelboard's from now on (colours follow the column; re-sorting leaves them on,
// since they carry mail no card gives), and given back untouched by Undo or Remove everything.
function adoptLabels_(names, ids) {
  var owned = readIds_('ownedLabels'), adopted = readIds_('adoptedLabels');
  (names || []).forEach(function (n) { var id = ids[n]; if (id && owned.indexOf(id) < 0) { owned.push(id); adopted.push(id); } });
  saveIds_('ownedLabels', owned); saveIds_('adoptedLabels', adopted);
}
// Labels moved: a left-over label's mail to where its card is now, a label of yours folded into a column. Per label its
// messages (spam and trash too) are listed and recorded before the first change, so a full record stops it there; then
// moved 500 at a time and the label deleted, unless labels are left under it. to: null deletes the label only if empty.
// Only Labelboard's labels and those you handed over (plan.handover) move. p.mv: the move under way; p.listed: recorded.
// Returns true when out of time.
function moveLabels_(plan, p, late) {
  var S = LabelboardSync, moves = plan.moves || [], handed = {}, list = labelList_(), byName = {};
  (plan.handover || []).forEach(function (n) { handed[n] = 1; });
  list.forEach(function (l) { byName[l.name] = l; });
  var kids = function (n) { return Object.keys(byName).some(function (x) { return x.indexOf(n + '/') === 0; }); };
  for (; p.mv < moves.length; p.mv++, p.listed = false) {
    var m = moves[p.mv], from = byName[m.from], to = m.to && byName[m.to], owned = readIds_('ownedLabels');
    if (!from) continue; // gone already (an earlier slice moved it)
    var mine = owned.indexOf(from.id) >= 0;
    if (m.to && !to || !mine && !handed[m.from]) { (p.log.skipped = p.log.skipped || []).push(m.from); continue; } // its target is gone, or it isn't Labelboard's to move
    if (!m.to) {
      var l = kids(m.from) ? null : gmail_(S.COST.labelsGet, function () { return Gmail.Users.Labels.get('me', from.id); });
      if (!l || l.threadsTotal) { (p.log.kept = p.log.kept || []).push(m.from); continue; }
      noteApply_(function (e) { e.moved.push({ from: m.from, to: null, color: from.color || null, owned: mine, ids: [], had: [] }); });
    } else {
      if (!p.listed) {
        var ids = listMessages_([from.id]), had = listMessages_([from.id, to.id]), e = readRecord_().applies.slice(-1)[0], n = S.movedCount(e || {}) + ids.length;
        if (n > S.MOVE_CAP) throw plain_(S.tooManyMoved(m.from, n));
        noteApply_(function (e) { e.moved.push({ from: m.from, to: m.to, color: from.color || null, owned: mine, ids: ids, had: had }); });
        p.listed = true;
      }
      for (var batch, last = null; (batch = listMessages_([from.id], 500)).length && batch[0] !== last; last = batch[0]) { // the same page twice: Gmail kept the label, stop
        if (late()) return true;
        gmail_(S.COST.batchModify, function () { return Gmail.Users.Messages.batchModify({ ids: batch, addLabelIds: [to.id], removeLabelIds: [from.id] }, 'me'); });
      }
      p.log.labelsMoved = (p.log.labelsMoved || 0) + 1;
    }
    if (kids(m.from)) { (p.log.kept = p.log.kept || []).push(m.from); continue; }
    try { gmail_(S.COST.labelsDelete, function () { return Gmail.Users.Labels.remove('me', from.id); }); } catch (err) { if (!notFound_(err)) throw err; }
    delete byName[m.from];
    saveIds_('ownedLabels', readIds_('ownedLabels').filter(function (x) { return x !== from.id; }));
    saveIds_('adoptedLabels', readIds_('adoptedLabels').filter(function (x) { return x !== from.id; }));
    p.log.labelsDeleted = (p.log.labelsDeleted || 0) + 1;
  }
  return false;
}
// Message ids carrying every label in labelIds (spam and trash too); max: one page of at most that many.
function listMessages_(labelIds, max) {
  var out = [], token = null;
  do {
    var page = gmail_(LabelboardSync.COST.messagesList, function () { return Gmail.Users.Messages.list('me', { labelIds: labelIds, includeSpamTrash: true, maxResults: max || 500, pageToken: token || undefined }); });
    (page.messages || []).forEach(function (m) { out.push(m.id); });
    token = page.nextPageToken;
  } while (token && !max);
  return out;
}
// Only filters Labelboard made or was handed (readOwned_) are ever deleted. Each slice re-reads Gmail's
// filters and works out what's left, so a stopped run resumes cleanly; each new id is saved at once.
// Returns true when out of time.
function syncFilters_(plan, ids, p, late) {
  var S = LabelboardSync, names = {};
  Object.keys(ids).forEach(function (n) { names[ids[n]] = n; });
  var filters = listFilters_(names), byId = {};
  filters.forEach(function (f) { byId[f.id] = f; });
  var o = readOwned_(), r = S.reconcile(o.filters, filters, o.gone);
  (plan.adopt || []).forEach(function (id) { if (byId[id]) r.owned[id] = Object.assign(S.specOf(byId[id]), { adopted: true }); }); // handed over on the board; Remove everything hands it back
  (plan.release || []).forEach(function (id) { delete r.owned[id]; }); // handed back: yours again, never touched
  var save = function (gone) { saveOwned_(r.owned, gone); };
  save(r.gone);
  var a = S.filterActions(plan.filters, filters, r.owned, r.gone, plan.restore);
  for (var i = 0; i < a.create.length; i++) {
    if (late()) return true;
    var f = a.create[i];
    var made = gmail_(S.COST.filtersCreate, function () {
      return Gmail.Users.Settings.Filters.create({ criteria: { query: f.query }, action: S.filterAction(f, ids[f.label]) }, 'me');
    });
    r.owned[made.id] = Object.assign(S.specOnly(f), { at: Date.now() }); // at: Gmail filters carry no date
    if (/^adopted:/.test(f.id || '')) r.owned[made.id].adopted = true; // an adopted filter edited on the board stays one you handed over
    save(r.gone);
    noteApply_(function (e) { e.filtersCreated.push({ id: made.id, label: f.label, archive: !!f.archive, trash: !!f.trash }); });
    p.log.filtersCreated = (p.log.filtersCreated || 0) + 1;
  }
  a.remove.forEach(function (id) {
    var s = r.owned[id];
    if (s) noteApply_(function (e) { e.filtersRemoved.push(Object.assign(S.specOnly(s), { adopted: !!s.adopted })); });
    try { gmail_(S.COST.filtersDelete, function () { return Gmail.Users.Settings.Filters.remove('me', id); }); p.log.filtersRemoved = (p.log.filtersRemoved || 0) + 1; }
    catch (e) { if (!notFound_(e)) throw e; }
    delete r.owned[id];
  });
  p.log.filtersLeftOut = a.skipped.length;
  save(a.gone);
  return false;
}
function summary_(log, plan) {
  var sorted = {}, gone = {}, read = {};
  plan.backfill.forEach(function (e) {
    e.threadIds.forEach(function (t) { sorted[t] = 1; if (e.archive) gone[t] = 1; });
    if (e.read) (e.unread || e.threadIds).forEach(function (t) { read[t] = 1; });
  });
  var n = Object.keys(sorted).length, out = Object.keys(gone).length, nr = Object.keys(read).length, later = (plan.later || []).length;
  return [log.labelsCreated && log.labelsCreated + ' labels created', log.labelsRecolored && log.labelsRecolored + ' recoloured',
    log.labelsMoved && log.labelsMoved + ' labels moved', log.labelsDeleted && log.labelsDeleted + ' old labels deleted',
    log.kept && log.kept.length + ' kept because they still hold mail or labels',
    log.skipped && log.skipped.length + ' not moved (' + log.skipped.join(', ') + '): read again and review', log.filtersCreated && log.filtersCreated + ' filters created',
    log.filtersRemoved && log.filtersRemoved + ' old filters removed', log.filtersLeftOut && log.filtersLeftOut + ' filters left out (deleted in Gmail)',
    n && n + ' threads sorted', out && out + ' left the inbox', nr && nr + ' marked read', later && 'archiving later for ' + later + (later === 1 ? ' column or card' : ' columns and cards') + ', checked every hour',
    log.missing && log.missing + ' no longer existed']
    .filter(Boolean).join(', ') || 'Nothing to change';
}

// ---------- undo: the last Apply ('last'), or everything Labelboard made ('all') ----------
// Progress lives in the record (record.undo), not the page, so a closed tab finishes where it stopped. Order:
// filters first (new mail stops being sorted), then the mail they kept out since, the threads, the labels.
// keepJson ('all'): ids of filters the board says you handed over before adopted ones were marked; handed back too.
function applyUndo(kind, keepJson) {
  var S = LabelboardSync, rec = readRecord_(), start = Date.now(), late = function () { return Date.now() - start > SLICE_MS; };
  var u = rec.undo;
  if (!u) {
    notAuto_();
    var all = kind === 'all';
    if (!all && (!rec.applies.length || rec.undone)) throw plain_('There is no Apply to undo (Undo goes back one Apply). Nothing in Gmail changed.');
    u = rec.undo = { kind: all ? 'all' : 'last', n: all ? rec.applies.length : 1, keep: all && keepJson ? JSON.parse(keepJson) : [], phase: 'filters', op: 0, log: {} };
    saveRecord_(rec);
  }
  BUDGET = u.budget || { tokens: 0, at: 0 };
  var entries = rec.applies.slice(rec.applies.length - u.n).reverse(), plan = S.planUndo(entries, u.kind === 'all');
  var names = labelNames_(), ids = {}, lid = function (n) { return n === 'INBOX' || n === 'UNREAD' ? n : ids[n]; };
  Object.keys(names).forEach(function (id) { ids[names[id]] = id; });
  var pause = function (step, steps, text) { u.budget = BUDGET; saveRecord_(rec); return JSON.stringify({ done: false, step: step, steps: steps, text: text }); };
  if (u.phase === 'filters') {
    if (undoFilters_(plan, u, names, ids, late)) return pause(0, 1, 'Taking Labelboard\'s filters out of Gmail…');
    u.phase = 'since'; saveRecord_(rec);
  }
  if (u.phase === 'since') { u.since = sinceThreads_(plan, ids, plan.since); u.trashed = sinceThreads_(plan, ids, plan.trashed || [], true); u.phase = 'unmove'; u.op = 0; saveRecord_(rec); }
  if (u.phase === 'unmove') {
    if (unmove_(plan, u, ids, late)) return pause(u.op, S.unmoveOps(plan.moves).length, 'Putting moved mail back under its labels…');
    u.phase = 'threads'; u.op = 0; saveRecord_(rec);
  }
  if (u.phase === 'threads') {
    var ops = S.undoOps(plan, u.since, u.trashed); // one call per thread with all its changes, so a stop never leaves one half done
    for (var first = u.op; u.op < ops.length;) { // at least one step per slice, so a slow start still moves on
      if (u.op > first && late()) return pause(u.op, ops.length, 'Putting your mail back: ' + u.op + ' of ' + ops.length + ' threads');
      var o = ops[u.op], body = { addLabelIds: o.add.map(lid).filter(Boolean), removeLabelIds: o.remove.map(lid).filter(Boolean) };
      if (o.untrash) untrash_(o.thread, u);
      if (body.addLabelIds.length || body.removeLabelIds.length) modifyThread_(o.thread, body, u);
      u.op++;
    }
    if (plan.later) setLater_(plan.later); // the timed rules from before (none for 'all')
    u.phase = 'labels'; u.op = 0; saveRecord_(rec);
  }
  if (undoLabels_(plan, u, ids, late)) return pause(1, 1, 'Deleting the labels Labelboard made…');
  var summary = undoSummary_(u, plan);
  rec.applies = rec.applies.slice(0, rec.applies.length - u.n);
  rec.undone = { at: Date.now(), kind: u.kind, summary: summary };
  delete rec.undo; saveRecord_(rec);
  return JSON.stringify({ done: true, summary: summary });
}
// Labelboard's filters from these Applies are deleted (all of them for 'all'), the ones the last Apply removed are
// made again, and filters you handed over go back to you untouched. Each slice re-reads Gmail, so repeats are safe.
// A filter you edited in Gmail since is yours (reconcile) and stays. True when out of time.
function undoFilters_(plan, u, names, ids, late) {
  var S = LabelboardSync, filters = listFilters_(names), live = {}, have = {};
  filters.forEach(function (f) { live[f.id] = 1; have[S.filterKey(f)] = 1; });
  var o = readOwned_(), r = S.reconcile(o.filters, filters, o.gone), owned = r.owned, save = function () { saveOwned_(owned, r.gone); };
  var all = u.kind === 'all', back = plan.filters.handBack.concat(u.keep || []), count = function (k) { u.log[k] = (u.log[k] || 0) + 1; };
  Object.keys(owned).forEach(function (id) { if (back.indexOf(id) >= 0 || all && owned[id].adopted) { delete owned[id]; count('handedBack'); } });
  save();
  var drop = all ? Object.keys(owned) : plan.filters.remove.filter(function (id) { return id in owned; });
  var steps = 0; // at least one per slice
  for (var i = 0; i < drop.length; i++) {
    if (steps++ && late()) return true;
    var id = drop[i];
    if (live[id]) {
      try { gmail_(S.COST.filtersDelete, function () { return Gmail.Users.Settings.Filters.remove('me', id); }); count('filtersDeleted'); }
      catch (e) { if (!notFound_(e)) throw e; }
    }
    delete owned[id]; save();
  }
  for (var j = 0; j < plan.filters.restore.length; j++) {
    var s = plan.filters.restore[j];
    if (have[S.specKey(s)] || !ids[s.label]) continue; // already back (an earlier slice), or its label is gone
    if (steps++ && late()) return true;
    var made = gmail_(S.COST.filtersCreate, function () {
      return Gmail.Users.Settings.Filters.create({ criteria: { query: s.query }, action: S.filterAction(s, ids[s.label]) }, 'me');
    });
    owned[made.id] = Object.assign({}, s, { at: Date.now() }); have[S.specKey(s)] = 1; save(); count('filtersRestored');
  }
  return false;
}
// Mail a filter from these Applies kept out of the inbox since then: Gmail's own search, label by label (trash: the
// mail a deleting filter put in the trash).
function sinceThreads_(plan, ids, labels, trash) {
  var out = [];
  labels.forEach(function (name) {
    if (ids[name]) listThreads_({ labelIds: [ids[name]], q: LabelboardSync.sinceQuery(plan.after, trash), includeSpamTrash: !!trash }).forEach(function (t) { out.push(t.id); });
  });
  return out;
}
// Labels moved come back: one deleted is made again, parents first (its colour; Labelboard's again only if it was), then
// each moved message gets it back and loses the label it moved to, unless it had that one already. True when out of time.
function unmove_(plan, u, ids, late) {
  var S = LabelboardSync, ops = S.unmoveOps(plan.moves);
  if (!u.made) {
    var owned = readIds_('ownedLabels'), by = {};
    plan.moves.forEach(function (m) { if (!ids[m.from] && !by[m.from]) by[m.from] = m; });
    Object.keys(by).sort(function (a, b) { return a.split('/').length - b.split('/').length || a.localeCompare(b); }).forEach(function (n) {
      var body = { name: n, labelListVisibility: 'labelShow', messageListVisibility: 'show' };
      if (by[n].color) body.color = by[n].color;
      ids[n] = gmail_(S.COST.labelsCreate, function () { return Gmail.Users.Labels.create(body, 'me'); }).id;
      if (by[n].owned) { owned.push(ids[n]); saveIds_('ownedLabels', owned); }
      u.log.labelsBack = (u.log.labelsBack || 0) + 1;
    });
    u.made = true;
  }
  for (var first = u.op; u.op < ops.length; u.op++) {
    if (u.op > first && late()) return true;
    var o = ops[u.op], add = ids[o.from] ? [ids[o.from]] : [], rm = !o.keepTo && ids[o.to] ? [ids[o.to]] : [];
    if (!add.length && !rm.length) continue;
    try { gmail_(S.COST.batchModify, function () { return Gmail.Users.Messages.batchModify({ ids: o.ids, addLabelIds: add, removeLabelIds: rm }, 'me'); }); }
    catch (e) {
      if (!notFound_(e) && !/invalid/i.test(String(e))) throw e;
      o.ids.forEach(function (id) { // a message deleted since: one at a time, skipping the gone
        try { gmail_(S.COST.messagesModify, function () { return Gmail.Users.Messages.modify({ addLabelIds: add, removeLabelIds: rm }, 'me', id); }); }
        catch (x) { if (!notFound_(x)) throw x; u.log.missing = (u.log.missing || 0) + 1; }
      });
    }
  }
  return false;
}
function untrash_(t, p) {
  try { gmail_(LabelboardSync.COST.threadsModify, function () { return Gmail.Users.Threads.untrash('me', t); }); }
  catch (e) { if (!notFound_(e)) throw e; p.log.missing = (p.log.missing || 0) + 1; }
}
// Colours go back (only where there was one: unchecked whether Gmail can clear a colour), then labels Labelboard
// created are deleted once empty, children first ('all': every label it created). One still holding mail stays.
function undoLabels_(plan, u, ids, late) {
  var S = LabelboardSync, owned = readIds_('ownedLabels'), count = function (k) { u.log[k] = (u.log[k] || 0) + 1; };
  if (!u.handed) { // labels of yours taken as they are go back to you first, so they are never deleted below
    var adopted = readIds_('adoptedLabels'), back = u.kind === 'all' ? adopted : plan.handBack.map(function (n) { return ids[n]; }).filter(function (id) { return id && adopted.indexOf(id) >= 0; });
    owned = owned.filter(function (id) { return back.indexOf(id) < 0; });
    saveIds_('ownedLabels', owned); saveIds_('adoptedLabels', adopted.filter(function (id) { return back.indexOf(id) < 0; }));
    u.log.labelsHandedBack = back.length; u.handed = true;
  }
  if (!u.colors) {
    Object.keys(plan.colors).forEach(function (n) {
      var c = plan.colors[n]; if (!c || !ids[n]) return;
      try { gmail_(S.COST.labelsPatch, function () { return Gmail.Users.Labels.patch({ color: c }, 'me', ids[n]); }); } catch (e) { if (!notFound_(e)) throw e; }
    });
    u.colors = true;
  }
  // the list is fixed when the step starts: deleting labels must not shift the index a stopped run resumes from
  var list = u.labels = u.labels || (u.kind === 'all' ? S.childrenFirst(Object.keys(ids).filter(function (n) { return owned.indexOf(ids[n]) >= 0; })) : plan.labels);
  for (var first = u.op; u.op < list.length; u.op++) {
    if (u.op > first && late()) return true;
    var n = list[u.op], id = ids[n];
    if (!id || owned.indexOf(id) < 0) continue; // gone already, or not Labelboard's
    var kids = Object.keys(ids).some(function (x) { return x.indexOf(n + '/') === 0; });
    var l = kids ? null : gmail_(S.COST.labelsGet, function () { return Gmail.Users.Labels.get('me', id); });
    if (!l || l.threadsTotal) { (u.log.kept = u.log.kept || []).push(n); continue; }
    try { gmail_(S.COST.labelsDelete, function () { return Gmail.Users.Labels.remove('me', id); }); } catch (e) { if (!notFound_(e)) throw e; }
    owned = owned.filter(function (x) { return x !== id; }); PROPS.setProperty('ownedLabels', JSON.stringify(owned));
    delete ids[n]; count('labelsDeleted');
  }
  return false;
}
function undoSummary_(u, plan) {
  var c = LabelboardSync.undoCounts(plan), log = u.log, since = (u.since || []).concat(u.trashed || []).filter(function (t) { return !plan.threads.some(function (o) { return o.thread === t; }); }).length;
  var many = function (n, one, more) { return n + ' ' + (n === 1 ? one : more); }, kept = log.kept || [];
  return (u.kind === 'all' ? 'Removed what Labelboard made: ' : 'Apply undone: ') + [
    log.filtersDeleted && many(log.filtersDeleted, 'filter', 'filters') + ' deleted', log.filtersRestored && log.filtersRestored + ' made again',
    log.handedBack && many(log.handedBack, 'filter', 'filters') + ' handed back to you', c.unlabel && many(c.unlabel, 'thread', 'threads') + ' unlabelled',
    c.inbox + since && (c.inbox + since) + ' back in your inbox', c.unread && c.unread + ' unread again', c.relabel && many(c.relabel, 'thread', 'threads') + ' got a label back',
    c.moved && many(c.moved, 'label', 'labels') + ' moved back', log.labelsBack && many(log.labelsBack, 'label', 'labels') + ' made again',
    log.labelsHandedBack && many(log.labelsHandedBack, 'label', 'labels') + ' handed back to you',
    log.labelsDeleted && many(log.labelsDeleted, 'label', 'labels') + ' deleted', kept.length && many(kept.length, 'label', 'labels') + ' kept because ' + (kept.length === 1 ? 'it still holds' : 'they still hold') + ' mail (' + kept.join(', ') + ')',
    log.missing && log.missing + ' no longer existed'].filter(Boolean).join(', ') || 'Nothing to change';
}
