import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../src/server/Sync.js');

test('the budget never spends more than 6,000 units in any 60 s window, and its state survives a slice', () => {
  let b = { tokens: 0, at: 0 }, now = 1_000_000;
  const spent = [];
  for (let k = 0; k < 600; k++) {
    now += S.budgetWait(b, 40, now) + 50; // + 50 ms latency per call
    spent.push(now);
    if (k % 25 === 0) { b = JSON.parse(JSON.stringify(b)); now += 1500; } // a slice ends: cursor round-trip
  }
  let worst = 0;
  for (let i = 0, j = 0; i < spent.length; i++) { while (spent[i] - spent[j] >= 60000) j++; worst = Math.max(worst, (i - j + 1) * 40); }
  assert.ok(worst <= 6000, `worst minute ${worst}`);
  assert.ok(worst >= 5000, `pacing too slow: ${worst}`); // close to the 90% target, not crawling
  const fresh = { tokens: 0, at: 0 };
  assert.equal(S.budgetWait(fresh, 40, now), 0); // a new job starts with a small burst
});

test('a re-read reuses threads whose historyId did not move, fetches the rest, drops the ones that left', () => {
  const stored = [{ id: 'a', historyId: '10' }, { id: 'b', historyId: '20' }, { id: 'c', historyId: '30' }, { id: 'd' }];
  const d = S.diffInbox(stored, [{ id: 'n', historyId: '99' }, { id: 'a', historyId: '10' }, { id: 'b', historyId: '21' }, { id: 'd', historyId: '5' }]);
  assert.deepEqual(d, { keep: ['a'], fetch: ['n', 'b', 'd'], changed: [], dropped: 1 }); // d has no stored historyId (old snapshot): fetched
  const merged = S.mergeInbox([{ id: 'a', date: '2026-01-01' }], ['a'], [{ id: 'n', date: '2026-02-01' }]);
  assert.deepEqual(merged.map((t) => t.id), ['n', 'a']);
});

test('without the change log, only threads with mail since the last read are fetched; the rest get their labels redone', () => {
  const t = (id, labels) => ({ id, date: '2026-01-0' + id.length, labels, historyId: '1' });
  const stored = [t('a', ['INBOX', 'UNREAD', 'Old']), t('bb', ['INBOX', 'SENT', 'Kept']), t('ccc', ['INBOX']), t('dddd', ['INBOX', 'Gone'])];
  const listed = [{ id: 'new', historyId: '9' }, ...['a', 'bb', 'ccc'].map((id) => ({ id, historyId: id === 'ccc' ? '1' : '2' }))];
  const d = S.diffInbox(stored, listed, null, { a: 1 }, 3); // a got a reply; bb was only relabelled; ccc untouched
  assert.deepEqual(d, { keep: ['bb', 'ccc'], fetch: ['new', 'a'], changed: ['bb'], dropped: 1 }); // dddd left the inbox
  const re = { labels: ['Old', 'Kept', 'Gone', 'New'], threads: S.relabel(d.changed, { Kept: ['x', 'bb'], New: ['bb'], Old: ['a'] }) };
  assert.deepEqual(re.threads, { bb: ['Kept', 'New'] });
  const merged = S.mergeInbox(stored, d.keep, [t('new', ['INBOX'])], null, {}, re);
  assert.deepEqual(merged.find((x) => x.id === 'bb').labels, ['INBOX', 'SENT', 'Kept', 'New']); // system labels stay as read
  assert.deepEqual(merged.find((x) => x.id === 'ccc').labels, ['INBOX']);
  // few changed threads and many labels: fetching them is cheaper than listing every label
  assert.deepEqual(S.diffInbox(stored, listed, null, { a: 1 }, 200).fetch, ['new', 'a', 'bb']);
  // no read to count new mail from: every thread that moved is fetched
  assert.deepEqual(S.diffInbox(stored, listed, null, null, 3).fetch, ['new', 'a', 'bb']);
});

test('with the change log, reading or labelling mail is patched in place; only new/deleted mail is fetched', () => {
  const m = (threadId) => ({ message: { id: 'm' + threadId, threadId } });
  const ch = S.historyChanges([
    { labelsRemoved: [{ ...m('a'), labelIds: ['UNREAD'] }] }, // you read it in Gmail
    { labelsAdded: [{ ...m('b'), labelIds: ['Label_9', 'STARRED'] }] }, // Apply labelled it, you starred it
    { messagesAdded: [m('c')] }, // a reply arrived
    { labelsRemoved: [{ ...m('e'), labelIds: ['Label_7'] }] }, // a label came off: other messages may still have it
  ]);
  assert.deepEqual(Object.keys(ch.fetch).sort(), ['c', 'e']);
  const stored = ['a', 'b', 'c', 'e', 'f'].map((id) => ({ id, date: '2026-01-0' + (id.charCodeAt(0) - 96), labels: ['INBOX', 'UNREAD'], historyId: '1' }));
  const d = S.diffInbox(stored, ['a', 'b', 'c', 'e', 'f'].map((id) => ({ id, historyId: '2' })), ch);
  assert.deepEqual(d, { keep: ['a', 'b', 'f'], fetch: ['c', 'e'], changed: [], dropped: 0 }); // f's historyId moved but the log says nothing sortable changed
  const merged = S.mergeInbox(stored, d.keep, [], ch, { Label_9: 'News' });
  assert.deepEqual(merged.find((t) => t.id === 'a').labels, ['INBOX']);
  assert.deepEqual(merged.find((t) => t.id === 'b').labels, ['INBOX', 'UNREAD', 'News', 'STARRED']);
  assert.equal(stored[0].labels.length, 2); // stored records are not mutated
});

test('timeline: one entry per message, oldest first, yours marked by SENT, drafts left out', () => {
  const m = (t, labelIds) => ({ internalDate: String(t * 1000), labelIds });
  assert.deepEqual(S.timeline([m(300, ['SENT']), m(100, ['INBOX', 'UNREAD']), m(400, ['DRAFT']), m(200, ['CATEGORY_UPDATES'])]), [[100, 0], [200, 0], [300, 1]]);
  assert.deepEqual(S.timeline(undefined), []);
});

test('the 30-day window: one read over inbox + window listings, old records refetched for timelines, split back apart', () => {
  const since = '2026-10-01T00:00:00.000Z';
  const stored = [
    { id: 'in-old', date: '2026-08-01', historyId: '1', labels: ['INBOX'] }, // before the window, no timeline: kept as is
    { id: 'in-new', date: '2026-10-10', historyId: '1', labels: ['INBOX'] }, // in the window, no timeline: fetched once
    { id: 'in-ok', date: '2026-10-11', historyId: '1', labels: ['INBOX'], msgs: [[1, 0]] },
    { id: 'arch', date: '2026-10-12', historyId: '1', labels: ['SENT'], msgs: [[1, 1]] }, // a window thread from the last read
    { id: 'aged', date: '2026-09-01', historyId: '1', labels: [], msgs: [[1, 0]] }, // out of the window now
  ];
  const inbox = ['in-old', 'in-new', 'in-ok'].map((id) => ({ id, historyId: '1' }));
  const win = [{ id: 'in-ok', historyId: '1' }, { id: 'arch', historyId: '1' }, { id: 'fresh', historyId: '5' }]; // the window listing repeats inbox threads
  const d = S.addTimelines(S.diffInbox(stored, inbox.concat(win), null, null, 0), stored, since);
  assert.deepEqual(d, { keep: ['in-old', 'in-ok', 'arch'], fetch: ['fresh', 'in-new'], changed: [], dropped: 1 });
  const fetched = [{ id: 'fresh', date: '2026-10-14', labels: ['SENT'], snippet: 'hi', msgs: [[2, 1]] }, { id: 'in-new', date: '2026-10-10', labels: ['INBOX'], snippet: 'x', msgs: [[3, 0]] }];
  const parts = S.splitWindow(S.mergeInbox(stored, d.keep, fetched), inbox.map((t) => t.id));
  assert.deepEqual(parts.inbox.map((t) => t.id), ['in-ok', 'in-new', 'in-old']);
  assert.deepEqual(parts.window.map((t) => t.id), ['fresh', 'arch']);
  assert.ok(parts.window.every((t) => !('snippet' in t)), 'window records carry no snippet');
  assert.equal(fetched[0].snippet, 'hi', 'records are copied, not mutated');
  assert.equal(S.addTimelines(d, [], since), d, 'nothing to refetch: the same result back');
});

test('the window: every category (filters archive group mail into Forums), and fewer days when it does not fit', () => {
  assert.equal(S.windowQuery(30), 'newer_than:30d -in:chats');
  const now = Date.parse('2026-10-16T12:00:00Z'), ago = (d) => new Date(now - d * 864e5).toISOString();
  const ts = [{ id: 'a', date: ago(2) }, { id: 'b', date: ago(10) }, { id: 'c', date: ago(20) }];
  const s = S.windowShrink(ts, 30, now);
  assert.deepEqual([s.days, s.since, s.threads.map((t) => t.id)], [15, ago(15), ['a', 'b']]);
  assert.deepEqual(S.windowShrink(ts, s.days, now).threads.map((t) => t.id), ['a'], '15 → 7 days');
  assert.equal(S.windowShrink(ts, 3, now), null, 'under 2 days: give up');
});

test('bulk apply: one batch per big label, single calls for small ones, removals, archiving last', () => {
  const ids = { Big: 'L1', Small: 'L2', Old: 'L3' };
  const ts = ['t1', 't2', 't3', 't4', 't5', 't6'];
  const msgs = { t1: ['m1', 'm1b'], t2: ['m2'], t3: ['m3'], t4: ['m4'], t5: ['m5'] }; // t6 left the inbox since the read
  const ops = S.applyOps(
    [{ label: 'Big', archive: true, threadIds: ts }, { label: 'Small', archive: false, threadIds: ['t1'] }],
    [{ label: 'Old', threadIds: ['t2'] }], ids, msgs);
  assert.deepEqual(ops[0], { ids: ['m1', 'm1b', 'm2', 'm3', 'm4', 'm5'], threads: ['t1', 't2', 't3', 't4', 't5'], add: ['L1'], remove: [] });
  const singles = ops.filter((o) => o.thread);
  assert.deepEqual(singles, [{ thread: 't6', add: ['L1'], remove: [] }, { thread: 't1', add: ['L2'], remove: [] }, { thread: 't2', add: [], remove: ['L3'] }]);
  assert.deepEqual(ops[ops.length - 1], { ids: ['m1', 'm1b', 'm2', 'm3', 'm4', 'm5'], threads: ['t1', 't2', 't3', 't4', 't5'], add: [], remove: ['INBOX'] });
  // under 5 threads a batch (50 units) costs more than single calls (10 each): archive rides along
  const few = S.applyOps([{ label: 'Big', archive: true, threadIds: ['t1', 't2'] }], [], ids, msgs);
  assert.deepEqual(few, [{ thread: 't1', add: ['L1'], remove: ['INBOX'] }, { thread: 't2', add: ['L1'], remove: ['INBOX'] }]);
  // removals always go thread by thread: the label also sits on sent replies, outside the inbox list
  const moved = S.applyOps([], [{ label: 'Old', threadIds: ['t1', 't2', 't3', 't4', 't5'] }], ids, msgs);
  assert.deepEqual(moved.map((o) => o.thread), ['t1', 't2', 't3', 't4', 't5']);
  // batches never exceed 1,000 message ids
  const many = {}, list = [];
  for (let i = 0; i < 700; i++) { many['x' + i] = ['a' + i, 'b' + i]; list.push('x' + i); }
  const big = S.applyOps([{ label: 'Big', archive: false, threadIds: list }], [], ids, many);
  assert.equal(big.length, 2);
  big.forEach((o) => assert.ok(o.ids.length <= 1000));
});

test('filters: one canonical query whatever the criteria; extra actions in words', () => {
  assert.equal(S.criteriaQuery({ query: 'from:a.com OR to:a.com' }), 'from:a.com OR to:a.com'); // Labelboard's own: unchanged
  assert.equal(S.criteriaQuery({ from: 'tech@northfund.vc', query: 'list:(<portfolio.northfund.vc>)' }), 'from:tech@northfund.vc list:(<portfolio.northfund.vc>)');
  assert.equal(S.criteriaQuery({ from: 'a OR b', negatedQuery: 'sale' }), 'from:(a OR b) -(sale)');
  const f = S.normFilter({ id: 'f1', criteria: { from: '@x.com' }, action: { addLabelIds: ['Label_1', 'STARRED'], removeLabelIds: ['INBOX', 'UNREAD'] } }, { Label_1: 'News' });
  assert.deepEqual(f, { id: 'f1', query: 'from:@x.com', labels: ['News'], archive: true, extras: ['stars it', 'marks it read'], acts: { star: true, read: true }, other: [] });
});

test('drift: a filter Labelboard made and you deleted or edited in Gmail is not silently redone', () => {
  const spec = { query: 'from:a.com', label: 'X', archive: false };
  const live = [{ id: 'e', query: 'from:b.com', labels: ['X'], archive: true, extras: [] }, { id: 'k', query: 'from:k.com', labels: ['K'], archive: false, extras: [] }];
  const r = S.reconcile({ d: spec, e: { query: 'from:b.com', label: 'X', archive: false }, k: null }, live, []);
  assert.deepEqual(Object.keys(r.owned), ['k']); // legacy id list: spec filled from Gmail
  assert.deepEqual(r.owned.k, { query: 'from:k.com', label: 'K', archive: false });
  assert.deepEqual(r.released, ['e']); // edited in Gmail: yours now
  assert.deepEqual(r.gone.map((g) => g.why), ['deleted', 'edited']);
  // Apply leaves the deleted one out unless you restore it; owned filters off the board go; yours stay
  const yours = { id: 'y', query: 'from:y.com', labels: ['Y'], archive: false, extras: [] };
  const plan = [spec, { query: 'from:y.com', label: 'Y', archive: false }, { query: 'from:new.com', label: 'X', archive: false }];
  const a = S.filterActions(plan, live.concat(yours), r.owned, r.gone, []);
  assert.deepEqual(a.create.map((p) => p.query), ['from:new.com']); // y already exists (yours): not copied
  assert.deepEqual(a.skipped, [spec]);
  assert.deepEqual(a.remove, ['k']);
  assert.equal(a.gone.length, 1); // the edited spec is no longer in the plan: forgotten
  const back = S.filterActions(plan, live, r.owned, r.gone, [S.specKey(spec)]);
  assert.ok(back.create.some((p) => p.query === 'from:a.com'));
  assert.equal(back.gone.length, 0);
  assert.deepEqual(S.readOwned('["a","b"]'), { a: null, b: null });
});

test('filter status per label: in Gmail, new, changing, removed, left out; adopted and handed-back ones count as owned or not', () => {
  const f = (id, query, label, owned) => ({ id, query, labels: [label], archive: false, extras: [], owned });
  const live = [f('a1', 'from:a.com', 'A', true), f('b1', 'from:b.com', 'B', true), f('c1', 'from:old.com', 'C', true), f('y', 'from:y.com', 'Y', false), f('r', 'from:r.com', 'R', true)];
  const spec = (query, label) => ({ query, label, archive: false });
  const gone = [{ query: 'from:d.com', label: 'D', archive: false, why: 'deleted' }];
  const plan = [spec('from:a.com', 'A'), spec('from:b.com OR from:b2.com', 'B'), spec('from:n.com', 'N'), spec('from:d.com', 'D'), spec('from:y.com', 'Y')];
  const st = S.filterStatus(plan, live, gone, ['y'], ['r'], []);
  assert.deepEqual(st.byLabel.A, { want: 1, create: 0, remove: 0, skipped: 0 });
  assert.deepEqual(['A', 'B', 'C', 'N', 'D', 'Y', 'Z'].map((l) => S.filterState(st.byLabel[l])), ['live', 'change', 'gone', 'new', 'out', 'live', 'none']);
  assert.deepEqual(st.actions.remove.sort(), ['b1', 'c1']); // r was handed back: never removed
  assert.equal(S.filterState({ want: 2, create: 1, remove: 0, skipped: 0 }), 'change'); // one of two already in Gmail
});

test('an inbox over the storage cap stops before the read, in plain words', () => {
  assert.ok(S.INBOX_CAP >= 2000 && S.INBOX_CAP <= 3000, 'about 160 bytes per thread of 500 KB');
  const msg = S.tooBig(8400);
  assert.match(msg, /8,400 threads/);
  assert.match(msg, /Nothing in Gmail changed/);
  assert.doesNotMatch(msg, /Error|quota|property/i, 'no engine words');
});

// ---------- the apply record and undo ----------
const plan1 = {
  backfill: [{ label: '_Clients', archive: false, threadIds: ['a', 'b'] }, { label: '_News', archive: true, threadIds: ['c', 'd'], had: ['d'] }],
  unlabel: [{ label: '_Old', threadIds: ['e'] }], adopt: ['F9'],
};

test('an Apply\'s record labels only threads that lacked the label, archives every skip-inbox thread, keeps what re-sort took off', () => {
  const e = S.recordApply(plan1, 1000);
  assert.deepEqual(e.labelled, { _Clients: ['a', 'b'], _News: ['c'] }); // d already had _News: it only left the inbox
  assert.deepEqual(e.archived, ['c', 'd']);
  assert.deepEqual(e.unlabeled, { _Old: ['e'] });
  assert.deepEqual(e.adopted, ['F9']);
  assert.equal(e.done, false);
});

test('undoing one Apply takes off its labels, puts back the inbox and the labels re-sort took off, never a label a thread already had', () => {
  const e = Object.assign(S.recordApply(plan1, 1000), { filtersCreated: [{ id: 'f1', label: '_News', archive: true }, { id: 'f2', label: '_Clients', archive: false }],
    filtersRemoved: [{ query: 'from:x', label: '_Old', archive: false }], labelsCreated: ['_News', '_Clients', '_Clients/Acme'], recolored: { _Old: { backgroundColor: '#000000' } } });
  const p = S.planUndo([e]);
  assert.deepEqual(p.threads, [
    { thread: 'a', add: [], remove: ['_Clients'] }, { thread: 'b', add: [], remove: ['_Clients'] },
    { thread: 'c', add: ['INBOX'], remove: ['_News'] }, { thread: 'd', add: ['INBOX'], remove: [] }, { thread: 'e', add: ['_Old'], remove: [] }]);
  assert.deepEqual(p.filters, { remove: ['f1', 'f2'], restore: [{ query: 'from:x', label: '_Old', archive: false }], handBack: ['F9'] });
  assert.deepEqual(p.labels, ['_Clients/Acme', '_Clients', '_News'], 'children before their parent');
  assert.deepEqual(p.since, ['_News'], 'only labels whose new filter skips the inbox');
  assert.equal(p.after, 1000);
  assert.deepEqual(S.planUndo([e], true).filters.restore, [], 'Remove everything makes nothing again');
  assert.deepEqual(S.undoCounts(p), { threads: 5, unlabel: 3, inbox: 2, relabel: 1, unread: 0, moved: 0 });
});

test('undoing several Applies, newest first, ends where the oldest started', () => {
  const a1 = Object.assign(S.recordApply({ backfill: [{ label: 'X', threadIds: ['t'] }] }, 1000), { recolored: { L: { backgroundColor: '#111111' } } });
  const a2 = Object.assign(S.recordApply({ backfill: [{ label: 'Y', threadIds: ['t'] }], unlabel: [{ label: 'X', threadIds: ['t'] }] }, 2000), { recolored: { L: { backgroundColor: '#222222' } } });
  assert.deepEqual(S.planUndo([a2]).threads, [{ thread: 't', add: ['X'], remove: ['Y'] }], 'the last Apply alone gives X back');
  const both = S.planUndo([a2, a1], true);
  assert.deepEqual(both.threads, [{ thread: 't', add: [], remove: ['X', 'Y'] }], 'before the first Apply t had neither');
  assert.deepEqual(both.colors, { L: { backgroundColor: '#111111' } }, 'the colour before the first change');
  assert.equal(both.after, 1000);
});

test('an Apply run again after it stopped adds to the same record', () => {
  const a = Object.assign(S.recordApply({ backfill: [{ label: 'X', threadIds: ['t', 'u'] }] }, 1000), { filtersCreated: [{ id: 'f1' }] });
  const m = S.mergeRecord(a, S.recordApply({ backfill: [{ label: 'X', threadIds: ['u', 'v'], archive: true }] }, 2000));
  assert.deepEqual(m.labelled, { X: ['t', 'u', 'v'] });
  assert.deepEqual(m.archived, ['u', 'v']);
  assert.equal(m.at, 1000);
  assert.deepEqual(m.filtersCreated, [{ id: 'f1' }]);
});

test('mail a new filter kept out of the inbox since the Apply goes back, once, after the recorded threads', () => {
  const at = Date.parse('2026-10-17T10:00:00Z');
  const e = Object.assign(S.recordApply({ backfill: [{ label: 'N', archive: true, threadIds: ['a'] }] }, at), { filtersCreated: [{ id: 'f', label: 'N', archive: true }] });
  const p = S.planUndo([e]);
  assert.deepEqual(S.undoOps(p, ['z', 'a', 'y', 'z']).map((o) => o.thread), ['a', 'y', 'z'], 'recorded first, then the found ones sorted, no repeats');
  assert.deepEqual(S.undoOps(p, ['y']).at(-1), { thread: 'y', add: ['INBOX'], remove: [] }, 'label kept');
  const mail = [
    { id: 'a', date: '2026-10-17T11:00:00Z', labels: ['N'] }, // in the record
    { id: 'y', date: '2026-10-17T11:00:00Z', labels: ['N'] }, // caught by the filter since
    { id: 'o', date: '2026-10-16T11:00:00Z', labels: ['N'] }, // before the Apply
    { id: 'i', date: '2026-10-17T11:00:00Z', labels: ['N', 'INBOX'] }, // still in the inbox
  ];
  assert.deepEqual(S.sinceMail(mail, p), ['y']);
  assert.equal(S.sinceQuery(at), '-in:inbox after:' + at / 1000);
});

test('Remove everything counts the mail that keeps Labelboard\'s labels: labelled by hand or before the record', () => {
  const e = S.recordApply({ backfill: [{ label: 'N', threadIds: ['a'] }] }, 1);
  const mail = [{ id: 'a', labels: ['N'] }, { id: 'b', labels: ['N', 'Mine'] }, { id: 'c', labels: ['M'] }, { id: 'd', labels: ['Mine'] }];
  assert.deepEqual(S.unrecorded(mail, ['N', 'M'], [e]), { threads: 2, labels: ['M', 'N'] });
});

test('card actions: Gmail action ids, and a filter Labelboard made with them keys the same as its spec', () => {
  const spec = { query: 'from:acme.com', label: 'X', archive: true, read: true, star: true, important: 'never' };
  assert.deepEqual(S.filterAction(spec, 'L1'), { addLabelIds: ['L1', 'STARRED'], removeLabelIds: ['INBOX', 'UNREAD', 'IMPORTANT'] });
  assert.deepEqual(S.filterAction({ trash: true, important: 'always' }, 'L1').addLabelIds, ['L1', 'TRASH', 'IMPORTANT']);
  const live = S.normFilter({ id: 'f1', criteria: { query: 'from:acme.com' }, action: S.filterAction(spec, 'L1') }, { L1: 'X' });
  assert.equal(S.filterKey(live), S.specKey(spec));
  assert.deepEqual(S.reconcile({ f1: spec }, [live], []).owned, { f1: spec }); // not mistaken for one edited in Gmail
  const plain = S.normFilter({ id: 'f2', criteria: { query: 'q' }, action: { addLabelIds: ['L1'], removeLabelIds: ['INBOX'] } }, { L1: 'X' });
  assert.equal(S.filterKey(plain), 'q|X|1'); // no card actions: the key it always had
  const fwd = S.normFilter({ id: 'f3', criteria: { query: 'q' }, action: { addLabelIds: ['L1'], forward: 'a@b.com' } }, { L1: 'X' });
  assert.notEqual(S.filterKey(fwd), S.specKey({ query: 'q', label: 'X' })); // something the board can't do keeps it apart
});

test('mark as read on Apply: only the unread, batched like archiving, recorded and undone', () => {
  const msgs = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((t) => [t, [t + '1']]));
  const backfill = [{ label: 'X', archive: false, read: true, threadIds: ['a', 'b', 'c', 'd', 'e', 'f'], unread: ['a', 'b', 'c', 'd', 'e'] }];
  const ops = S.applyOps(backfill, [], { X: 'L1' }, msgs);
  assert.deepEqual(ops.find((o) => o.remove && o.remove[0] === 'UNREAD').threads, ['a', 'b', 'c', 'd', 'e']);
  const e = S.recordApply({ backfill }, 1);
  assert.deepEqual(e.read, ['a', 'b', 'c', 'd', 'e']);
  const plan = S.planUndo([e]);
  assert.ok(plan.threads.find((o) => o.thread === 'a').add.includes('UNREAD'));
  assert.equal(S.undoCounts(plan).unread, 5);
});

test('undo of a deleting filter brings its mail out of the trash; timed rules go back to what they were', () => {
  const e = { at: 1000, labelled: {}, archived: [], filtersCreated: [{ id: 'f', label: 'X', archive: false, trash: true }], later: [{ id: 'k', days: 3, queries: ['q'] }] };
  const plan = S.planUndo([e]);
  assert.deepEqual([plan.trashed, plan.since], [['X'], []]);
  assert.equal(S.sinceQuery(1000, true), 'in:trash after:1');
  assert.deepEqual(S.undoOps(plan, [], ['t1']), [{ thread: 't1', add: ['INBOX'], remove: [], untrash: true }]);
  assert.deepEqual(plan.later, e.later);
  assert.deepEqual(S.planUndo([e], true).later, []);
  assert.equal(S.planUndo([{ at: 1, labelled: {} }]).later, null); // an Apply from before timed rules: left alone
});

test('moved labels undo newest first: messages get their label back, lose the new one only if they didn\'t have it, 1000 per call', () => {
  const ids = Array.from({ length: 1203 }, (_, i) => 'm' + i), had = ['m0', 'm1'];
  const older = { at: 1, labelled: {}, moved: [{ from: 'Portfolio/V1', to: '_Portfolio/V1', ids: ['p1'], had: [], owned: false }], labelsAdopted: ['Household'] };
  const newer = { at: 2, labelled: {}, moved: [{ from: 'Portfolio', to: '_Portfolio', ids, had, owned: false }, { from: '_Gone', to: null, ids: [], had: [], owned: true }] };
  const plan = S.planUndo([newer, older]);
  assert.deepEqual(plan.moves.map((m) => m.from), ['_Gone', 'Portfolio', 'Portfolio/V1'], 'the last move of the newest Apply first');
  assert.deepEqual(plan.handBack, ['Household']);
  const ops = S.unmoveOps(plan.moves);
  assert.deepEqual(ops.map((o) => [o.from, o.ids.length, o.keepTo]), [['Portfolio', 1000, false], ['Portfolio', 201, false], ['Portfolio', 2, true], ['Portfolio/V1', 1, false]]);
  assert.ok(!ops[0].ids.includes('m0') && ops[2].ids.includes('m0'));
  assert.equal(S.undoCounts(plan).moved, 2, 'a label deleted empty moved no mail');
});

test('an Apply records the labels it takes over and counts the messages it moved against the cap', () => {
  const e = S.recordApply({ backfill: [], adoptLabels: ['Household'] }, 5);
  assert.deepEqual([e.labelsAdopted, e.moved], [['Household'], []]);
  e.moved.push({ ids: ['a', 'b'] }, { ids: ['c'] });
  assert.equal(S.movedCount(e), 3);
  const merged = S.mergeRecord(e, S.recordApply({ backfill: [], adoptLabels: ['Hobby'] }, 6));
  assert.deepEqual([merged.labelsAdopted.sort(), merged.moved.length], [['Hobby', 'Household'], 2]);
  assert.match(S.tooManyMoved('Household', 4100), /Nothing else changed|nothing else changed/);
});

test('archiving later skips threads with a message too new or still unread', () => {
  assert.deepEqual(S.laterQueries({ days: 3 }, '(q)'), ['in:inbox (q) older_than:3d', 'in:inbox (q) newer_than:3d']);
  assert.deepEqual(S.laterQueries({ read: true }, '(q)'), ['in:inbox (q) -is:unread', 'in:inbox (q) is:unread']);
  assert.deepEqual(S.laterIds(['a', 'b', 'c', 'a'], ['b']), ['a', 'c']);
});
