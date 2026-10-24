import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { demo } from '../dev/demo.mjs';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js');
const I = require('../src/insights.js');

const NOW = Date.parse('2026-10-16T12:00:00Z');
const d = demo(NOW), snap = d['snapshot.json'], recent = d['recent.json'], config = d['config.json'], seeds = d['seed/demo.json'];
const all = snap.threads.concat(recent.threads);

test('demo records are shaped like the server\'s: timeline first, the rest derived from it', () => {
  assert.ok(snap.threads.every((t) => t.labels.includes('INBOX')) && recent.threads.every((t) => !t.labels.includes('INBOX')));
  all.forEach((t) => {
    assert.equal(t.count, t.msgs.length);
    assert.equal(t.labels.includes('SENT'), t.msgs.some((m) => m[1]), t.subject);
    assert.equal(t.date, new Date(t.msgs[t.msgs.length - 1][0] * 1000).toISOString());
  });
  assert.ok(recent.threads.every((t) => !('snippet' in t)));
});

test('nothing real: every address in the demo is on the reserved .example TLD', () => {
  const addrs = all.flatMap((t) => [t.from, ...t.to, ...t.cc]).concat(config.me, config.aliases, seeds.map((s) => s.value), snap.account);
  assert.ok(addrs.length > 500);
  addrs.forEach((a) => assert.match(a, /\.example$/, a));
});

test('the same demo every run, and every view has something to show', () => {
  assert.deepEqual(demo(NOW)['config.json'].cards, config.cards, 'card keys and placements are stable');
  assert.deepEqual(demo(NOW + 864e5)['snapshot.json'].threads.map((t) => t.id), snap.threads.map((t) => t.id), 'ids don\'t depend on the day');
  const built = R.buildCards(snap, config, seeds), st = R.stats(snap, built, config);
  assert.equal(R.orphans(config, built, seeds).length, 0);
  ['clients', 'calendar', 'tools', 'newsletters', 'keep', 'unsorted'].forEach((b) => assert.ok(st.after.byBucket[b] > 0, b));
  assert.ok(built.cards.some((c) => !config.cards[c.key]), 'some cards are still to drag');
  const p = I.priorities(snap, built, config, NOW);
  assert.ok(p.waiting.length > 20 && Object.values(p.ages).every((n) => n > 0));
  const r = I.replies(snap, R.buildCards({ threads: snap.threads.concat(recent.threads) }, config, seeds), recent, config, NOW, 30);
  assert.ok(r.people > 50 && r.answered > 0 && r.archived.length > 0 && r.partial === 0);
  assert.ok(r.speed.every((s) => s.n > 0));
});
