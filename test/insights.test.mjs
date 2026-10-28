import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js');
const I = require('../src/insights.js');

const NOW = Date.parse('2026-10-16T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 864e5).toISOString();
let n = 0;
const T = (o) => ({ id: 't' + (++n), date: o.date || daysAgo(1), from: o.from, fromName: '', to: ['me@firm.com'], cc: [], subject: o.subject || 'Hello', labels: o.labels || ['INBOX'], snippet: '', count: 1 });
const config = { ...require('../presets/basic.json'), me: ['me@firm.com'], firmDomains: ['firm.com'], aliases: ['team@firm.com'], cards: {} };
const snapshot = { account: 'me@firm.com', generatedAt: daysAgo(0), threads: [
  T({ from: 'ana@acme.com', labels: ['INBOX', 'STARRED'], date: daysAgo(40) }),
  T({ from: 'bob@acme.com', date: daysAgo(2) }),
  T({ from: 'bob@acme.com', labels: ['INBOX', 'SENT'] }),
  T({ from: 'noreply@tool.io' }), T({ from: 'noreply@tool.io' }), T({ from: 'noreply@tool.io' }),
  T({ from: 'news@letters.com', date: daysAgo(100) }),
  T({ from: 'team@firm.com' }),
  T({ from: 'old@archived.com', labels: ['CATEGORY_UPDATES'] }), // not in the inbox: never counted
] };
const built = R.buildCards(snapshot, config, []);
const total = (l) => l.reduce((s, x) => s + x.n, 0);

test('places: one per inbox thread, the same answer the rack counts', () => {
  const ps = I.places(snapshot, built, config), st = R.stats(snapshot, built, config);
  assert.equal(ps.length, 8);
  assert.equal(ps.filter((p) => !p.out).length, st.after.inbox);
});

test('shift: inbox now → cards → after Apply, every layer adds up, and only what Apply changes counts as changed', () => {
  const snap = { threads: [T({ from: 'noreply@tool.io', labels: ['INBOX', '_Tools'] }), T({ from: 'noreply@tool.io' }), T({ from: 'news@letters.com' }), T({ from: 'x@gone.com', labels: ['CATEGORY_UPDATES'] })] };
  const b = R.buildCards(snap, config, []), s = I.shift(snap, b, config, { max: 1 });
  assert.equal(s.total, 3);
  s.layers.forEach((l) => assert.equal(total(l), 3));
  const now = Object.fromEntries(s.layers[0].map((x) => [x.id, x.n])), after = Object.fromEntries(s.layers[2].map((x) => [x.id, x]));
  assert.deepEqual(now, { 'now:none': 2, 'now:tools': 1 });
  assert.equal(after['col:tools'].n, 2); assert.equal(after['col:tools'].leaves, 2);
  assert.equal(after['col:tools'].ch, 2); // the labelled one still leaves the inbox on Apply
  assert.equal(s.layers[1].filter((x) => x.key).length, 1); // max 1 card by name, the rest folded
  const k = b.cards.find((c) => c.threads.length === 1).key;
  assert.ok(I.shift(snap, b, config, { max: 1, keep: k }).layers[1].some((x) => x.key === k));
  const placed = { ...config, cards: Object.fromEntries(b.cards.map((c) => [c.key, { bucket: 'keep' }])) };
  const st = I.shift(snap, b, placed, {});
  assert.equal(st.changed, 0); // nothing to label or archive: Apply leaves the inbox alone
  assert.ok(st.links.every((l) => l.ch === 0 && l.n > 0));
  const mixed = { ...config, cards: { [b.threadCards[snap.threads[2].id][0]]: { bucket: 'keep' } } };
  assert.deepEqual(I.shift(snap, b, mixed, {}).layers[2].map((x) => x.id), ['col:keep', 'col:tools']); // no label first, as in Gmail now
});

test('shift: when Apply changes nothing the two bars match, two column labels and no label included', () => {
  const snap = { threads: [T({ from: 'ana@acme.com', labels: ['INBOX', '_Calendar', '_Clients'] }), T({ from: 'bob@other.com' })] };
  const b = R.buildCards(snap, config, []), at = (t) => b.threadCards[t.id][0];
  const placed = { ...config, cards: { [at(snap.threads[0])]: { bucket: 'clients' }, [at(snap.threads[1])]: { bucket: 'keep' } } };
  const s = I.shift(snap, b, placed, { owned: ['_Clients'] }), ids = (l) => l.map((x) => x.id.split(':')[1] + '=' + x.n);
  assert.equal(s.changed, 0);
  assert.deepEqual(ids(s.layers[0]), ids(s.layers[2])); // Clients by its card, not _Calendar for coming first; Keep in inbox, not "no label"
  assert.deepEqual(ids(s.layers[0]), ['keep=1', 'clients=1']);
});

test('flowLayout: nodes in a layer never overlap, and every link has its ends', () => {
  const f = I.shift(snapshot, built, config, {}), L = I.flowLayout(f, { width: 900, height: 300, minH: 12, gap: 5 });
  [0, 1, 2].forEach((layer) => {
    const ns = Object.values(L.nodes).filter((x) => x.layer === layer).sort((a, z) => a.y - z.y);
    ns.slice(1).forEach((x, i) => assert.ok(x.y >= ns[i].y + ns[i].h, 'no overlap in layer ' + layer));
  });
  L.links.forEach((l) => assert.ok(Number.isFinite(l.y0) && Number.isFinite(l.y1)));
});

test('pack: circles never overlap and fit the enclosing radius', () => {
  const radii = [9, 7, 7, 5, 4, 4, 3, 2, 2, 1, 1, 1], p = I.pack(radii, 0.5);
  p.circles.forEach((a, i) => {
    assert.equal(a.r, radii[i]);
    assert.ok(Math.hypot(a.x, a.y) + a.r <= p.r + 1e-9);
    p.circles.slice(i + 1).forEach((b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 0.5 - 1e-6));
  });
  assert.deepEqual(I.pack([], 0), { circles: [], r: 0 });
});

test('priorities: people only (no machines, no group addresses), replied threads drop out, starred first', () => {
  const p = I.priorities(snapshot, built, config, NOW);
  assert.equal(p.people, 3);
  assert.equal(p.answered, 1);
  assert.deepEqual(p.waiting.map((w) => w.t.from), ['ana@acme.com', 'bob@acme.com']);
  assert.equal(p.ages.week + p.ages.month + p.ages.quarter + p.ages.older, p.waiting.length);
  assert.equal(p.recent.week, 6);
});

// timelines: [[epoch s, 1 if yours]]
const sec = (d) => Math.round((NOW - d * 864e5) / 1000);
const tl = (o) => ({ ...T(o), msgs: o.msgs });
const live = { account: 'me@firm.com', generatedAt: daysAgo(0), threads: [
  tl({ from: 'ana@acme.com', msgs: [[sec(3), 0]], date: daysAgo(3) }),
  tl({ from: 'bob@acme.com', labels: ['INBOX', 'SENT'], msgs: [[sec(5), 0], [sec(4.9), 1], [sec(1), 0]] }), // they wrote back after your reply
  tl({ from: 'cy@beta.com', labels: ['INBOX', 'SENT'], msgs: [[sec(2), 0], [sec(1.99), 1]] }),
  tl({ from: 'noreply@tool.io', msgs: [[sec(1), 0]] }),
  T({ from: 'dan@acme.com', date: daysAgo(2) }), // read before timelines: only the SENT label to go by
] };
const recent = { threads: [
  tl({ from: 'eve@gamma.com', labels: ['SENT'], msgs: [[sec(10), 0], [sec(8), 1]], date: daysAgo(8) }),
  tl({ from: 'fay@gamma.com', labels: [], msgs: [[sec(6), 0]], date: daysAgo(6) }),
  tl({ from: 'old@gamma.com', labels: ['SENT'], msgs: [[sec(40), 0], [sec(35), 1]], date: daysAgo(35) }), // their message is outside the window
  tl({ from: 'me@firm.com', labels: ['SENT'], msgs: [[sec(3), 1]], date: daysAgo(3) }), // you wrote, nobody answered yet
] };

test('turns: who has the last word, and each answer timed from their first unanswered message', () => {
  assert.deepEqual(I.turns([[10, 0], [20, 0], [50, 1], [60, 1], [70, 0]]), { open: 70, lastIn: 70, replies: [[10, 40]] });
  assert.deepEqual(I.turns([[10, 1]]), { open: null, lastIn: null, replies: [] });
  assert.equal(I.waitsSince({ labels: ['INBOX', 'SENT'], date: daysAgo(1) }), null, 'no timeline: any message of yours counts');
  assert.equal(I.waitsSince({ labels: ['INBOX'], date: daysAgo(1) }), NOW - 864e5);
});

test('priorities with timelines: a thread they answered after your reply waits on you again, aged from their message', () => {
  const b = R.buildCards(live, config, []), p = I.priorities(live, b, config, NOW);
  assert.equal(p.people, 4);
  assert.equal(p.answered, 1, 'only cy@beta.com: yours is the last word');
  assert.equal(I.overview(live, b, config, NOW).answered, 1, 'Overview counts answered the same way, not by the SENT label');
  assert.deepEqual(p.waiting.map((w) => [w.t.from, w.days]), [['bob@acme.com', 1], ['dan@acme.com', 2], ['ana@acme.com', 3]]);
});

test('priorities that remember: a hidden thread stays out until a newer message, colleagues-only threads on a switch', () => {
  const ana = T({ from: 'ana@acme.com', date: daysAgo(3) }), mia = { ...T({ from: 'mia@firm.com', date: daysAgo(1) }), to: ['me@firm.com', 'leo@firm.com'] };
  const out = { ...T({ from: 'mia@firm.com', date: daysAgo(2) }), cc: ['ceo@acme.com'] }; // a colleague with someone outside stays
  const snap = { threads: [ana, mia, out] }, b = R.buildCards(snap, config, []);
  const from = (p) => p.waiting.map((w) => w.t.from).sort();
  const all = I.priorities(snap, b, config, NOW);
  assert.deepEqual([all.waiting.length, all.hidden, all.colleagues], [3, 0, 1]);
  const hid = I.priorities(snap, b, config, NOW, { hidden: { [ana.id]: ana.date }, colleaguesOut: true });
  assert.deepEqual([from(hid), hid.hidden, hid.colleagues], [['mia@firm.com'], 1, 1]);
  assert.equal(hid.ages.week + hid.ages.month + hid.ages.quarter + hid.ages.older, 1);
  assert.deepEqual([hid.people, hid.answered], [all.people, all.answered], 'the answered share stays one definition');
  const newer = I.priorities({ threads: [{ ...ana, date: daysAgo(0) }, mia, out] }, b, config, NOW, { hidden: { [ana.id]: ana.date } });
  assert.equal(newer.hidden, 0, 'a new message brings it back');
});

test('replies over 30 days: inbox and archived, people only, answered = last word yours, median answer time', () => {
  const b = R.buildCards({ threads: live.threads.concat(recent.threads) }, config, []);
  const r = I.replies(live, b, recent, config, NOW, 30);
  assert.equal(r.people, 5, 'ana, bob, cy, eve, fay: not the no-reply sender, not a thread only you wrote in, not mail before the window');
  assert.equal(r.answered, 2);
  assert.equal(r.inboxWaiting, 2);
  assert.deepEqual(r.archived.map((w) => [w.t.from, w.days]), [['fay@gamma.com', 6]]);
  assert.equal(r.partial, 1, 'dan@acme.com has no timeline');
  assert.equal(r.replies, 3);
  assert.equal(r.median, 8640);
  assert.deepEqual(r.speed.map((s) => s.n), [1, 1, 1, 0]);
  assert.equal(r.columns.reduce((n, c) => n + c.people, 0), 5);
  assert.equal(I.replies(live, b, null, config, NOW, 30).people, 3, 'without the window read: the inbox only');
});

test('overview: people and automated, a group address in neither; months run without gaps', () => {
  const o = I.overview(snapshot, built, config, NOW);
  assert.equal(o.inbox, 8);
  assert.equal(o.people, 3);
  assert.equal(o.machine, 4, 'three no-reply threads and a newsletter; team@firm.com is a colleague forwarding');
  assert.equal(o.starred, 1);
  assert.equal(o.answered, I.priorities(snapshot, built, config, NOW).answered, 'one definition of answered across views');
  assert.equal(o.oldestDays, 100);
  assert.equal(total(o.months), 8);
  assert.equal(o.months[o.months.length - 1].month, '2026-10');
});

test('initials for a bubble', () => {
  assert.deepEqual(['Acme Corp', 'acme.com', 'ana@acme.com', 'x', 'mail.beehiiv.com'].map(I.initials), ['AC', 'AC', 'AN', 'X', 'MB']);
});

test('filterTrace: a label by a filter, before it, by hand, missed, or once applied; a sub-label counts once', () => {
  const at = Date.parse(daysAgo(5)), th = [
    T({ from: 'a@acme.com', labels: ['INBOX', '_Clients', '_Clients/Acme'], date: daysAgo(1) }), // the filter, after it was made
    T({ from: 'a@acme.com', labels: ['_Clients'], date: daysAgo(9) }), // labelled before the filter existed
    T({ from: 'a@acme.com', labels: [], date: daysAgo(12) }), // older than the filter: missed
    T({ from: 'z@zeta.com', labels: ['INBOX', '_Clients'] }), // no filter matches: by hand
    T({ from: 'news@tool.io', labels: ['INBOX'] }), // only a filter made on Apply
    T({ from: 'bill@shop.com', labels: ['Receipts'] }), // yours
    T({ from: 'pay@other.com', labels: ['Receipts', 'Travel'] }), // a label your filter gives, given by hand; Travel no filter or column uses
  ];
  const filters = [{ id: 'f1', query: 'from:acme.com', label: '_Clients', live: true, ours: true, at }, { id: 'f2', query: 'from:acme.com', label: '_Clients/Acme', live: true, ours: true, at },
    { id: 'p1', query: 'from:tool.io', label: '_Tools', live: false, ours: true }, { id: 'y1', query: 'from:shop.com', label: 'Receipts', live: true, ours: false }];
  const tr = I.filterTrace({ threads: th }, filters, config), how = (node, t) => tr.nodes[node][t.id].how;
  assert.deepEqual([0, 1, 2, 3].map((i) => how('col:clients', th[i])), ['filter', 'early', 'missed', 'hand']);
  assert.equal(how('col:tools', th[4]), 'would');
  assert.deepEqual(tr.nodes['lab:Receipts'][th[5].id], { how: 'filter', ours: false });
  assert.equal(tr.nodes['lab:Receipts'][th[6].id].how, 'hand');
  assert.ok(!tr.nodes['lab:Travel'], 'a label no filter or column uses is left out');
  assert.deepEqual(tr.byFilter.f1, { preview: true, filter: [th[0].id], early: [th[1].id], missed: [th[2].id], would: [] });
  assert.deepEqual(tr.byFilter.f2.missed, [th[1].id, th[2].id], 'the sub-label filter missed the two without it');
  assert.equal(Object.keys(tr.nodes['col:clients']).length, 4, 'the first thread has two Clients labels and counts once');
  assert.equal(I.filterTrace({ threads: th }, [{ id: 'q', query: 'list:x', label: 'X', live: true }], config).byFilter.q.preview, false, 'a search metadata can\'t answer');

  // the Gmail tab: each label from one source, each thread once per link, by its state
  const g = I.gmailFlow({ t: tr, filters: filters.map((f) => ({ ...f, gid: f.id })) }, { threads: th }, config, ['Projects']);
  const link = (from, to) => g.links.find((l) => l.from === from && l.to === to);
  assert.deepEqual(['now', 'apply', 'missed'].map((k) => link('col:clients', 'col:clients')[k]), [2, 0, 1], 'the first thread has two Clients labels and counts once');
  assert.equal(link('none', 'col:clients').now, 1, 'labelled by hand');
  assert.equal(link('col:tools', 'col:tools').apply, 1, 'caught once you apply');
  assert.equal(link('f:y1', 'tree:Receipts').now, 1);
  assert.deepEqual([link('none', 'tree:Receipts').n, link('none', 'tree:Travel').n], [1, 1], 'a label your filter gives, added by hand; one nothing gives');
  assert.deepEqual(g.left.map((x) => x.id), config.buckets.filter((b) => b.label).map((b) => 'col:' + b.id).concat(['f:y1', 'none']));
  assert.ok(g.right.some((x) => x.id === 'tree:Projects' && x.n === 0), 'a label of yours with no mail still gets a row');
  const lay = I.rowLayout(g, { minH: 50, gap: 8, extra: { 'col:clients': 100 } });
  ['L:', 'R:'].forEach((s) => {
    const side = Object.values(lay.nodes).filter((x) => x.side === (s === 'R:' ? 1 : 0)).sort((a, z) => a.y - z.y);
    side.slice(1).forEach((x, i) => assert.ok(x.y >= side[i].y + side[i].h, 'rows never overlap'));
  });
  assert.ok(lay.nodes['L:col:clients'].h >= 150, 'an opened row grows by what it shows');
  lay.links.forEach((l) => {
    const a = lay.nodes['L:' + l.from], b = lay.nodes['R:' + l.to];
    assert.ok(l.y0 >= a.y && l.y0 <= a.y + a.h && l.y1 >= b.y && l.y1 <= b.y + b.h, 'every band starts and ends in its rows');
  });

  const rows = I.filterRows(tr, filters, config, NOW, 30);
  assert.deepEqual(rows.columns.map((r) => r.bucket.id), ['clients', 'tools']);
  assert.deepEqual(rows.columns[0].n, { all: 4, filter: 1, early: 1, missed: 1, hand: 1 });
  assert.deepEqual(rows.yours.map((r) => [r.filter.id, r.n.all]), [['y1', 1]], 'a filter\'s row is what it matches: not the hand-labelled one');
});

test('since: new mail, answers and new Unsorted senders after the read you last saw', () => {
  const th = [
    tl({ from: 'ana@acme.com', msgs: [[sec(1), 0]] }), // a new sender, all after: a new Unsorted card
    tl({ from: 'bob@beta.com', msgs: [[sec(9), 0], [sec(1), 0]] }), // new mail in an old thread: Unsorted, not a new card
    tl({ from: 'cy@gamma.com', msgs: [[sec(9), 0], [sec(1), 1]] }), // you answered: not new mail
    tl({ from: 'noreply@tool.io', msgs: [[sec(1), 0]] }), // a column takes it
    T({ from: 'news@letters.com', date: daysAgo(1) }), // no timeline: its date says new
    tl({ from: 'old@delta.com', msgs: [[sec(9), 0]] }), // nothing since
  ], mail = { threads: th }, b = R.buildCards(mail, config, []);
  assert.deepEqual(I.since(mail, b, config, NOW - 3 * 864e5), { mail: 4, fresh: 3, answered: 1, sorted: 2, newCards: 1 });
  assert.deepEqual(I.since(mail, b, config, NOW), { mail: 0, fresh: 0, answered: 0, sorted: 0, newCards: 0 });
});

test('strip: one bin per day up to today, everything older in the first', () => {
  const b = I.strip([{ at: NOW, how: 'filter' }, { at: NOW - 2.5 * 864e5, how: 'missed' }, { at: NOW - 40 * 864e5, how: 'hand' }], NOW, 30);
  assert.equal(b.length, 31);
  assert.deepEqual([b[30], b[28], b[0]], [{ n: 1, filter: 1 }, { n: 1, missed: 1 }, { n: 1, hand: 1 }]);
});
