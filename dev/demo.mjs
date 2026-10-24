// A made-up mailbox for screenshots and demos: Sam at Fernwood, a small design studio, on the basic preset.
// Usage: node dev/demo.mjs [outDir]  (default ~/.labelboard-demo), then node dev/serve.mjs <outDir>.
// Seeded, so ids and card keys are the same every run; dates count back from now, so it always looks fresh.
// Every address is on the reserved .example TLD: no real person, company or domain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js'), Sync = require('../src/server/Sync.js'), basic = require('../presets/basic.json');
const ME = 'sam@fernwood.example', FIRM = 'fernwood.example', ALIAS = 'studio@fernwood.example';

function rng(seed) { // mulberry32
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const COLLEAGUES = [['lena@fernwood.example', 'Lena Park'], ['omar@fernwood.example', 'Omar Haddad'], ['priya@fernwood.example', 'Priya Nair']];
// [name, domain, people, inbox threads, work on the go]
const CLIENTS = [
  ['Halcyon Foods', 'halcyonfoods.example', [['maria.costa', 'Maria Costa'], ['ben', 'Ben Okafor'], ['procurement', 'Halcyon Procurement']], 46, ['packaging round 2', 'shelf mockups', 'brand guidelines v3', 'photo shoot schedule']],
  ['Brightline Transit', 'brightline.example', [['jo.lindqvist', 'Jo Lindqvist'], ['amir', 'Amir Shah']], 34, ['wayfinding signage', 'station map', 'site visit notes', 'app icons']],
  ['Copperleaf Health', 'copperleaf.example', [['dr.reyes', 'Elena Reyes'], ['comms', 'Tom Becker']], 27, ['patient leaflet', 'clinic signage', 'annual report layout']],
  ['Nordvik Outdoor', 'nordvik.example', [['kari', 'Kari Solberg'], ['erik.dahl', 'Erik Dahl']], 22, ['catalog spread', 'winter campaign', 'store windows']],
  ['Tidewater Bank', 'tidewater.example', [['h.ng', 'Hannah Ng'], ['legal.review', 'Paul Whitfield']], 16, ['card redesign', 'accessibility audit', 'pitch deck']],
  ['Juniper & Co', 'juniperco.example', [['noor', 'Noor Aziz']], 9, ['menu design', 'opening invite']],
  ['Atlas Robotics', 'atlasrobotics.example', [['dev.patel', 'Dev Patel'], ['kim', 'Kim Tran']], 12, ['trade show booth', 'product one-pager', 'website hero']],
];
const CLIENT_SUBJECTS = ['{c}: {w}', 'Re: {c} {w}', 'Feedback on {w}', '{w}: next steps', 'Re: {w}', 'Quick question about the {w}', '{c} | {w} timeline', 'Invoice for {w}'];
const CLIENT_SNIPPETS = ['Thanks for sending these over. A few notes from the team before Thursday:', 'Can we move the review to next week? Legal still has the copy.',
  'Love the direction. Could we try the second option in the darker green?', 'Attached are the final specs from the printer.', 'Following up on my last email about the timeline.',
  'The board signed off on round two. Let us know what you need from us.', 'Quick one: which file should we send to the agency?'];
const TOOLS = [
  ['notifications@tasktrack.example', 'TaskTrack', ['{p} commented on "{w}"', '{p} assigned you "{w}"', 'Your weekly summary']],
  ['no-reply@filedrop.example', 'FileDrop', ['{p} shared "{w}" with you', 'New files in "{w}"']],
  ['billing@cloudhost.example', 'CloudHost', ['Your invoice is available', 'Payment received, thank you']],
  ['alerts@uptimewatch.example', 'UptimeWatch', ['fernwood.example is back up', 'Weekly uptime report']],
  ['noreply@invoicely.example', 'Invoicely', ['Invoice paid by {c}', 'Reminder: invoice due']],
  ['security@accounts.example', 'Accounts', ['New sign-in on Mac', 'Your password was changed']],
];
const NEWS = [['newsletter@designweekly.example', 'Design Weekly'], ['digest@typeletter.example', 'Typeletter'], ['weekly@brandnotes.example', 'Brand Notes'],
  ['news@makersmonthly.example', 'Makers Monthly'], ['editor@thegrid.example', 'The Grid']];
const NEWS_SUBJECTS = ['The year in packaging', 'Five typefaces worth a look', 'Issue {n}: color in motion', 'What clients actually read', 'Grids, again', 'This week in design'];
const COLD = [['sales@leadgenius.example', 'Lead Genius', 'Quick question about Fernwood'], ['partnerships@printpartners.example', 'Print Partners', '20% off your next print run'],
  ['ana@anavidal.example', 'Ana Vidal', 'Freelance illustrator, portfolio inside'], ['jules@julesmoreau.example', 'Jules Moreau', 'Re: motion work for the spring'],
  ['talent@hirewell.example', 'Hirewell', 'Senior designer candidates this week'], ['events@designsummit.example', 'Design Summit', 'Speaker invitation: Design Summit 2027'],
  ['mila@milastudio.example', 'Mila Ortiz', 'Collaboration idea'], ['hello@paperandco.example', 'Paper & Co', 'New paper samples are here']];

export function demo(now = Date.now()) {
  const rand = rng(20261016), pick = (l) => l[Math.floor(rand() * l.length)], chance = (p) => rand() < p;
  const ago = (d) => Math.round(now / 1000 - d * 86400);
  const age = (max) => { const a = -Math.log(1 - rand()) * max / 3; return a < max ? a : rand() * max; }; // most mail is recent, some is old
  let n = 0;
  const threads = [];
  // m: [[days ago, 1 if yours]]; the record comes from the timeline, as the server builds it
  function thread(o) {
    const msgs = Sync.timeline(o.m.map(([d, mine]) => ({ internalDate: String(ago(d) * 1000), labelIds: mine ? ['SENT'] : [] })));
    const mine = msgs.some((x) => x[1]), id = (0x19a3c00000000000n + BigInt(++n * 7919)).toString(16);
    const labels = [...(o.inbox ? ['INBOX'] : []), ...(mine ? ['SENT'] : []), ...(o.labels || [])];
    threads.push({ id, date: new Date(msgs[msgs.length - 1][0] * 1000).toISOString(), from: o.from, fromName: o.fromName || '', to: o.to || [], cc: o.cc || [],
      subject: o.subject, snippet: o.snippet || '', labels, count: msgs.length, historyId: String(4200000 + n), msgs, inbox: !!o.inbox });
  }
  // a conversation with a person: waiting on you, answered, or answered and then they wrote again
  function talk(d, kind) {
    const gap = Math.min(d, chance(0.3) ? 0.005 + rand() * 0.035 : 0.05 + age(4)); // how long you took
    if (kind === 'wait') return chance(0.25) ? [[d + 1 + gap, 0], [d + 1, 1], [d, 0]] : chance(0.15) ? [[d, 1], [Math.max(0, d - 0.2), 0]] : [[d, 0]];
    return chance(0.3) ? [[d + gap + 1.5, 0], [d + 1.5, 1], [d + gap, 0], [d, 1]] : [[d + gap, 0], [d, 1]];
  }
  const fill = (s, v) => s.replace('{c}', v.c || '').replace('{w}', v.w || '').replace('{p}', v.p || '').replace('{n}', v.n || '');

  CLIENTS.forEach(([c, dom, people, count, work]) => {
    for (let i = 0; i < count + Math.round(count * 0.6); i++) {
      const inbox = i < count, [local, name] = pick(people), d = inbox ? age(150) : rand() * 29, w = pick(work);
      thread({ inbox, from: `${local}@${dom}`, fromName: name, cc: chance(0.3) ? [pick(COLLEAGUES)[0]] : [], subject: fill(pick(CLIENT_SUBJECTS), { c, w }),
        snippet: pick(CLIENT_SNIPPETS), m: talk(d, inbox ? (chance(0.55) ? 'wait' : 'done') : (chance(0.12) ? 'wait' : 'done')),
        labels: [...(chance(0.08) ? ['STARRED'] : []), ...(chance(0.3) ? ['IMPORTANT'] : []), ...(chance(0.2) ? ['UNREAD'] : [])] });
    }
  });
  for (let i = 0; i < 40; i++) { // colleagues: most of it answered and archived
    const [from, fromName] = pick(COLLEAGUES), inbox = i < 16, d = inbox ? age(60) : rand() * 29;
    thread({ inbox, from, fromName, subject: pick(['Timesheets due Friday', 'Lunch on Thursday?', 'Re: studio offsite', 'Font licenses', 'Can you review my deck?', 'Printer is fixed']),
      snippet: pick(['No rush, whenever you get a minute.', 'Booked the room for 2pm.', 'Sending the files now.']), m: talk(d, chance(0.35) ? 'wait' : 'done') });
  }
  for (let i = 0; i < 14; i++) { // the group address: new business, nobody's job yet
    const who = pick(['olivia', 'marcus', 'sofia', 'liam', 'yara']), dom = pick(['bakehouse', 'greenroom', 'harborgym', 'loomtextiles']) + '.example';
    thread({ inbox: true, from: `${who}@${dom}`, fromName: who[0].toUpperCase() + who.slice(1), to: [ALIAS], subject: 'New project inquiry: ' + pick(['brand refresh', 'packaging', 'a shop opening', 'annual report']),
      snippet: 'Hi Fernwood team, a friend recommended you and', m: [[age(45), 0]] });
  }
  for (let i = 0; i < 6; i++) { // the accountant: context, kept in the inbox
    thread({ inbox: i < 4, from: 'nina@ledgerlane.example', fromName: 'Nina Brandt', subject: pick(['Q3 VAT return', 'Payroll for October', 'Receipts we still need', 'Year-end checklist']),
      snippet: 'Could you send the missing receipts by Friday?', m: talk(i < 4 ? age(60) : rand() * 29, chance(0.5) ? 'wait' : 'done') });
  }
  for (let i = 0; i < 18; i++) { // calendar
    const [from, fromName] = pick(COLLEAGUES), d = age(40);
    thread({ inbox: true, from, fromName, subject: (i % 3 ? pick(['Accepted: ', 'Declined: ', 'Tentatively accepted: ']) : 'Invitation: ') + pick(['Studio weekly', 'Crit session', 'Offsite planning']) + ' @ Thu 10am', snippet: '', m: [[d, 0]], labels: ['UNREAD'] });
  }
  TOOLS.forEach(([from, fromName, subjects], ti) => {
    for (let i = 0; i < 26 - ti * 3; i++) {
      const [c, , people, , work] = pick(CLIENTS), inbox = chance(0.8);
      thread({ inbox, from, fromName, subject: fill(pick(subjects), { c, w: pick(work), p: pick(COLLEAGUES)[1].split(' ')[0] }), snippet: 'You are receiving this because of your notification settings.',
        m: [[inbox ? age(120) : rand() * 29, 0]], labels: ['CATEGORY_UPDATES', ...(chance(0.6) ? ['UNREAD'] : []), ...(from.startsWith('billing') || from.startsWith('noreply@invoicely') ? ['Receipts'] : [])] });
    }
  });
  NEWS.forEach(([from, fromName], ni) => {
    for (let i = 0; i < 24 - ni * 3; i++) {
      const weekly = from === 'digest@typeletter.example', r = age(200), d = weekly ? 1 + i * 7 : r; // r drawn either way: the seed's sequence stays put
      const filtered = weekly && d < 20; // your Reading filter, made 20 days ago: older digests sit in the inbox
      thread({ inbox: !filtered, from, fromName, subject: fill(pick(NEWS_SUBJECTS), { n: String(80 + i) }), snippet: 'Read online. This week: ', m: [[d, 0]], labels: filtered ? ['Reading', 'UNREAD'] : ['CATEGORY_PROMOTIONS', 'UNREAD'] });
    }
  });
  COLD.forEach(([from, fromName, subject], ci) => {
    for (let i = 0; i < 2 + (ci % 3); i++) thread({ inbox: true, from, fromName, subject: (i ? 'Re: ' : '') + subject, snippet: 'Hope this finds you well.', m: talk(age(90), 'wait') });
  });
  // a few you labeled yourself before Labelboard
  threads.filter((t) => t.from.endsWith('@brightline.example')).slice(0, 6).forEach((t) => t.labels.push('Projects/Brightline'));

  const inboxIds = threads.filter((t) => t.inbox).map((t) => t.id);
  threads.forEach((t) => delete t.inbox);
  threads.sort((a, b) => b.date.localeCompare(a.date));
  // the window keeps only what the server's 30-day read would list: mail in the last 30 days, no promotions
  const since = now / 1000 - 30 * 86400, inWindow = (t) => t.msgs.some((m) => m[0] >= since) && t.labels.indexOf('CATEGORY_PROMOTIONS') < 0;
  const parts = Sync.splitWindow(threads.filter((t) => inboxIds.includes(t.id) || inWindow(t)), inboxIds);
  const count = (mine) => threads.reduce((s, t) => s + t.msgs.filter((m) => m[0] >= since && m[1] === mine).length, 0);
  const snapshot = { version: 1, account: ME, source: 'demo', query: 'in:inbox', generatedAt: new Date(now).toISOString(), historyId: String(4200000 + n),
    read: { fetched: 9, relabeled: 0, log: true, secs: 4 },
    window: { days: 30, since: new Date(since * 1000).toISOString(), threads: parts.window.length, sent: count(1), received: count(0) + 380 }, threads: parts.inbox };

  const seeds = CLIENTS.map(([name, value]) => ({ match: 'domain', value, bucket: 'clients', name, sublabel: name, source: 'demo contacts' }))
    .concat([{ match: 'domain', value: 'ledgerlane.example', bucket: 'keep', name: 'Ledger & Lane (accounting)', source: 'demo contacts' }]);
  const config = { ...JSON.parse(JSON.stringify(basic)), version: 1, me: [ME], firmDomains: [FIRM], aliases: [ALIAS], aliasBuckets: {}, labelMap: {}, cards: {}, ui: { view: 'board' } };
  // a board halfway through: confident suggestions taken, the rest left to drag
  const built = R.buildCards(snapshot, config, seeds);
  built.cards.forEach((c, i) => {
    const s = c.suggestion;
    if (s.confidence === 'high' || (s.confidence === 'medium' && i % 4)) config.cards[c.key] = s.sublabel ? { bucket: s.bucket, sublabel: s.sublabel } : { bucket: s.bucket };
  });
  const lead = built.cards.find((c) => c.key === 'domain:leadgenius.example');
  if (lead) config.cards[lead.key] = { bucket: 'tools' }; // one sales sender sent off with the machines

  const labels = { Label_1: 'Receipts', Label_2: 'Projects', Label_3: 'Projects/Brightline', Label_4: 'Reading' };
  const filters = [{ criteria: { from: 'billing@cloudhost.example' }, add: ['Receipts'], remove: [] }, { criteria: { from: 'digest@typeletter.example' }, add: ['Reading'], remove: ['INBOX'] }];
  return { 'snapshot.json': snapshot, 'recent.json': { threads: parts.window }, 'config.json': config, 'seed/demo.json': seeds, 'labels.json': labels, 'existing_filters.json': filters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(os.homedir(), '.labelboard-demo'), files = demo();
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), JSON.stringify(data, null, 1));
  }
  console.log(`demo: ${files['snapshot.json'].threads.length} inbox threads, ${files['recent.json'].threads.length} archived from the last 30 days → ${out}`);
}
