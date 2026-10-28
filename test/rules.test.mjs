import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js');

const T = (o) => ({ id: o.id || 't' + Math.random(), date: '2026-10-01T00:00:00Z', from: o.from, to: o.to || ['me@firm.com'], cc: o.cc || [], subject: o.subject || '', labels: o.labels || ['INBOX'], snippet: '', count: 1 });
const me = { me: ['me@firm.com'], firmDomains: ['firm.com'], cards: {} };
// Most tests run on the shipped investor preset: topics, counterparties, a sale process, AI reads.
const config = {
  ...require('../presets/investor.json'), ...me, aliases: ['deals@firm.com'],
  aliasBuckets: { 'deals@firm.com': 'portfolio' },
  patterns: [{ key: 'cal', title: 'Calendar replies', bucket: 'calendar', subjects: ['Accepted:'] }],
  labelMap: { _Newsletters: 'newsletters' },
};
const basic = { ...require('../presets/basic.json'), ...me };

test('address and domain matching follows Gmail: exact address or domain incl. subdomains', () => {
  assert.ok(R.addrMatches('a@news.acme.com', 'acme.com'));
  assert.ok(!R.addrMatches('a@notacme.com', 'acme.com'));
  assert.ok(R.addrMatches('a@acme.com', 'a@acme.com'));
  assert.ok(!R.addrMatches('b@acme.com', 'a@acme.com'));
  assert.equal(R.addr('Ana <Ana@Acme.com>'), 'ana@acme.com');
});

test('subject phrases ignore case and punctuation, but need whole tokens', () => {
  assert.ok(R.phraseIn('Re: [Dealflow] Acme seed', '[Dealflow]'));
  assert.ok(R.phraseIn('ACCEPTED: board call', 'Accepted:'));
  assert.ok(!R.phraseIn('Unaccepted offer', 'Accepted:'));
});

test('a known company anywhere in the thread claims it, before the sender', () => {
  const snap = { threads: [T({ id: 'a', from: 'colleague@firm.com', cc: ['ceo@acme.com'] })] };
  const b = R.buildCards(snap, config, [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Fund I/Acme' }]);
  assert.deepEqual(b.threadCards.a, ['entity:portfolio:Acme']);
  assert.equal(b.cards[0].suggestion.sublabel, 'Fund I/Acme');
});

test('shared domains never become company seeds, automated senders never count as people', () => {
  const snap = { threads: [
    T({ id: 'n', from: 'calendar-notification@google.com' }),
    T({ id: 'p', from: 'ceo@acme.com' }),
    T({ id: 'q', from: 'noreply@acme.com' }),
  ] };
  const seeds = [
    { match: 'domain', value: 'google.com', bucket: 'mna', name: 'Google', sublabel: 'Buyers', role: 'counterparty' },
    { match: 'domain', value: 'acme.com', bucket: 'mna', name: 'Acme', sublabel: 'Buyers', role: 'counterparty' },
    { match: 'email', value: 'ceo@acme.com', bucket: 'mna', name: 'Acme', sublabel: 'Buyers', role: 'counterparty' },
  ];
  const b = R.buildCards(snap, config, seeds);
  assert.equal(b.threadCards.n[0], 'sender:calendar-notification@google.com');
  assert.equal(b.threadCards.p[0], 'entity:mna:Acme');
  assert.notEqual(b.threadCards.q[0], 'entity:mna:Acme');
  // and the M&A filter itself excludes automated senders, matching the emulator
  const plan = R.buildPlan(snap, b, config, seeds);
  const mna = plan.filters.find((f) => f.label === '_M&A');
  assert.match(mna.query, /-from:\(noreply/);
  assert.deepEqual(plan.backfill.find((x) => x.label === '_M&A').threadIds, ['p']);
  // an unplaced buyer's rule names its known people only: its domain also sends product mail
  assert.ok(!mna.query.includes('from:acme.com'));
  assert.ok(mna.query.includes('from:ceo@acme.com'));
});

test('cards and backfill match alike: parent domains, the longest seed first, exact addresses, whole phrases, each thread once', () => {
  const seeds = [
    { match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme' },
    { match: 'domain', value: 'labs.acme.com', bucket: 'portfolio', name: 'Acme Labs' },
    { match: 'domain', value: 'orbit.io', bucket: 'portfolio', name: 'Orbit' },
    { match: 'domain', value: 'eu.orbit.io', bucket: 'funds', name: 'Orbit EU' }, // context: counts from its own domain only
    { match: 'email', value: 'ceo@beta.io', bucket: 'portfolio', name: 'Beta' },
  ];
  const snap = { threads: [
    T({ id: 'a', from: 'cfo@mail.acme.com' }), T({ id: 'b', from: 'x@dev.labs.acme.com' }), T({ id: 'c', from: 'y@team.eu.orbit.io' }),
    T({ id: 'd', from: 'cfo@beta.io', subject: 'Hello' }), T({ id: 'e', from: 'z@notacme.com' }), T({ id: 'f', from: 'p@other.org', subject: 'Acme Labsx update' }),
    T({ id: 'g', from: 'ceo@beta.io', cc: ['cfo@acme.com'], subject: 'Beta update' }), T({ id: 'h', from: 'y@eu.orbit.io' }),
    T({ id: 'i', from: 'p@other.org', subject: 'Re: ACME labs - demo' }),
  ] };
  const b = R.buildCards(snap, config, seeds), first = (id) => b.threadCards[id][0];
  assert.deepEqual(['a', 'b', 'c', 'f', 'g', 'h', 'i'].map(first), ['entity:portfolio:Acme', 'entity:portfolio:Acme Labs', 'entity:portfolio:Orbit',
    'entity:portfolio:Acme', 'entity:portfolio:Beta', 'entity:funds:Orbit EU', 'entity:portfolio:Acme Labs']);
  assert.ok(!/^entity:/.test(first('d')) && !/^entity:/.test(first('e')));
  const fill = R.buildPlan(snap, b, config, seeds).backfill.find((x) => x.label === '_Portfolio');
  assert.deepEqual(fill.threadIds, ['a', 'b', 'c', 'f', 'g', 'h', 'i']); // h: Gmail's from:orbit.io takes eu.orbit.io too
});

test('a company in a sale process goes to its M&A label only with an M&A signal', () => {
  const seeds = [
    { match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Fund I/Acme' },
    { match: 'process', value: 'Acme', bucket: 'mna', name: 'Acme', sublabel: 'Acme' },
    { match: 'domain', value: 'bigbuyer.com', bucket: 'mna', name: 'BigBuyer', sublabel: 'Buyers', role: 'counterparty' },
  ];
  const snap = { threads: [
    T({ id: 'r', from: 'ceo@acme.com', subject: 'Acme - monthly report' }),
    T({ id: 's', from: 'ceo@acme.com', subject: 'Acme NBO draft' }),
    T({ id: 'u', from: 'cfo@bigbuyer.com', cc: ['ceo@acme.com'], subject: 'Call next week' }),
  ] };
  const b = R.buildCards(snap, config, seeds);
  assert.equal(b.threadCards.r[0], 'entity:portfolio:Acme');
  assert.equal(b.threadCards.s[0], 'process:Acme');
  assert.equal(b.threadCards.u[0], 'process:Acme');
  const plan = R.buildPlan(snap, b, config, seeds);
  const proc = plan.filters.filter((f) => f.label === '_M&A/Deals/Acme'); // the process's folder holds its topics
  assert.equal(proc.length, 1);
  // company AND (M&A words OR the buyer seen on it): the monthly report never matches
  assert.match(proc[0].query, /^\(.*acme\.com.*\) \(.*subject:"NBO".*bigbuyer\.com.*\)/);
  assert.ok(!plan.backfill.find((x) => x.label === '_M&A/Deals/Acme').threadIds.includes('r'));
  const flat = { ...config, processes: [{ ...config.processes[0], folder: undefined }] };
  assert.ok(R.buildPlan(snap, R.buildCards(snap, flat, seeds), flat, seeds).filters.some((f) => f.label === '_M&A/Acme'));
});

test('the company a thread is about beats the law firm or fund on it, even when they come first', () => {
  const seeds = [
    { match: 'domain', value: 'lexfirm.com', bucket: 'mna', name: 'LexFirm', sublabel: 'Legal' },
    { match: 'domain', value: 'northfund.vc', bucket: 'funds', name: 'NorthFund' },
    { match: 'domain', value: 'orbit.io', bucket: 'portfolio', name: 'Orbit', sublabel: 'Fund II/Orbit' },
  ];
  const snap = { threads: [
    T({ id: 'a', from: 'lawyer@lexfirm.com', cc: ['cfo@orbit.io'], subject: 'Amendment' }),
    T({ id: 'b', from: 'partner@northfund.vc', subject: 'Orbit - board deck' }), // named only in the subject
    T({ id: 'c', from: 'lawyer@lexfirm.com', subject: 'Legal opinion' }), // no company: context, not a guess
    T({ id: 'd', from: 'marketing@lexfirm.com', subject: 'Tax webinar' }), // mass mail, not a person
    T({ id: 'e', from: 'partner@northfund.vc', subject: 'Catch up' }), // no topic, no sub-label of its own
  ] };
  const b = R.buildCards(snap, config, seeds);
  assert.deepEqual(b.threadCards.a, ['entity:portfolio:Orbit']);
  assert.deepEqual(b.threadCards.b, ['entity:portfolio:Orbit']);
  assert.equal(b.threadCards.c[0], 'entity:mna:LexFirm');
  const lexfirm = b.cards.find((c) => c.key === 'entity:mna:LexFirm');
  // filed under M&A/Legal: no topic named, so it goes there; a fund with no sub-label waits in Unsorted
  assert.deepEqual([lexfirm.suggestion.bucket, lexfirm.suggestion.sublabel], ['mna', 'Legal']);
  assert.equal(b.cards.find((c) => c.key === 'entity:funds:NorthFund').suggestion.bucket, 'unsorted');
  assert.notEqual(b.threadCards.d[0], 'entity:mna:LexFirm');
  // an unplaced law firm writes no Gmail filter (it would also label Orbit threads)
  // and its mass mail gets a rule for that one sender, never the whole domain
  const qs = R.buildPlan(snap, b, config, seeds).filters.map((f) => f.query);
  assert.ok(!qs.some((q) => /(from|to):lexfirm/.test(q)));
  assert.equal(R.noFilterWhy(lexfirm, config), 'context'); // sorts its own mail now, a rule only once you place it
  assert.ok(qs.includes('from:marketing@lexfirm.com'));
  // the company's filter also catches its name in subjects
  assert.ok(R.buildPlan(snap, b, config, seeds)
    .filters.some((f) => f.query.includes('subject:"Orbit"')));
});

test('an AI read of each thread: topic claims first, machine mail drops the buyer, confident disagreements move old mail', () => {
  const seeds = [
    { match: 'domain', value: 'lawfirm.com', bucket: 'mna', name: 'LawFirm', sublabel: 'Legal' },
    { match: 'domain', value: 'bigsoft.com', bucket: 'mna', name: 'BigSoft', sublabel: 'Buyers', role: 'counterparty' },
    { match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Fund I/Acme' },
  ];
  const cfg = { ...config, topics: [{ name: 'Kestrel (Proj. Kite)', bucket: 'deals', sublabel: 'Kestrel', subjects: ['Proj Kite'] }] };
  const snap = { threads: [
    T({ id: 'k', from: 'lawyer@lawfirm.com', subject: 'Legal opinion' }),
    T({ id: 'm', from: 'startups@bigsoft.com', subject: 'Stay connected' }),
    T({ id: 'r', from: 'ceo@acme.com', subject: 'Amendment' }),
    T({ id: 'i', from: 'ceo@acme.com', subject: 'Invitation: board' }),
  ] };
  cfg.threadVotes = { k: { b: 'deals', t: 'Kestrel', c: 'high' }, m: { b: 'newsletters', t: null, c: 'high' },
    r: { b: 'mna', t: null, c: 'high' }, i: { b: 'calendar', t: null, c: 'high' } };
  const b = R.buildCards(snap, cfg, seeds);
  assert.equal(b.threadCards.k[0], 'entity:deals:Kestrel (Proj. Kite)'); // by label leaf
  assert.notEqual(b.threadCards.m[0], 'entity:mna:BigSoft');
  assert.deepEqual(R.threadMove('r', b, cfg), { bucket: 'mna', sublabel: 'Acme', by: 'ai' });
  assert.equal(R.threadMove('i', b, cfg), null); // an invitation still needs an answer
  const mine = { ...cfg, threadOverrides: { r: { bucket: 'portfolio' } } };
  assert.equal(R.threadMove('r', b, mine).by, 'you');
});

test('basic preset: clients are topics, the AI may add new ones, and no investor vocabulary applies', () => {
  const seeds = [
    { match: 'domain', value: 'acme.com', bucket: 'clients', name: 'Acme', sublabel: 'Acme' },
    { match: 'process', value: 'Acme', bucket: 'clients', name: 'Acme' }, // no processes configured: ignored
  ];
  const snap = { threads: [
    T({ id: 'a', from: 'bookkeeper@ledger.io', cc: ['ceo@acme.com'], subject: 'Acme NBO draft' }),
    T({ id: 'n', from: 'pm@newco.io', subject: 'Kickoff' }),
  ] };
  const cfg = { ...basic, threadVotes: { n: { b: 'clients', t: 'Newco', c: 'high' } } };
  const b = R.buildCards(snap, cfg, seeds);
  assert.deepEqual(b.threadCards.a, ['entity:clients:Acme']);
  assert.equal(b.threadCards.n[0], 'entity:clients:Newco');
  assert.ok(!b.cards.some((c) => c.kind === 'process'));
});

test('a process is generic: any bucket, any signal words', () => {
  const cfg = { ...basic, buckets: [...basic.buckets, { id: 'legal', name: 'Legal', label: '_Legal', subLabels: true }],
    processes: [{ bucket: 'legal', title: 'dispute', words: ['lawsuit'] }] };
  const seeds = [
    { match: 'domain', value: 'acme.com', bucket: 'clients', name: 'Acme' },
    { match: 'process', value: 'Acme', bucket: 'legal', name: 'Acme' },
  ];
  const snap = { threads: [T({ id: 'l', from: 'ceo@acme.com', subject: 'Acme lawsuit update' }), T({ id: 'w', from: 'ceo@acme.com', subject: 'Weekly sync' })] };
  const b = R.buildCards(snap, cfg, seeds);
  assert.equal(b.threadCards.l[0], 'process:Acme');
  assert.equal(b.cards.find((c) => c.key === 'process:Acme').title, 'Acme dispute');
  assert.equal(b.threadCards.w[0], 'entity:clients:Acme');
});

test('a per-thread decision overrides the rules for mail already in the inbox', () => {
  const snap = { threads: [T({ id: 'x', from: 'hello@weekly.io' })] };
  const b = R.buildCards(snap, config, []);
  const cfg = { ...config, threadOverrides: { x: { bucket: 'newsletters' } } };
  assert.equal(R.stats(snap, b, cfg).after.inbox, 0);
  assert.deepEqual(R.buildPlan(snap, b, cfg, []).backfill.map((e) => [e.label, e.threadIds]), [['_Newsletters', ['x']]]);
});

test('stats use union semantics: any archiving bucket takes the thread out of the inbox', () => {
  const snap = { threads: [T({ id: 'x', from: 'ceo@acme.com', subject: 'Accepted: board call' })] };
  const b = R.buildCards(snap, config, [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme' }]);
  assert.deepEqual(b.threadCards.x, ['entity:portfolio:Acme', 'pattern:cal']);
  const s = R.stats(snap, b, config);
  assert.equal(s.before.inbox, 1);
  assert.equal(s.after.inbox, 0); // portfolio keeps it, the calendar rule archives it: Gmail runs both
  assert.equal(s.after.byBucket.portfolio, 1);
});

test('stats say what Gmail already has: a thread with its label is sorted, one without it or still in the inbox changes on Apply', () => {
  const snap = { threads: [T({ id: 'a', from: 'ceo@acme.com', labels: ['INBOX', '_Portfolio'] }), T({ id: 'b', from: 'cfo@acme.com', subject: 'Q3 numbers' }),
    T({ id: 'n', from: 'hello@weekly.io', labels: ['INBOX', '_Newsletters'] }), T({ id: 'o', from: 'x@other.org', labels: ['INBOX', '_Old'] })] };
  const b = R.buildCards(snap, config, [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme' }]);
  const cfg = { ...config, cards: { [b.threadCards.n[0]]: { bucket: 'newsletters' } } }, a = R.stats(snap, b, cfg, { ownedLabels: ['_Old'] }).apply;
  assert.equal(a.byThread.a, undefined); // labelled in Gmail, stays in the inbox: nothing to do
  assert.deepEqual(a.byThread.b, { add: ['_Portfolio'], off: [], leaves: false });
  assert.deepEqual(a.byThread.n, { add: [], off: [], leaves: true }); // has its label, but its column skips the inbox
  assert.deepEqual(a.byThread.o.off, ['_Old']); // a label Labelboard made that the board no longer gives
  assert.deepEqual([a.threads, a.add, a.leave, a.off, a.sorted], [3, 1, 1, 1, 1]);
  assert.equal(R.stats(snap, b, cfg).apply.byThread.o, undefined); // labels you made never come off
});

test('after Apply runs its own plan, stats count nothing left to change', () => {
  const seeds = [{ match: 'domain', value: 'payco.io', bucket: 'portfolio', name: 'Payco' }, { match: 'domain', value: 'tollway.com', bucket: 'mna', name: 'Tollway', sublabel: 'Buyers', role: 'counterparty' },
    { match: 'email', value: 'jo@bigbank.com', bucket: 'mna', name: 'Bigbank', sublabel: 'Buyers', role: 'counterparty' }];
  const cfg = { ...config, patterns: [{ key: 'inv', title: 'Invitations', bucket: 'keep', subjects: ['Invitation:'] }] };
  // z: an unplaced counterparty's card claims it by domain, but its filter only names known people
  const snap = { threads: [T({ id: 'z', from: 'ceo@payco.io', cc: ['sam@tollway.com'] }), T({ id: 'i', from: 'jo@bigbank.com', subject: 'Invitation: lunch' }),
    T({ id: 's', from: 'jo@bigbank.com', subject: 'Deal terms' }), T({ id: 'x', from: 'ceo@acme.com', subject: 'Accepted: board call' })] };
  const b = R.buildCards(snap, cfg, seeds), owned = [], byId = {};
  snap.threads.forEach((t) => { byId[t.id] = t; });
  const plan = R.buildPlan(snap, b, cfg, seeds, { ownedLabels: owned });
  plan.labels.forEach((l) => owned.push(l.name));
  plan.backfill.forEach((e) => e.threadIds.forEach((id) => { const t = byId[id]; if (!t.labels.includes(e.label)) t.labels.push(e.label); if (e.archive) t.labels = t.labels.filter((l) => l !== 'INBOX'); }));
  plan.unlabel.forEach((e) => e.threadIds.forEach((id) => { byId[id].labels = byId[id].labels.filter((l) => l !== e.label); }));
  assert.deepEqual(R.stats(snap, b, cfg, { ownedLabels: owned }).apply.byThread, {});
  assert.deepEqual(byId.z.labels, ['INBOX', '_Portfolio']);
});

test('user placement overrides the suggestion; keep/unsorted write no filters', () => {
  const snap = { threads: [T({ id: 'y', from: 'hello@weekly.io' })] };
  const b = R.buildCards(snap, config, []);
  const key = b.cards[0].key;
  const placed = { ...config, cards: { [key]: { bucket: 'newsletters' } } };
  assert.equal(R.placement(b.cards[0], placed).bucket, 'newsletters');
  assert.equal(R.buildPlan(snap, b, placed, []).filters.length, 1);
  const kept = { ...config, cards: { [key]: { bucket: 'keep' } } };
  assert.equal(R.buildPlan(snap, b, kept, []).filters.length, 0);
  assert.equal(R.noFilterWhy(b.cards[0], placed), null);
  assert.equal(R.noFilterWhy(b.cards[0], kept), 'column');
});

test('who placed a card: you, Claude, or the suggestion\'s rule, Gmail labels or nothing', () => {
  const snap = { threads: [T({ id: 'n', from: 'hello@weekly.io' }), T({ id: 'g', from: 'ana@old.io', labels: ['INBOX', '_Newsletters'] }), T({ id: 'x', from: 'bo@quiet.io' })] };
  const b = R.buildCards(snap, config, []), by = (id) => b.cards.find((c) => c.threads.includes(id));
  assert.equal(R.placement(by('n'), config).who, 'rule');
  assert.equal(R.placement(by('g'), config).who, 'gmail');
  assert.equal(R.placement(by('x'), config).who, 'none');
  const k = by('x').key, mine = { ...config, cards: { [k]: { bucket: 'tools' } } }, claude = { ...config, cards: { [k]: { bucket: 'tools', by: 'claude', why: 'Invoices' } } };
  assert.equal(R.placement(by('x'), mine).who, 'you');
  assert.deepEqual([R.placement(by('x'), claude).who, R.placement(by('x'), claude).why, R.placement(by('x'), claude).decided], ['claude', 'Invoices', true]);
  const voted = { ...config, threadVotes: { x: { b: 'tools', t: null, c: 'high' } } };
  assert.equal(R.placement(R.buildCards(snap, voted, []).cards.find((c) => c.threads.includes('x')), voted).who, 'claude');
});

test('Claude\'s review lands as by: claude, never over yours, an unknown column or a card the board lacks', () => {
  const snap = { threads: [T({ id: 'a', from: 'a@one.io' }), T({ id: 'b', from: 'b@two.io' }), T({ id: 'c', from: 'c@three.io' })] };
  const b = R.buildCards(snap, config, []), key = (id) => b.cards.find((c) => c.threads.includes(id)).key;
  const cfg = { ...config, cards: { [key('a')]: { bucket: 'newsletters' }, [key('c')]: { bucket: 'keep', by: 'claude' } } };
  const review = { labelboard: 'claude-review', cards: { [key('a')]: { bucket: 'tools' }, [key('b')]: { bucket: 'tools', why: 'Receipts' }, [key('c')]: { bucket: 'tools' },
    'sender:gone@x.io': { bucket: 'tools' }, other: { bucket: 'nope' } }, threadVotes: { b: { b: 'tools', c: 'high' } } };
  const m = R.mergeReview(cfg, review, b);
  assert.deepEqual(m.n, { placed: 2, yours: 1, columns: 0, cards: 2 });
  assert.deepEqual(m.config.cards[key('a')], { bucket: 'newsletters' });
  assert.deepEqual(m.config.cards[key('b')], { bucket: 'tools', by: 'claude', why: 'Receipts' });
  assert.equal(m.config.cards[key('c')].bucket, 'tools'); // Claude's own earlier pick is replaced
  assert.equal(m.config.threadVotes.b.b, 'tools');
  assert.equal(cfg.cards[key('c')].bucket, 'keep'); // the input is not touched
  assert.equal(R.mergeReview(cfg, { cards: { [key('b')]: { bucket: 'nope' } } }, b).n.columns, 1);
});

test('the AI brief: cards you didn\'t place, newest first, never your own address; its text holds the answer format', () => {
  const snap = { threads: [T({ id: 'a1', from: 'a@one.io', subject: 'Old' }), { ...T({ id: 'a2', from: 'a@one.io', subject: 'New' }), date: '2026-10-05T00:00:00Z', snippet: 'x'.repeat(200) },
    T({ id: 'b', from: 'b@two.io' }), T({ id: 'c', from: 'me@firm.com', to: ['c@three.io'], subject: 'Mine' })] };
  const b = R.buildCards(snap, config, []), key = (id) => b.cards.find((c) => c.threads.includes(id)).key;
  const cfg = { ...config, cards: { [key('b')]: { bucket: 'tools' } } };
  const brief = R.reviewBrief(snap, b, cfg, false), a = brief.cards.find((c) => c.key === key('a1'));
  assert.ok(!brief.cards.some((c) => c.key === key('b'))); // you placed it
  assert.ok(R.reviewBrief(snap, b, cfg, true).cards.some((c) => c.key === key('b')));
  assert.deepEqual(a.subjects, ['New', 'Old']);
  assert.deepEqual(a.from, ['a@one.io']);
  assert.equal(a.newest.length, 140);
  assert.equal(brief.columns.length, cfg.buckets.length);
  assert.ok(brief.cards.every((c) => !c.from.includes('me@firm.com')));
  const text = R.briefText(brief);
  assert.ok(text.includes('"labelboard": "claude-review"') && text.includes(JSON.stringify(key('a1'))));
  assert.ok(!text.includes('me@firm.com') && !text.includes('`unsorted`:'));
});

test('the filters alone (for the board on every move) are the plan\'s filters, and an unplaced company with no known person writes none', () => {
  const seeds = [{ match: 'domain', value: 'bigsoft.com', bucket: 'mna', name: 'BigSoft', sublabel: 'Buyers', role: 'counterparty' }, { match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme' }];
  const snap = { threads: [T({ id: 'a', from: 'ceo@acme.com' }), T({ id: 's', from: 'Ana <ana@bigsoft.com>', subject: 'Intro' })] };
  const b = R.buildCards(snap, config, seeds), pf = R.planFilters(b, config), plan = R.buildPlan(snap, b, config, seeds);
  assert.deepEqual(pf.filters, plan.filters);
  assert.ok(Object.keys(pf.groups).some((k) => pf.groups[k].cards.includes('entity:portfolio:Acme')));
  const big = { key: 'x', role: 'counterparty', terms: [{ field: 'from', value: 'bigsoft.com' }], suggestion: { bucket: 'mna' } };
  assert.equal(R.noFilterWhy(big, config), 'people');
  assert.equal(R.noFilterWhy(big, { ...config, cards: { x: { bucket: 'mna' } } }), null); // placed: the whole domain
});

test('a filter query keeps its order when card sizes change (Apply moving mail out must not remake the filter)', () => {
  const snap = { threads: [T({ id: 'a', from: 'news@zeta.io' }), T({ id: 'b', from: 'news@alpha.io' }), T({ id: 'c', from: 'news@alpha.io' })] };
  const b = R.buildCards(snap, config, []), cards = {};
  b.cards.forEach((c) => { cards[c.key] = { bucket: 'newsletters' }; });
  const q = (built) => R.planFilters(built, { ...config, cards }).filters.map((f) => f.query);
  assert.deepEqual(q({ ...b, cards: b.cards.slice().reverse() }), q(b));
});

test('long OR-lists split into several filters under the length cap', () => {
  const terms = Array.from({ length: 80 }, (_, i) => ({ field: 'participant', value: `company${i}.com.br` }));
  const qs = R.chunkQueries(terms, 800);
  assert.ok(qs.length > 1);
  qs.forEach((q) => assert.ok(q.length <= 800));
  assert.equal(qs.join(' OR ').split(' OR ').length, 80 * 2); // from: + to: (to: covers Cc)
});

test('diff only removes filters the tool owns', () => {
  const plan = [{ query: 'from:a.com', label: 'X', archive: false }];
  const existing = [
    { query: 'from:old.com', label: 'X', archive: false, owned: true },
    { query: 'from:theirs.com', label: 'Y', archive: true, owned: false },
    { query: 'from:a.com', label: 'X', archive: false, owned: true },
  ];
  const d = R.diffFilters(plan, existing);
  assert.equal(d.create.length, 0);
  assert.deepEqual(d.remove.map((f) => f.query), ['from:old.com']);
});

test('a column\'s own Gmail label counts toward it without any labelMap entry', () => {
  const snap = { threads: [T({ id: 'a', from: 'x@vendor.io', labels: ['INBOX', '_Tools'] }), T({ id: 'b', from: 'y@vendor.io', labels: ['INBOX', '_Tools/Billing'] })] };
  const b = R.buildCards(snap, { ...basic, labelMap: {} }, []);
  assert.equal(b.cards[0].suggestion.bucket, 'tools');
  assert.equal(R.labelMapOf({ ...basic, labelMap: { _Tools: 'clients' } })._Tools, 'clients'); // yours wins
});

test('previewing a Gmail search on the snapshot: the common subset, null for what metadata cannot answer', () => {
  const t = T({ from: 'ed@news.strictlyvc.com', to: ['me@firm.com'], cc: ['team@acme.com'], subject: 'Weekly: deals [VC]', labels: ['INBOX', 'Newsletters'] });
  const yes = (q) => assert.ok(R.parseQuery(q)(t), q);
  const no = (q) => assert.ok(!R.parseQuery(q)(t), q);
  yes('from:@strictlyvc.com'); yes('from:(a.com OR strictlyvc.com)'); yes('to:acme.com'); yes('cc:team@acme.com');
  yes('subject:"deals [VC]"'); yes('{from:zzz.com subject:weekly}'); yes('label:newsletters in:inbox'); yes('from:ed');
  no('from:strictlyvc.com -subject:weekly'); no('from:strictlyvc.com subject:(weekly monthly)'); no('to:strictlyvc.com');
  assert.equal(R.parseQuery('list:(<a.b.c>)'), null);
  assert.equal(R.parseQuery('invoice from:a.com'), null); // a bare word searches bodies too
  assert.equal(R.parseQuery('from:(a OR'), null);
});

test('your Gmail filters on the board: matches, overlap with board labels, adopt rules, adopted ones in the plan', () => {
  const snap = { threads: [T({ id: 'n', from: 'ed@strictlyvc.com' }), T({ id: 'o', from: 'x@other.io' }), T({ id: 'a', from: 'ed@strictlyvc.com', labels: ['Newsletters'] })] };
  const b = R.buildCards(snap, basic, []);
  const cfg = { ...basic, cards: { 'domain:strictlyvc.com': { bucket: 'newsletters' } } };
  const gmail = { filters: [
    { id: 'f1', query: 'from:@strictlyvc.com', labels: ['Newsletters'], archive: true, extras: [], owned: false },
    { id: 'f2', query: 'list:(<x>)', labels: ['A', 'B'], archive: false, extras: [], owned: false },
    { id: 'f3', query: 'from:x.io', labels: ['_Tools'], archive: false, extras: ['marks it read'], owned: false },
    { id: 'f4', query: 'from:strictlyvc.com', labels: ['_Newsletters'], archive: true, extras: [], owned: true }, // the board's own
  ] };
  const v = R.gmailFilters(gmail, snap, b, cfg);
  assert.deepEqual(v.map((f) => f.id), ['f1', 'f2', 'f3']);
  assert.deepEqual(v[0].threads, ['n', 'a'], 'archived mail it took out of the inbox counts too');
  assert.deepEqual(v[0].overlap, { _Newsletters: 2 });
  assert.equal(v[0].why, null);
  assert.equal(v[1].threads, null);
  assert.match(v[1].why, /2 labels/);
  assert.match(v[2].why, /marks it read/);
  // adopted: written exactly as kept (no churn in Gmail), its label joins the plan; off = deleted on Apply
  const adopted = { ...cfg, adopted: { f1: { query: 'from:@strictlyvc.com', label: 'Newsletters', archive: true } } };
  const plan = R.buildPlan(snap, b, adopted, []);
  assert.ok(plan.filters.some((f) => f.query === 'from:@strictlyvc.com' && f.label === 'Newsletters' && f.archive));
  assert.ok(plan.labels.some((l) => l.name === 'Newsletters'));
  const av = R.gmailFilters(gmail, snap, b, adopted).find((f) => f.id === 'f1');
  assert.ok(av.adopted && av.inGmail);
  adopted.adopted.f1.off = true;
  assert.ok(!R.buildPlan(snap, b, adopted, []).filters.some((f) => f.query === 'from:@strictlyvc.com'));
});

test('re-sort: a card that moved takes its old label off, but only a label Labelboard created', () => {
  const snap = { threads: [T({ id: 'm', from: 'ed@weekly.io', labels: ['INBOX', '_Tools', 'Mine'] })] };
  const b = R.buildCards(snap, basic, []);
  const cfg = { ...basic, cards: { 'domain:weekly.io': { bucket: 'newsletters' } } };
  const plan = R.buildPlan(snap, b, cfg, [], { ownedLabels: ['_Tools', '_Newsletters'] });
  assert.deepEqual(plan.unlabel, [{ label: '_Tools', threadIds: ['m'] }]);
  assert.deepEqual(R.buildPlan(snap, b, cfg, []).unlabel, []); // nothing known as ours: nothing taken off
});

test('read age in words; stale after an hour', () => {
  const at = Date.parse('2026-10-15T10:00:00Z');
  assert.deepEqual(R.readAge('2026-10-15T10:00:00Z', at + 30 * 60000), { minutes: 30, text: '30 min ago', stale: false });
  assert.equal(R.readAge('2026-10-15T10:00:00Z', at + 3 * 3600000).text, '3 hours ago');
  assert.ok(R.readAge('2026-10-15T10:00:00Z', at + 3 * 3600000).stale);
  assert.equal(R.readAge('2026-10-15T10:00:00Z', at + 26 * 3600000).text, '1 day ago');
});

test('XML fallback escapes queries and marks archiving filters', () => {
  const xml = R.toGmailXml({ filters: [{ query: 'from:a.com OR subject:"Q&A"', label: '_M&A', archive: true }] });
  assert.match(xml, /value='from:a.com OR subject:&quot;Q&amp;A&quot;'/);
  assert.match(xml, /shouldArchive/);
});

test('a column that is gone: its cards wait in Unsorted, orphans() names it, remapBuckets moves every reference', () => {
  const snap = { threads: [T({ id: 'o', from: 'ceo@acme.com' }), T({ id: 'p', from: 'x@other.io' })] };
  const seeds = [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Acme' }];
  const cfg = { ...config, cards: { 'domain:other.io': { bucket: 'dealflow' } }, threadOverrides: { o: { bucket: 'portfolio', sublabel: 'Acme' } },
    threadVotes: { o: { b: 'portfolio', t: 'Acme', c: 'high' } } };
  const swapped = { ...cfg, buckets: basic.buckets }; // the basic preset has no portfolio or dealflow
  const b = R.buildCards(snap, swapped, seeds);
  const acme = b.cards.find((c) => c.key === 'entity:portfolio:Acme');
  assert.deepEqual(R.placement(acme, swapped), { bucket: 'unsorted', sublabel: null, decided: false, lost: 'portfolio', who: 'none' });
  const lost = Object.fromEntries(R.orphans(swapped, b, seeds).map((o) => [o.id, o]));
  assert.deepEqual(Object.keys(lost).sort(), ['dealflow', 'mna', 'portfolio']); // mna: the investor sale process
  assert.equal(lost.portfolio.cards, 1);
  assert.equal(lost.portfolio.seeds, 1);
  assert.deepEqual(lost.portfolio.refs, { threadOverrides: 1, threadVotes: 1, aliasBuckets: 1, 'processes.from': 1 });
  const fixed = R.remapBuckets(swapped, { portfolio: 'clients', dealflow: 'unsorted', mna: 'clients' });
  assert.equal(fixed.cards['domain:other.io'], undefined); // sent to Unsorted: the suggestion takes over
  assert.deepEqual(fixed.threadOverrides.o, { bucket: 'clients', sublabel: 'Acme' }); // clients has sub-labels
  assert.equal(fixed.threadVotes.o.b, 'clients');
  assert.equal(fixed.aliasBuckets['deals@firm.com'], 'clients');
  assert.deepEqual(fixed.processes[0], { ...config.processes[0], bucket: 'clients', from: ['clients'] });
  assert.equal(swapped.threadVotes.o.b, 'portfolio'); // a copy: the input is untouched
  const s2 = R.remapSeeds(seeds, { portfolio: 'clients' });
  assert.deepEqual(R.orphans(fixed, R.buildCards(snap, fixed, s2), s2), []);
});

// ---------- what a card does: its own actions, a condition, archiving later ----------
const acmeSeed = [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Acme' }];
const acmeSnap = () => ({ threads: [
  T({ id: 'a1', from: 'ceo@acme.com', to: ['deals@firm.com'], labels: ['INBOX', 'UNREAD'] }),
  T({ id: 'a2', from: 'ceo@acme.com', to: ['me@firm.com'], labels: ['INBOX'] }),
  T({ id: 'z', from: 'ana@zeta.com', labels: ['INBOX'] })] });
const zetaSeed = [{ match: 'domain', value: 'zeta.com', bucket: 'portfolio', name: 'Zeta' }];

test('a card that skips the inbox gets a filter of its own; the rest of its column keeps theirs', () => {
  const snap = acmeSnap(), seeds = acmeSeed.concat(zetaSeed), b = R.buildCards(snap, config, seeds);
  const before = R.buildPlan(snap, b, config, seeds);
  const cfg = { ...config, cards: { 'entity:portfolio:Acme': { bucket: 'portfolio', act: { archive: true } } } };
  const plan = R.buildPlan(snap, b, cfg, seeds);
  const port = plan.filters.filter((f) => f.label === '_Portfolio');
  assert.equal(port.length, 2);
  assert.ok(port.some((f) => f.archive && /acme\.com/.test(f.query) && !/zeta/.test(f.query)));
  assert.ok(port.some((f) => !f.archive && /zeta\.com/.test(f.query) && !/acme/.test(f.query)));
  assert.equal(before.filters.filter((f) => f.label === '_Portfolio').length, 1); // nothing set: one shared filter, as before
  const st = R.stats(snap, b, cfg);
  assert.ok(st.apply.byThread.a1.leaves && st.apply.byThread.a2.leaves && !(st.apply.byThread.z || {}).leaves);
  assert.ok(plan.backfill.some((e) => e.label === '_Portfolio' && e.archive && e.threadIds.includes('a1') && !e.threadIds.includes('z')));
});

test('a card can keep its mail in the inbox when its column skips it', () => {
  const snap = { threads: [T({ id: 'n', from: 'hello@weekly.io' }), T({ id: 'm', from: 'news@other.io' })] }, b = R.buildCards(snap, config, []);
  const key = b.threadCards.n[0], cfg = { ...config, cards: { [key]: { bucket: 'newsletters', act: { archive: false } }, [b.threadCards.m[0]]: { bucket: 'newsletters' } } };
  const fs = R.buildPlan(snap, b, cfg, []).filters.filter((f) => f.label === '_Newsletters');
  assert.ok(fs.some((f) => !f.archive && /weekly\.io/.test(f.query)) && fs.some((f) => f.archive && /other\.io/.test(f.query)));
  assert.ok(!fs.some((f) => f.archive && /weekly\.io/.test(f.query))); // never in the archiving OR-list: Gmail runs every match
  const st = R.stats(snap, b, cfg);
  assert.ok(!st.apply.byThread.n.leaves && st.apply.byThread.m.leaves);
});

test('a condition narrows the yeses: the label always goes on, skip inbox only where it matches', () => {
  const snap = acmeSnap(), b = R.buildCards(snap, config, acmeSeed);
  const cfg = { ...config, cards: { 'entity:portfolio:Acme': { bucket: 'portfolio', act: { archive: true, read: true }, when: { via: 'deals@firm.com' } } } };
  const plan = R.buildPlan(snap, b, cfg, acmeSeed);
  const port = plan.filters.filter((f) => f.label === '_Portfolio');
  assert.ok(port.some((f) => !f.archive && !f.read)); // the label for all its mail
  const cond = port.find((f) => f.archive);
  assert.ok(cond.read && /to:deals@firm\.com/.test(cond.query));
  const st = R.stats(snap, b, cfg);
  assert.deepEqual(st.apply.byThread.a1, { add: ['_Portfolio', '_Portfolio/Acme'], off: [], leaves: true, read: true });
  assert.ok(!st.apply.byThread.a2.leaves && st.apply.byThread.a2.add.includes('_Portfolio'));
  const e = plan.backfill.find((x) => x.label === '_Portfolio' && x.read);
  assert.deepEqual(e.threadIds, ['a1']);
});

test('conditions: not sent to you by name, attachments, subject words and exceptions, on the board and as Gmail search', () => {
  const w = R.whenOf({ notMe: true, att: true, subject: ['report'], except: ['boss@acme.com', 'urgent'] });
  const t = (o) => ({ ...T({ from: 'ceo@acme.com', subject: 'Monthly report', ...o }), dir: 0, att: 1, ...o });
  assert.ok(R.whenMatches(w, t({})));
  assert.ok(!R.whenMatches(w, t({ dir: 1 })) && !R.whenMatches(w, t({ dir: undefined }))); // read before it was noted: not matching
  assert.ok(!R.whenMatches(w, t({ att: 0 })) && !R.whenMatches(w, t({ subject: 'Hello' })));
  assert.ok(!R.whenMatches(w, t({ subject: 'URGENT: report' })) && !R.whenMatches(w, t({ from: 'boss@acme.com' })));
  assert.equal(R.whenQuery(w, ['me@firm.com']), '-to:me@firm.com has:attachment (subject:"report") -from:boss@acme.com -to:boss@acme.com -subject:"urgent"');
  assert.equal(R.whenOf({ subject: [' '], except: [] }), null);
});

test('star, importance and delete are filter actions for new mail; delete takes mail already here out of the inbox', () => {
  const snap = acmeSnap(), b = R.buildCards(snap, config, acmeSeed);
  const cfg = { ...config, cards: { 'entity:portfolio:Acme': { bucket: 'portfolio', act: { star: true, important: 'never', trash: true } } } };
  const f = R.buildPlan(snap, b, cfg, acmeSeed).filters.find((x) => x.label === '_Portfolio' && /acme/.test(x.query));
  assert.deepEqual([f.star, f.important, f.trash, f.archive], [true, 'never', true, false]);
  assert.ok(R.stats(snap, b, cfg).apply.byThread.a2.leaves);
  assert.match(R.toGmailXml({ filters: [f] }), /shouldStar.*shouldTrash.*shouldNeverMarkAsImportant/);
});

test('archiving later: one rule per card with its own searches, none without', () => {
  const snap = acmeSnap(), b = R.buildCards(snap, config, acmeSeed);
  assert.deepEqual(R.laterRules(b, config), []);
  const cfg = { ...config, cards: { 'entity:portfolio:Acme': { bucket: 'portfolio', later: { days: 3 }, when: { via: 'deals@firm.com' } } } };
  const rules = R.laterRules(b, cfg);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].days, 3);
  assert.match(rules[0].queries[0], /^\(.*acme\.com.*\) to:deals@firm\.com$/);
  assert.deepEqual(R.buildPlan(snap, b, cfg, acmeSeed).later, rules);
  assert.deepEqual(R.laterOf({ read: true }), { read: true });
  assert.equal(R.laterOf({ days: 0 }), null);
});

test('when mail leaves the inbox: the column answers once, a card follows it or gives its own', () => {
  const snap = acmeSnap(), b = R.buildCards(snap, config, acmeSeed);
  const cols = JSON.parse(JSON.stringify(config.buckets)), port = cols.find((x) => x.id === 'portfolio');
  R.setLeaves(port, 'd3');
  assert.deepEqual([port.archive, port.later, R.leavesOf(port)], [false, { days: 3 }, 'd3']);
  const cfg = { ...config, buckets: cols, cards: {} };
  const rules = R.laterRules(b, cfg);
  assert.deepEqual(rules.map((r) => [r.id, r.days]), [['col:portfolio', 3]]); // one search for the column, not one per card
  assert.match(rules[0].queries[0], /acme\.com/);
  // the column's filters don't change: archiving later is Labelboard's hourly check, not a Gmail filter
  assert.deepEqual(R.planFilters(b, cfg).filters, R.planFilters(b, config).filters);
  const own = { bucket: 'portfolio' };
  R.setCardLeaves(own, 'never');
  assert.deepEqual([own.act, own.later, R.cardLeaves(own)], [{ archive: false }, { off: true }, 'never']);
  const never = R.laterRules(b, { ...cfg, cards: { 'entity:portfolio:Acme': own } });
  assert.ok(never.every((r) => r.id.startsWith('col:') && !/acme\.com/.test(r.queries.join(' ')))); // the rest of the column still goes
  R.setCardLeaves(own, 'read');
  assert.deepEqual(R.laterRules(b, { ...cfg, cards: { 'entity:portfolio:Acme': own } }).filter((r) => !r.id.startsWith('col:')).map((r) => [r.id, r.read]), [['entity:portfolio:Acme', true]]);
  R.setCardLeaves(own, '');
  assert.deepEqual([own.act, own.later, R.cardLeaves(own)], [undefined, undefined, '']);
  R.setLeaves(port, 'now'); // right away is Gmail's: the timing goes
  assert.deepEqual([port.archive, port.later, R.laterRules(b, cfg)], [true, undefined, []]);
  assert.equal(R.cardLeaves({ act: { archive: false } }), 'never'); // a card set before the menu existed reads as it did
});

test('leaving later counts as leaving once the hourly run would take it, and Apply still leaves it alone', () => {
  const old = '2001-01-01T00:00:00Z', fresh = new Date().toISOString();
  const snap = { threads: [T({ id: 'o', from: 'ceo@acme.com' }), T({ id: 'n', from: 'cfo@acme.com' }), T({ id: 'u', from: 'ana@acme.com', labels: ['INBOX', 'UNREAD'] })] };
  snap.threads.forEach((t, i) => { t.date = [old, fresh, old][i]; }); // its newest message
  const b = R.buildCards(snap, config, acmeSeed), cols = JSON.parse(JSON.stringify(config.buckets)), port = cols.find((x) => x.id === 'portfolio');
  const at = (cfg) => { const st = R.stats(snap, b, cfg); return [st.after.inbox, st.after.later, st.after.archivedByBucket.portfolio || 0, st.apply.leave]; };
  R.setLeaves(port, 'd3');
  const cfg = { ...config, buckets: cols, cards: {} };
  assert.deepEqual(at(cfg), [1, 2, 2, 0]); // the two old threads go on the hourly run, the fresh one stays; Apply archives none
  assert.deepEqual(R.buildPlan(snap, b, cfg, acmeSeed).backfill, R.buildPlan(snap, b, { ...config, cards: {} }, acmeSeed).backfill); // what Apply sends is unchanged
  R.setLeaves(port, 'read');
  assert.deepEqual(at(cfg), [1, 2, 2, 0]); // once read: the read ones go whatever their age, the unread one stays
  assert.deepEqual(snap.threads.map((t) => R.threadPlace(t, b, cfg).later), [true, true, false]);
  const own = { bucket: 'portfolio', when: { subject: ['invoice'] } };
  assert.deepEqual(at({ ...cfg, cards: { 'entity:portfolio:Acme': own } }), [3, 0, 0, 0]); // its condition holds the run back, as laterRules' search would
  R.setLeaves(port, 'now');
  assert.deepEqual(at(cfg).slice(1), [0, 3, 3]); // right away is Apply's, not the hourly run's
  const p = R.threadPlace(snap.threads[0], b, { ...config, buckets: cols.map((x) => (x.id === 'portfolio' ? { ...x, archive: false, later: { days: 3 } } : x)), cards: {} });
  assert.deepEqual([p.leaves, p.later, p.out], [false, true, true]);
});

// ---------- the colleague cards: only colleagues on it, or colleagues with people outside ----------
const team = { id: 'team', name: 'Team only', label: 'Team only', archive: false, color: { backgroundColor: '#999999', textColor: '#ffffff' } };
const firmSnap = () => ({ threads: [
  T({ id: 'in', from: 'ana@firm.com', to: ['bo@firm.com'], cc: ['me@firm.com'], labels: ['INBOX'] }),
  T({ id: 'out', from: 'ana@firm.com', cc: ['lawyer@lex.io'], labels: ['INBOX', 'Team only'] }),
  T({ id: 'acme', from: 'ana@firm.com', subject: 'Acme board pack', labels: ['INBOX'] }),
  T({ id: 'ext', from: 'ceo@zeta.io', cc: ['ana@firm.com'], labels: ['INBOX'] })] });
const firmCfg = (cards, cols) => ({ ...config, buckets: config.buckets.concat(cols || [team]), cards: cards || { 'firm:colleagues': { bucket: 'team' } } });

test('who is on a thread: only colleagues, colleagues with people outside, or written by someone outside', () => {
  const c = { me: ['me@home.net'], firmDomains: ['firm.com'] };
  assert.equal(R.whoIsOn(T({ from: 'ana@firm.com', to: ['bo@eu.firm.com'], cc: ['me@home.net'] }), c), 'only');
  assert.equal(R.whoIsOn(T({ from: 'me@home.net', to: [] }), c), 'only'); // a note to yourself
  assert.equal(R.whoIsOn(T({ from: 'ana@firm.com', to: ['bo@firm.com'], cc: ['x@lex.io'] }), c), 'outside');
  assert.equal(R.whoIsOn(T({ from: 'x@lex.io', to: ['ana@firm.com'] }), c), '');
  assert.equal(R.whoIsOn(T({ from: 'ana@firm.com', to: ['ana@notfirm.com'] }), c), 'outside');
});

test('colleague mail splits into two cards by who is on it, and neither makes a Gmail filter', () => {
  const snap = firmSnap(), b = R.buildCards(snap, config, acmeSeed);
  assert.deepEqual([b.threadCards.in, b.threadCards.out, b.threadCards.acme], [['firm:colleagues'], ['firm:outside'], ['entity:portfolio:Acme']]);
  const cfg = firmCfg(), plan = R.buildPlan(snap, b, cfg, acmeSeed, { ownedLabels: ['Team only'] });
  assert.ok(!plan.filters.some((f) => /firm\.com/.test(f.query)), 'Gmail search can\'t say "nobody else"');
  assert.ok(plan.labels.some((l) => l.name === 'Team only'));
  assert.equal(R.noFilterWhy(b.cards.find((c) => c.key === 'firm:colleagues'), cfg), 'hourly');
  // inbox now: the only-colleagues threads get it, the Acme one too (it is a rule, like a filter); the one with a lawyer loses it
  const got = plan.backfill.filter((e) => e.label === 'Team only').flatMap((e) => e.threadIds).sort();
  assert.deepEqual(got, ['acme', 'in']);
  assert.deepEqual(plan.unlabel, [{ label: 'Team only', threadIds: ['out'] }]);
  const rule = plan.later.find((r) => r.kind === 'people');
  assert.deepEqual([rule.id, rule.side, rule.labels, rule.solo, rule.firm, rule.me], ['who:firm:colleagues', 'only', ['Team only'], ['Team only'], ['firm.com'], ['me@firm.com']]);
  assert.deepEqual(R.laterRules(b, cfg), plan.later);
});

test('the hourly run: labels what fits, takes its own label off what no longer does, leaves the rest', () => {
  const snap = firmSnap(), b = R.buildCards(snap, config, []), cols = [{ ...team, archive: true }];
  const rule = R.peopleRules(b, firmCfg(null, cols))[0], t = (o) => T({ from: 'ana@firm.com', to: ['bo@firm.com'], ...o });
  assert.deepEqual(R.peopleChange(rule, t({ labels: ['INBOX', 'UNREAD'] }), ['Team only']), { add: ['Team only'], remove: ['INBOX'] });
  assert.equal(R.peopleChange(rule, t({ labels: ['Team only'] }), ['Team only']), null); // labelled before: done then
  const joined = t({ cc: ['x@lex.io'], labels: ['INBOX', 'Team only'] });
  assert.deepEqual(R.peopleChange(rule, joined, ['Team only']), { add: [], remove: ['Team only'] });
  assert.equal(R.peopleChange(rule, joined, []), null, 'a label you handed over is never taken off');
  // another card's Gmail filter also gives the label: the hourly run only adds it
  const cfg = firmCfg({ 'firm:colleagues': { bucket: 'team' }, 'entity:portfolio:Acme': { bucket: 'team' } }, cols);
  const shared = R.peopleRules(R.buildCards(snap, config, acmeSeed), cfg, null)[0];
  assert.deepEqual(shared.solo, []);
  assert.equal(R.peopleChange(shared, joined, ['Team only']), null);
  // both colleague cards in one column: a thread moving from one to the other keeps the label
  const both = R.peopleRules(b, firmCfg({ 'firm:colleagues': { bucket: 'team' }, 'firm:outside': { bucket: 'team' } }));
  assert.equal(R.peopleChanges(both, joined, ['Team only']), null);
  assert.deepEqual(R.peopleChanges(both, t({ labels: ['INBOX'] }), ['Team only']), { add: ['Team only'], remove: [] });
  // a card's own actions ride along: star, never important, mark read
  const own = R.peopleRules(b, firmCfg({ 'firm:colleagues': { bucket: 'team', act: { star: true, important: 'never', read: true } } }))[0];
  assert.deepEqual(R.peopleChange(own, t({ labels: ['INBOX'] }), []), { add: ['Team only', 'STARRED'], remove: ['UNREAD', 'IMPORTANT'] });
});

test('a colleague card you placed keeps its rule with no mail in the read, and archives later only its label', () => {
  const b = R.buildCards({ threads: [T({ id: 'z', from: 'ceo@zeta.io' })] }, config, []);
  const cols = [{ ...team, later: { days: 2 } }], rules = R.laterRules(b, firmCfg({ 'firm:outside': { bucket: 'team' } }, cols));
  assert.deepEqual(rules.map((r) => [r.id, r.label || null, r.days || null]), [['firm:outside', 'Team only', 2], ['who:firm:outside', null, null]]);
  assert.equal(rules[0].queries[0], '(from:firm.com)');
  assert.deepEqual(R.laterRules(b, firmCfg({})), []); // not placed: no rule
});

test('applying on its own: the plan Review would send, nothing only you start, and a settings key that ignores view picks', () => {
  const snap = acmeSnap(), seeds = acmeSeed.concat(zetaSeed), b = R.buildCards(snap, config, seeds);
  const full = R.buildPlan(snap, b, config, seeds), auto = R.autoPlan(snap, null, config, seeds, { ownedLabels: ['_Portfolio/Old'] });
  assert.deepEqual(auto.filters, full.filters);
  assert.deepEqual([auto.unlabel, auto.moves, auto.handover, auto.adopt, auto.auto], [[], [], [], [], true]);
  assert.ok(auto.backfill.every((e) => e.threadIds.length), 'only what Gmail doesn\'t have yet');
  assert.equal(R.settingsKey({ ...config, ui: { view: 'gmail' }, release: ['f1'] }), R.settingsKey(config));
  assert.notEqual(R.settingsKey({ ...config, cards: { x: { bucket: 'keep' } } }), R.settingsKey(config));
  // a thread that has its label and stays in the inbox is left alone; one that leaves keeps it in `had`
  const byId = { a: { labels: ['INBOX', 'L'] }, b: { labels: ['INBOX'] } };
  assert.deepEqual(R.trimBackfill([{ label: 'L', threadIds: ['a', 'b'] }], byId).map((e) => e.threadIds), [['b']]);
  assert.deepEqual(R.trimBackfill([{ label: 'L', archive: true, threadIds: ['a', 'b'] }], byId)[0].had, ['a']);
});

test('an idea for a card: mostly through a group address and never answered → skip the inbox when it comes that way', () => {
  const ts = [1, 2, 3].map((i) => T({ id: 'h' + i, from: 'ceo@acme.com', to: ['deals@firm.com'] }));
  const snap = { threads: ts }, b = R.buildCards(snap, config, acmeSeed), byId = Object.fromEntries(ts.map((t) => [t.id, t]));
  const c = b.cards.find((x) => x.key === 'entity:portfolio:Acme');
  const hint = R.actionHint(c, byId, config);
  assert.deepEqual([hint.act, hint.when], [{ archive: true }, { via: 'deals@firm.com' }]);
  byId.h1 = { ...byId.h1, msgs: [[1, 0], [2, 1]] }; // you answered one
  assert.equal(R.actionHint(c, byId, config), null);
  assert.equal(R.actionHint(c, Object.fromEntries(ts.map((t) => [t.id, t])), { ...config, cards: { [c.key]: { act: { read: true } } } }), null);
});
