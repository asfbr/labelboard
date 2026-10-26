// Labelboard sync helpers — pure JS, no Apps Script APIs. Used by Code.js, the local preview and Node tests:
// quota pacing, the incremental inbox read, bulk apply, and ownership of Gmail filters (adopt, drift).
var LabelboardSync = (function () {
  'use strict';

  // ---------- quota: 6,000 units/min per user (Gmail API), we aim for 90% ----------
  // Units per call, from developers.google.com/workspace/gmail/api/reference/quota (labels.patch is not listed: 5 assumed).
  var COST = { getProfile: 1, historyList: 2, threadsGet: 40, threadsList: 10, messagesList: 5, threadsModify: 10, messagesModify: 5, batchModify: 50, labelsList: 1, labelsGet: 1, labelsCreate: 5, labelsPatch: 5, labelsDelete: 5, filtersList: 1, filtersCreate: 5, filtersDelete: 5 };
  // Token bucket: refills RATE units/s up to BURST, so any 60 s window spends at most BURST + 60·RATE
  // (400 + 5,400 < 6,000). Its state is plain JSON that rides in the cursor between slices (why: docs/CLAUDE-PROSE.md).
  var RATE = 6000 * 0.9 / 60, BURST = 400;
  // Takes `cost` units from bucket b ({tokens, at}, mutated) and returns how long to sleep first (ms).
  function budgetWait(b, cost, now) {
    b.tokens = b.at ? Math.min(BURST, b.tokens + Math.max(0, now - b.at) / 1000 * RATE) : BURST;
    b.at = now;
    var wait = b.tokens >= cost ? 0 : Math.ceil((cost - b.tokens) / RATE * 1000);
    b.tokens -= cost; // below zero until the sleep pays it back
    return wait;
  }

  // ---------- incremental read ----------
  // Gmail's change log since the last read (history.list) says what changed per thread: a new or deleted
  // message, or a label you can't tell from one message (INBOX, your labels) → fetch again; a label
  // added → patched in place; read/star/importance/tab → patched, never fetched (they don't sort mail).
  var PATCH_ONLY = /^(UNREAD|STARRED|IMPORTANT|CATEGORY_\w+)$/;
  function historyChanges(records) {
    var fetch = {}, add = {}, rm = {};
    var push = function (map, t, ids) { (map[t] = map[t] || []).push.apply(map[t], ids); };
    (records || []).forEach(function (h) {
      (h.messagesAdded || []).concat(h.messagesDeleted || []).forEach(function (x) { fetch[x.message.threadId] = 1; });
      (h.labelsAdded || []).forEach(function (x) { push(add, x.message.threadId, x.labelIds || []); });
      (h.labelsRemoved || []).forEach(function (x) {
        var ids = x.labelIds || [], t = x.message.threadId;
        if (ids.every(function (l) { return PATCH_ONLY.test(l); })) push(rm, t, ids); else fetch[t] = 1;
      });
    });
    return { fetch: fetch, add: add, remove: rm };
  }
  // listed: [{id, historyId}] from threads.list; unlisted threads left the inbox. With `changes`
  // (historyChanges) only threads it flags are fetched. Without a log (it lasts about a week; an older
  // snapshot): a thread whose historyId moved is fetched if `newMail` (threadId → 1, mail since the last
  // read) has it, else kept as `changed` for its labels to be redone, unless listing your nLabels labels
  // costs more than fetching those threads. No newMail either: every moved thread is fetched.
  function diffInbox(stored, listed, changes, newMail, nLabels) {
    var old = {}, seen = {}, keep = [], fetch = [], changed = [];
    (stored || []).forEach(function (t) { old[t.id] = t; });
    listed.forEach(function (x) {
      if (seen[x.id]) return; seen[x.id] = 1;
      var o = old[x.id];
      if (!o) return fetch.push(x.id);
      if (changes) return (changes.fetch[x.id] ? fetch : keep).push(x.id);
      if (o.historyId && String(o.historyId) === String(x.historyId)) return keep.push(x.id);
      if (!newMail || newMail[x.id]) return fetch.push(x.id);
      keep.push(x.id); changed.push(x.id);
    });
    if (changed.length * COST.threadsGet <= (nLabels || 0) * COST.threadsList) {
      var c = {}; changed.forEach(function (id) { c[id] = 1; });
      keep = keep.filter(function (id) { return !c[id]; }); fetch = fetch.concat(changed); changed = [];
    }
    return { keep: keep, fetch: fetch, changed: changed, dropped: (stored || []).filter(function (t) { return !seen[t.id]; }).length };
  }
  // byLabel: {name: [threadIds]} from listing each of your labels → the labels each changed thread has now.
  function relabel(changed, byLabel) {
    var out = {};
    changed.forEach(function (id) { out[id] = []; });
    Object.keys(byLabel).forEach(function (name) { byLabel[name].forEach(function (id) { if (out[id]) out[id].push(name); }); });
    return out;
  }
  // changes/names (label id → name) patch the kept records' labels; fetched records replace theirs.
  // relabeled = {labels: [all your label names], threads: relabel()}: those threads' own labels are
  // replaced, system ones (INBOX, SENT, CATEGORY_…) stay as read.
  function mergeInbox(stored, keep, fetched, changes, names, relabeled) {
    var old = {}, ch = changes || { add: {}, remove: {} }, nm = function (l) { return (names || {})[l] || l; };
    var re = relabeled || { labels: [], threads: {} }, mine = {};
    re.labels.forEach(function (l) { mine[l] = 1; });
    (stored || []).forEach(function (t) { old[t.id] = t; });
    var kept = keep.map(function (id) {
      var t = old[id];
      if (t && re.threads[id]) return Object.assign({}, t, { labels: t.labels.filter(function (l) { return !mine[l]; }).concat(re.threads[id]) });
      if (!t || !(ch.add[id] || ch.remove[id])) return t;
      var set = {};
      t.labels.forEach(function (l) { set[l] = 1; });
      (ch.add[id] || []).forEach(function (l) { set[nm(l)] = 1; });
      (ch.remove[id] || []).forEach(function (l) { delete set[nm(l)]; });
      return Object.assign({}, t, { labels: Object.keys(set) });
    });
    return kept.concat(fetched).filter(Boolean).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  // ---------- the window: the last 30 days of mail outside the inbox (archived by you or a filter, sent) ----------
  // Every category counts: group mail a filter archives often sits in Forums. Spam and trash are never listed.
  // `days` shrinks when the window doesn't fit in storage (windowShrink).
  var WINDOW_DAYS = 30;
  // User properties hold 500 KB for everything; a thread costs ~160 bytes compressed (measured Oct 2026),
  // so the inbox alone stops around 2,900. Reading more would run for an hour and die on the save (ROADMAP: big inboxes).
  var INBOX_CAP = 2500;
  function tooBig(n) {
    return 'Your inbox has ' + n.toLocaleString('en-US') + ' threads; Labelboard\'s storage in Apps Script holds about ' + INBOX_CAP.toLocaleString('en-US') +
      '. Nothing in Gmail changed. Archive or delete older inbox mail in Gmail, then read again.';
  }
  function windowQuery(days) { return 'newer_than:' + (days || WINDOW_DAYS) + 'd -in:chats'; }
  // Too big to store: half the days, keeping the threads active since then. null below 2 days.
  function windowShrink(threads, days, now) {
    var d = Math.floor(days / 2); if (d < 2) return null;
    var since = new Date(now - d * 864e5).toISOString();
    return { days: d, since: since, threads: threads.filter(function (t) { return t.date >= since; }) };
  }
  // A thread's messages as [[epoch seconds, 1 if yours (SENT)]], oldest first; drafts aren't messages yet.
  function timeline(msgs) {
    return (msgs || []).filter(function (m) { return (m.labelIds || []).indexOf('DRAFT') < 0; })
      .map(function (m) { return [Math.round(Number(m.internalDate) / 1000), (m.labelIds || []).indexOf('SENT') >= 0 ? 1 : 0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
  }
  // Records read before timelines existed: those active since `since` (ISO) are fetched again once, so
  // their replies count. d is diffInbox()'s result.
  function addTimelines(d, stored, since) {
    var need = {}, n = 0;
    (stored || []).forEach(function (t) { if (!t.msgs && t.date >= since) { need[t.id] = 1; n++; } });
    if (!n) return d;
    var keep = [], fetch = d.fetch.slice();
    d.keep.forEach(function (id) { (need[id] ? fetch : keep).push(id); });
    return Object.assign({}, d, { keep: keep, fetch: fetch, changed: d.changed.filter(function (id) { return !need[id]; }) });
  }
  // The inbox listing decides what is the snapshot; the rest of the window is kept apart (blob `recent`),
  // without snippets. The board builds cards over both; counts, backfill and re-sort stay on the inbox.
  function splitWindow(threads, inboxIds) {
    var inbox = {}, out = { inbox: [], window: [] };
    inboxIds.forEach(function (id) { inbox[id] = 1; });
    threads.forEach(function (t) {
      if (inbox[t.id]) return out.inbox.push(t);
      var w = Object.assign({}, t); delete w.snippet; out.window.push(w);
    });
    return out;
  }

  // ---------- archiving later (rules.js laterRules, run hourly by Code.js runLater) ----------
  // Gmail's older_than and is:unread look at single messages, so a thread with a fresh reply still matches:
  // archive the candidates minus every thread with a message too new, or unread. Returns [candidates, fresh] searches.
  function laterQueries(rule, q) {
    var base = 'in:inbox ' + q;
    return rule.days ? [base + ' older_than:' + rule.days + 'd', base + ' newer_than:' + rule.days + 'd'] : [base + ' -is:unread', base + ' is:unread'];
  }
  function laterIds(cand, fresh) {
    var skip = {}; fresh.forEach(function (t) { skip[t] = 1; });
    return cand.filter(function (t) { return !skip[t] && (skip[t] = 1); });
  }

  // ---------- bulk apply ----------
  // One messages.batchModify (50 units, ≤1000 ids) per label used by ≥ minBatch threads, threads.modify
  // (10 units) per thread for the rest and for every label removal (a label also sits on your sent replies,
  // which aren't inbox messages); archiving last, so a stopped run never leaves mail archived without its
  // label. msgs: threadId → its inbox message ids, listed at apply time. minBatch = 5: docs/CLAUDE-PROSE.md.
  function applyOps(backfill, unlabel, ids, msgs, minBatch) {
    minBatch = minBatch || 5;
    var adds = {}, rms = {}, arch = [], read = [], single = {}, singleOrder = [], ops = [];
    var has = function (t) { return !!(msgs[t] && msgs[t].length); };
    var one = function (t) { if (!single[t]) { single[t] = { thread: t, add: [], remove: [] }; singleOrder.push(t); } return single[t]; };
    (backfill || []).forEach(function (e) {
      e.threadIds.forEach(function (t) { (adds[e.label] = adds[e.label] || []).push(t); if (e.archive && arch.indexOf(t) < 0) arch.push(t); });
      (e.read ? e.unread || e.threadIds : []).forEach(function (t) { if (read.indexOf(t) < 0) read.push(t); }); // marked read: only those unread now
    });
    (unlabel || []).forEach(function (e) { rms[e.label] = (rms[e.label] || []).concat(e.threadIds); });
    Object.keys(adds).sort().forEach(function (l) {
      var id = ids[l]; if (!id) return;
      var ts = adds[l], live = ts.filter(has);
      if (live.length < minBatch) live = [];
      batches(live).forEach(function (b) { b.add = [id]; b.remove = []; ops.push(b); });
      ts.filter(function (t) { return live.indexOf(t) < 0; }).forEach(function (t) { one(t).add.push(id); });
    });
    Object.keys(rms).sort().forEach(function (l) { var id = ids[l]; if (id) rms[l].forEach(function (t) { one(t).remove.push(id); }); });
    function batches(ts) {
      var out = [], cur = null;
      ts.forEach(function (t) {
        if (!cur || cur.ids.length + msgs[t].length > 1000) out.push(cur = { ids: [], threads: [] });
        cur.ids = cur.ids.concat(msgs[t].slice(0, 1000)); cur.threads.push(t);
      });
      return out;
    }
    var readLive = read.filter(has), readBatch = readLive.length >= minBatch;
    if (!readBatch) readLive.forEach(function (t) { one(t).remove.push('UNREAD'); });
    var archLive = arch.filter(has), archBatch = archLive.length >= minBatch;
    if (!archBatch) archLive.forEach(function (t) { one(t).remove.push('INBOX'); });
    singleOrder.forEach(function (t) { ops.push(single[t]); });
    if (readBatch) batches(readLive).forEach(function (b) { b.add = []; b.remove = ['UNREAD']; ops.push(b); });
    if (archBatch) batches(archLive).forEach(function (b) { b.add = []; b.remove = ['INBOX']; ops.push(b); });
    return ops;
  }

  // ---------- Gmail filters: canonical form, ownership, drift ----------
  // One search string per filter whatever criteria fields it uses. Labelboard's own filters only set
  // `query`, so theirs come back unchanged and keep matching the board's plan.
  function criteriaQuery(c) {
    c = c || {};
    var g = function (v) { return /\s/.test(v) ? '(' + v + ')' : v; }, q = [];
    if (c.from) q.push('from:' + g(c.from));
    if (c.to) q.push('to:' + g(c.to));
    if (c.subject) q.push('subject:' + g(c.subject));
    if (c.query) q.push(c.query);
    if (c.negatedQuery) q.push('-(' + c.negatedQuery + ')');
    if (c.hasAttachment) q.push('has:attachment');
    if (c.size) q.push((c.sizeComparison === 'smaller' ? 'smaller:' : 'larger:') + c.size);
    return q.join(' ');
  }
  var ADDS = { STARRED: 'stars it', IMPORTANT: 'marks it important', TRASH: 'deletes it' };
  var REMOVES = { UNREAD: 'marks it read', IMPORTANT: 'never marks it important', SPAM: 'never sends it to spam' };
  // The actions a card can set (rules.js cardDoes), as Gmail label ids: [on add, on remove, value].
  var ACT_IDS = { read: [null, 'UNREAD', true], star: ['STARRED', null, true], trash: ['TRASH', null, true] };
  // A Gmail filter as the board shows it: labels by name, skip-inbox, anything else it does in words (extras),
  // the card actions among those (acts) and the rest (other: a forward, a tab, never spam).
  function normFilter(f, names) {
    var a = f.action || {}, labels = [], extras = [], acts = {}, other = [];
    (a.addLabelIds || []).forEach(function (id) {
      if (ADDS[id]) { extras.push(ADDS[id]); if (id === 'IMPORTANT') acts.important = 'always'; else acts[id === 'STARRED' ? 'star' : 'trash'] = true; }
      else if (/^CATEGORY_/.test(id)) { extras.push('files it under ' + id.slice(9).toLowerCase()); other.push(extras[extras.length - 1]); }
      else labels.push(names[id] || id);
    });
    (a.removeLabelIds || []).forEach(function (id) {
      if (!REMOVES[id]) return;
      extras.push(REMOVES[id]);
      if (id === 'UNREAD') acts.read = true; else if (id === 'IMPORTANT') acts.important = 'never'; else other.push(REMOVES[id]);
    });
    if (a.forward) { extras.push('forwards it to ' + a.forward); other.push(extras[extras.length - 1]); }
    return { id: f.id, query: criteriaQuery(f.criteria), labels: labels, archive: (a.removeLabelIds || []).indexOf('INBOX') >= 0, extras: extras, acts: acts, other: other };
  }
  // What a plan filter (or a recorded spec) asks Gmail to do, with its label's id.
  function filterAction(s, labelId) {
    var add = labelId ? [labelId] : [], rm = s.archive ? ['INBOX'] : [];
    Object.keys(ACT_IDS).forEach(function (k) { var x = ACT_IDS[k]; if (s[k]) { if (x[0]) add.push(x[0]); if (x[1]) rm.push(x[1]); } });
    if (s.important === 'always') add.push('IMPORTANT'); else if (s.important === 'never') rm.push('IMPORTANT');
    return { addLabelIds: add, removeLabelIds: rm };
  }
  // spec = {query, label, archive, read?, star?, important?, trash?}: a plan filter, or what Labelboard recorded
  // when it made one. A spec with no card actions keys as it always did, so those filters stay put.
  function actKey(s) { return (s.read ? 'r' : '') + (s.star ? 's' : '') + (s.important ? 'i' + s.important : '') + (s.trash ? 't' : ''); }
  function specKey(s) { var k = actKey(s); return s.query + '|' + (s.label || '') + '|' + (s.archive ? 1 : 0) + (k ? '|' + k : ''); }
  function filterKey(f) {
    var other = f.other || f.extras; // a filter read before acts/other existed: every extra is "other"
    return specKey(Object.assign({}, f.other ? f.acts : {}, { query: f.query, label: f.labels.join(',') + (other.length ? '+' + other.join(',') : ''), archive: f.archive }));
  }
  function specOf(f) { return Object.assign(pickActs(f.acts || {}), { query: f.query, label: f.labels.join(','), archive: f.archive }); }
  function pickActs(s) { var o = {}; ['read', 'star', 'important', 'trash'].forEach(function (k) { if (s[k]) o[k] = s[k]; }); return o; }
  // A spec without what rides along with it (at, adopted, why…), for the records.
  function specOnly(s) { return Object.assign(pickActs(s), { query: s.query, label: s.label, archive: !!s.archive }); }
  // Owned filters: { id: spec } for filters Labelboard made or was handed (Code.js readOwned_). The first
  // version kept a bare id list; those ids get their spec from Gmail the next time they're seen.
  function readOwned(json) {
    var o = JSON.parse(json || '{}'), m = {};
    if (!Array.isArray(o)) return o;
    o.forEach(function (id) { m[id] = null; });
    return m;
  }
  // Owned filters deleted or edited in Gmail are not silently redone: their spec goes to `gone` (left out
  // of Apply until you restore it) and an edited one becomes yours. filters: normFilter() list.
  function reconcile(owned, filters, gone) {
    var byId = {}, next = {}, out = (gone || []).slice(), released = [];
    filters.forEach(function (f) { byId[f.id] = f; });
    Object.keys(owned).forEach(function (id) {
      var s = owned[id], f = byId[id];
      if (f && (!s || filterKey(f) === specKey(s))) { next[id] = s || specOf(f); return; }
      if (f) released.push(id);
      if (s && !out.some(function (x) { return specKey(x) === specKey(s); })) out.push(Object.assign(specOnly(s), { why: f ? 'edited' : 'deleted' }));
    });
    return { owned: next, gone: out, released: released };
  }
  // What Apply does to filters. plan: specs; restore: keys of gone specs to bring back. Plan filters equal
  // to one already in Gmail (yours or Labelboard's) are kept as they are; owned ones not in the plan go.
  function filterActions(plan, filters, owned, gone, restore) {
    var have = {}, keepIds = {}, goneKey = {}, back = {}, create = [], skipped = [], inPlan = {};
    filters.forEach(function (f) { var k = filterKey(f); if (!have[k]) have[k] = f.id; });
    (gone || []).forEach(function (s) { goneKey[specKey(s)] = 1; });
    (restore || []).forEach(function (k) { back[k] = 1; });
    plan.forEach(function (p) {
      var k = specKey(p); inPlan[k] = 1;
      if (have[k]) keepIds[have[k]] = 1;
      else if (goneKey[k] && !back[k]) skipped.push(p);
      else create.push(p);
    });
    var live = {}; filters.forEach(function (f) { live[f.id] = 1; });
    return {
      create: create, skipped: skipped,
      remove: Object.keys(owned).filter(function (id) { return live[id] && !keepIds[id]; }),
      gone: (gone || []).filter(function (s) { var k = specKey(s); return inPlan[k] && !back[k]; }),
    };
  }

  // Where the plan's filters stand in Gmail, per label: { want, create, remove, skipped }, plus the actions.
  // live: normFilter() list with .owned, as read on load; adopt / release: ids handed over / back on Apply.
  function filterStatus(plan, live, gone, adopt, release, restore) {
    var owned = {}, byId = {}, byLabel = {};
    live.forEach(function (f) { byId[f.id] = f; if (f.owned || (adopt || []).indexOf(f.id) >= 0) owned[f.id] = specOf(f); });
    (release || []).forEach(function (id) { delete owned[id]; });
    var fa = filterActions(plan, live, owned, gone || [], restore);
    var at = function (l) { return byLabel[l] = byLabel[l] || { want: 0, create: 0, remove: 0, skipped: 0 }; };
    plan.forEach(function (p) { at(p.label).want++; });
    fa.create.forEach(function (p) { at(p.label).create++; });
    fa.skipped.forEach(function (p) { at(p.label).skipped++; });
    fa.remove.forEach(function (id) { at(byId[id].labels.join(',')).remove++; });
    return { byLabel: byLabel, actions: fa };
  }
  // One word for a label's (or a column's summed) counts: live, new, change, gone (all removed), out (left out), none.
  function filterState(s) {
    if (!s || !s.want && !s.remove) return 'none';
    if (!s.want) return 'gone';
    if (!s.create && !s.remove) return s.skipped ? 'out' : 'live';
    return !s.remove && !s.skipped && s.create === s.want ? 'new' : 'change';
  }

  // ---------- the apply record and undo (docs/ARCHITECTURE.md → Undo) ----------
  // An Apply's entry, by label name, written before its first Gmail write: threads it labels (a backfill entry's
  // `had` = ids that already carried the label: those only leave the inbox), threads it archives, labels re-sort
  // took off. Code.js adds the filters and labels as it makes them.
  // `read`: threads it marked read (they were unread). Labelboard's timed rules before it (`later`, set by Code.js) go back on undo.
  function recordApply(plan, at) {
    var labelled = {}, archived = {}, unlabeled = {}, read = {};
    (plan.backfill || []).forEach(function (e) {
      var had = {}; (e.had || []).forEach(function (t) { had[t] = 1; });
      var ids = e.threadIds.filter(function (t) { return !had[t]; });
      if (ids.length) labelled[e.label] = (labelled[e.label] || []).concat(ids);
      if (e.archive) e.threadIds.forEach(function (t) { archived[t] = 1; });
      if (e.read) (e.unread || e.threadIds).forEach(function (t) { read[t] = 1; });
    });
    (plan.unlabel || []).forEach(function (e) { unlabeled[e.label] = (unlabeled[e.label] || []).concat(e.threadIds); });
    return { at: at, done: false, labelled: labelled, archived: Object.keys(archived), read: Object.keys(read), unlabeled: unlabeled,
      labelsCreated: [], recolored: {}, filtersCreated: [], filtersRemoved: [], adopted: (plan.adopt || []).slice(), labelsAdopted: (plan.adoptLabels || []).slice(), moved: [] };
  }
  // An Apply run again after it stopped adds to the stopped one's entry: one Apply, one undo.
  function mergeRecord(a, b) {
    var ids = function (x, y) { var s = {}; (x || []).concat(y || []).forEach(function (t) { s[t] = 1; }); return Object.keys(s); };
    var map = function (x, y) { var o = {}; Object.keys(x).concat(Object.keys(y)).forEach(function (l) { o[l] = ids(x[l] || [], y[l] || []); }); return o; };
    return Object.assign({}, a, { labelled: map(a.labelled, b.labelled), unlabeled: map(a.unlabeled, b.unlabeled), archived: ids(a.archived, b.archived), read: ids(a.read, b.read), adopted: ids(a.adopted, b.adopted),
      labelsAdopted: ids(a.labelsAdopted, b.labelsAdopted) });
  }
  // A moved label's message ids ride in the record so the move can be undone; past this many in one Apply the record
  // would crowd the 500 KB of storage, so Apply stops before moving more (about 17 bytes an id).
  var MOVE_CAP = 4000;
  function movedCount(e) { return (e.moved || []).reduce(function (n, m) { return n + m.ids.length; }, 0); }
  function tooManyMoved(label, n) {
    return 'Moving the mail under ' + label + ' would take Labelboard past the ' + MOVE_CAP.toLocaleString('en-US') + ' messages it can keep an undo for in one Apply (' +
      n.toLocaleString('en-US') + ' with it). What was done so far stays done; nothing else changed. Apply again to carry on with the rest, or keep that label as yours.';
  }
  // The undo of moved labels as batch calls (≤ 1000 ids each): a moved message gets its label back and loses the one
  // it moved to, unless it had that one already (had). moves: planUndo's, newest first.
  function unmoveOps(moves) {
    var ops = [];
    (moves || []).forEach(function (m) {
      var had = {}; (m.had || []).forEach(function (id) { had[id] = 1; });
      var push = function (list, keepTo) { for (var i = 0; i < list.length; i += 1000) ops.push({ from: m.from, to: m.to, ids: list.slice(i, i + 1000), keepTo: keepTo }); };
      push(m.ids.filter(function (id) { return !had[id]; }), false);
      push(m.ids.filter(function (id) { return had[id]; }), true);
    });
    return ops;
  }
  function childrenFirst(names) { var d = function (l) { return l.split('/').length; }; return names.slice().sort(function (a, b) { return d(b) - d(a) || a.localeCompare(b); }); }
  // Undoing entries, newest first: each reverses one Apply, so per thread and label the oldest wins.
  // threads: [{thread, add, remove}] by name ('INBOX' puts it back), sorted so a stopped undo resumes by index.
  // filters: ids made (deleted), specs the last Apply removed (made again; none for `all`), ids handed over (given back).
  // labels: created ones, children first (deleted once empty); colors: a label's colour before Labelboard's.
  // since/after: labels whose new filter skips the inbox, and from when (mail they kept out goes back); trashed: labels
  // whose new filter deletes, whose mail comes out of the trash. later: the timed rules to put back (oldest entry's).
  // moves: labels moved, newest first (unmoveOps); handBack: labels of yours Labelboard took as they are (yours again).
  function planUndo(entries, all) {
    var by = {}, colors = {}, created = {}, since = {}, trashed = {}, made = [], back = {}, later = null, moves = [], handBack = {};
    var set = function (t, l, v) { (by[t] = by[t] || {})[l] = v; };
    entries.forEach(function (e) {
      Object.keys(e.labelled || {}).forEach(function (l) { e.labelled[l].forEach(function (t) { set(t, l, 0); }); });
      Object.keys(e.unlabeled || {}).forEach(function (l) { e.unlabeled[l].forEach(function (t) { set(t, l, 1); }); });
      (e.archived || []).forEach(function (t) { set(t, 'INBOX', 1); });
      (e.read || []).forEach(function (t) { set(t, 'UNREAD', 1); });
      Object.keys(e.recolored || {}).forEach(function (l) { colors[l] = e.recolored[l]; });
      (e.labelsCreated || []).forEach(function (l) { created[l] = 1; });
      (e.filtersCreated || []).forEach(function (f) { made.push(f.id); if (f.trash) trashed[f.label] = 1; else if (f.archive) since[f.label] = 1; });
      (e.adopted || []).forEach(function (id) { back[id] = 1; });
      (e.labelsAdopted || []).forEach(function (l) { handBack[l] = 1; });
      moves = moves.concat((e.moved || []).slice().reverse());
      if ('later' in e) later = e.later;
    });
    var threads = Object.keys(by).sort().map(function (t) {
      var o = { thread: t, add: [], remove: [] };
      Object.keys(by[t]).sort().forEach(function (l) { (by[t][l] ? o.add : o.remove).push(l); });
      return o;
    });
    return { threads: threads, filters: { remove: made, restore: !all && entries.length ? (entries[0].filtersRemoved || []).slice() : [], handBack: Object.keys(back) },
      labels: childrenFirst(Object.keys(created)), colors: colors, since: Object.keys(since).sort(), trashed: Object.keys(trashed).sort(),
      after: entries.length ? Math.min.apply(null, entries.map(function (e) { return e.at; })) : 0, later: all ? [] : later,
      moves: moves, handBack: Object.keys(handBack).sort() };
  }
  // Gmail's search for mail a filter kept out of the inbox since `at` (ms), run on one label; trash: mail it deleted.
  function sinceQuery(at, trash) { return (trash ? 'in:trash' : '-in:inbox') + ' after:' + Math.floor(at / 1000); }
  // The undo's thread steps: the plan's, then mail found by sinceQuery that the record doesn't hold (back in the inbox,
  // label kept; out of the trash first for trashIds).
  function undoOps(plan, sinceIds, trashIds) {
    var ops = plan.threads.slice(), seen = {}, bin = {};
    ops.forEach(function (o) { seen[o.thread] = 1; });
    (trashIds || []).forEach(function (t) { bin[t] = 1; });
    (sinceIds || []).concat(trashIds || []).sort().forEach(function (t) {
      if (seen[t]) return; seen[t] = 1;
      var o = { thread: t, add: ['INBOX'], remove: [] }; if (bin[t]) o.untrash = true; ops.push(o);
    });
    return ops;
  }
  // The board's estimate of what sinceQuery finds, from the mail it has read (inbox plus the 30-day window).
  function sinceMail(threads, plan) {
    var skip = {}, want = {}, iso = new Date(plan.after).toISOString();
    plan.threads.forEach(function (o) { skip[o.thread] = 1; });
    plan.since.forEach(function (l) { want[l] = 1; });
    return threads.filter(function (t) { return !skip[t.id] && t.date >= iso && t.labels.indexOf('INBOX') < 0 && t.labels.some(function (l) { return want[l]; }); }).map(function (t) { return t.id; });
  }
  // In numbers: threads that lose a label, go back to the inbox, get a label back; labels moved back (moved).
  function undoCounts(plan) {
    var n = { threads: plan.threads.length, unlabel: 0, inbox: 0, relabel: 0, unread: 0, moved: (plan.moves || []).filter(function (m) { return m.to; }).length };
    plan.threads.forEach(function (o) {
      if (o.remove.length) n.unlabel++;
      if (o.add.indexOf('INBOX') >= 0) n.inbox++;
      if (o.add.indexOf('UNREAD') >= 0) n.unread++;
      if (o.add.some(function (l) { return l !== 'INBOX' && l !== 'UNREAD'; })) n.relabel++;
    });
    return n;
  }
  // Mail with a label Labelboard created that no recorded Apply gave it (by hand, by a filter, by an Apply from
  // before the record): Remove everything leaves it, so those labels stay.
  function unrecorded(threads, owned, entries) {
    var mine = {}, gave = {}, n = 0, labels = {};
    owned.forEach(function (l) { mine[l] = 1; });
    entries.forEach(function (e) { Object.keys(e.labelled || {}).forEach(function (l) { e.labelled[l].forEach(function (t) { gave[t + '|' + l] = 1; }); }); });
    threads.forEach(function (t) {
      var hit = t.labels.filter(function (l) { return mine[l] && !gave[t.id + '|' + l]; });
      if (hit.length) { n++; hit.forEach(function (l) { labels[l] = 1; }); }
    });
    return { threads: n, labels: Object.keys(labels).sort() };
  }

  return {
    recordApply: recordApply, mergeRecord: mergeRecord, MOVE_CAP: MOVE_CAP, movedCount: movedCount, tooManyMoved: tooManyMoved, unmoveOps: unmoveOps, childrenFirst: childrenFirst, planUndo: planUndo, sinceQuery: sinceQuery, undoOps: undoOps, sinceMail: sinceMail, undoCounts: undoCounts, unrecorded: unrecorded,
    COST: COST, RATE: RATE, BURST: BURST, budgetWait: budgetWait, historyChanges: historyChanges, diffInbox: diffInbox, relabel: relabel, mergeInbox: mergeInbox, applyOps: applyOps,
    WINDOW_DAYS: WINDOW_DAYS, INBOX_CAP: INBOX_CAP, tooBig: tooBig, windowQuery: windowQuery, windowShrink: windowShrink, timeline: timeline, addTimelines: addTimelines, splitWindow: splitWindow,
    criteriaQuery: criteriaQuery, normFilter: normFilter, filterAction: filterAction, specKey: specKey, filterKey: filterKey, specOf: specOf, specOnly: specOnly, laterQueries: laterQueries, laterIds: laterIds,
    readOwned: readOwned, reconcile: reconcile, filterActions: filterActions, filterStatus: filterStatus, filterState: filterState,
  };
})();
if (typeof module !== 'undefined') module.exports = LabelboardSync;
