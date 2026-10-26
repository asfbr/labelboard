import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js');
const L = require('../src/labels.js');

const T = (o) => ({ id: o.id || 't' + Math.random(), date: '2026-10-01T00:00:00Z', from: o.from, to: o.to || ['me@firm.com'], cc: o.cc || [], subject: o.subject || '', labels: o.labels || ['INBOX'], snippet: '', count: 1 });
const config = { ...require('../presets/investor.json'), me: ['me@firm.com'], firmDomains: ['firm.com'], cards: {} };
const blue = { backgroundColor: '#4a86e8', textColor: '#ffffff' };
const info = (names, colors = {}) => names.map((name) => ({ name, color: colors[name] || null, type: 'user' }));

test('a sub-label takes its column\'s hue at its lightest, darkest as text; greys and older colours too', () => {
  assert.deepEqual(R.shadeOf(blue), { backgroundColor: '#c9daf8', textColor: '#1c4587' });
  assert.deepEqual(R.shadeOf({ backgroundColor: '#999999' }), { backgroundColor: '#efefef', textColor: '#434343' });
  assert.deepEqual(R.shadeOf({ backgroundColor: '#c2c2c2' }), { backgroundColor: '#efefef', textColor: '#434343' }); // not in the palette: its nearest
  assert.equal(R.labelColor('_Portfolio', config).backgroundColor, '#4a86e8');
  assert.equal(R.labelColor('_Portfolio/Fund I/Acme', config).backgroundColor, '#c9daf8');
  assert.equal(R.labelColor('Somewhere else', config), null);
});

test('the plan colours the folders in between, which Gmail makes too', () => {
  const t = T({ id: 'a', from: 'ceo@acme.com' }), snap = { threads: [t] };
  const cfg = { ...config, threadOverrides: { a: { bucket: 'portfolio', sublabel: 'Fund I/Acme' } } };
  const plan = R.buildPlan(snap, R.buildCards(snap, cfg, []), cfg, []);
  const by = Object.fromEntries(plan.labels.map((l) => [l.name, l.color && l.color.backgroundColor]));
  assert.equal(by['_Portfolio/Fund I'], '#c9daf8');
  assert.equal(by['_Portfolio/Fund I/Acme'], '#c9daf8');
  assert.equal(by._Portfolio, '#4a86e8');
});

test('a company with no mail in this read is still the board\'s; a label from an earlier layout is left over, with where its mail goes', () => {
  const seeds = [{ match: 'domain', value: 'acme.com', bucket: 'portfolio', name: 'Acme', sublabel: 'Fund I/Acme' }, { match: 'domain', value: 'quiet.io', bucket: 'portfolio', name: 'Quiet', sublabel: 'Fund I/Quiet' }];
  const snap = { threads: [T({ from: 'ceo@acme.com' })] }, b = R.buildCards(snap, config, seeds), plan = R.buildPlan(snap, b, config, seeds);
  const lay = L.layout(b, config, plan);
  assert.ok(lay['_Portfolio/Fund I/Quiet'], 'no mail, still in the layout');
  assert.ok(!plan.labels.some((l) => l.name === '_Portfolio/Fund I/Quiet'), 'planFilters still waits for mail before making it');
  const owned = ['_Portfolio', '_Portfolio/Fund I', '_Portfolio/Fund I/Quiet', '_Portfolio/Quiet', '_Portfolio/Gone'];
  const rows = L.classify(info(owned.concat('Personal stuff')), owned, lay, config), by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by['_Portfolio/Fund I/Quiet'].kind, 'board');
  assert.equal(by['_Portfolio/Quiet'].kind, 'leftover');
  assert.equal(by['_Portfolio/Quiet'].pick, '_Portfolio/Fund I/Quiet', 'its card moved: the mail follows');
  assert.equal(by['_Portfolio/Gone'].pick, 'tidy', 'nothing it names: deleted only if empty');
  assert.equal(by['Personal stuff'].kind, 'yours');
  const hk = L.housekeeping(rows, plan, config, []);
  assert.deepEqual(hk.moves.map((m) => m.from + '>' + m.to), ['_Portfolio/Gone>null', '_Portfolio/Quiet>_Portfolio/Fund I/Quiet']);
  assert.ok(hk.recolor.some((r) => r.name === '_Portfolio/Fund I/Quiet' && r.color.backgroundColor === '#c9daf8'), 'a label the plan leaves out still gets its colour');
  const kept = L.classify(info(owned), owned, lay, { ...config, leftovers: { '_Portfolio/Quiet': 'keep' } }).filter((r) => r.name === '_Portfolio/Quiet')[0];
  assert.equal(kept.want.backgroundColor, '#c9daf8');
});

test('names match as people read them: case and accents aside, one prefix word, never a guess between two', () => {
  assert.equal(L.match('_Portfolio/Fund I/Lumen', ['_Portfolio/Fund I/Lumen Saúde', '_Portfolio/Fund I/Fern-X']), '_Portfolio/Fund I/Lumen Saúde');
  assert.equal(L.match('_M&A/Deals/Orbit', ['_M&A/Orbit', '_M&A/NorthWind']), '_M&A/Orbit');
  assert.equal(L.match('x/NORTHWIND', ['a/NorthWind', 'b/NorthWind']), null);
  assert.equal(L.match('x/Con', ['a/Contour Labs']), null, 'too short to guess');
  assert.equal(L.match('x/Pin', ['a/Pinpoint']), null, 'a prefix only as a whole word');
});

test('folding a label of yours: the same path under the column, a label right under it with its name, case aside', () => {
  const names = ['_Portfolio', '_Portfolio/V1', '_Portfolio/V1/Orbit', '_Portfolio/Fund I/Lumen Saúde', '_M&A', '_M&A/Buyers', '_M&A/Deals', '_M&A/Deals/NorthWind'];
  assert.equal(L.foldTarget('Portfolio', 'Portfolio', '_Portfolio', names), '_Portfolio');
  assert.equal(L.foldTarget('Portfolio/V1/Orbit', 'Portfolio', '_Portfolio', names), '_Portfolio/V1/Orbit');
  assert.equal(L.foldTarget('Portfolio/Fund I/Lumen', 'Portfolio', '_Portfolio', names), '_Portfolio/Fund I/Lumen Saúde');
  assert.equal(L.foldTarget('Portfolio/V2/New', 'Portfolio', '_Portfolio', names), '_Portfolio/V2/New');
  assert.equal(L.foldTarget('Buyers', 'Buyers', '_M&A', names), '_M&A/Buyers');
  assert.equal(L.foldTarget('Deals/Northwind', 'Deals', '_M&A', names), '_M&A/Deals/NorthWind');
});

test('handing labels over: folded ones move children first, new targets are made with their folders, a filter Labelboard can\'t take holds one back', () => {
  const live = ['_Portfolio', 'Portfolio', 'Portfolio/V9', 'Portfolio/V9/Acme', 'Old', 'Household'];
  const cfg = { ...config, handover: { Portfolio: { into: '_Portfolio' }, Household: { keep: true }, Old: { into: '_Portfolio' } } };
  const rows = L.classify(info(live), ['_Portfolio'], { _Portfolio: true }, cfg);
  const filters = [{ id: 'f1', labels: ['Old'], owned: false }];
  const hk = L.housekeeping(rows, { labels: [{ name: '_Portfolio', color: blue }] }, cfg, filters);
  assert.deepEqual(hk.moves.map((m) => m.from + '>' + m.to), ['Portfolio/V9/Acme>_Portfolio/V9/Acme', 'Portfolio/V9>_Portfolio/V9', 'Portfolio>_Portfolio']);
  assert.deepEqual(hk.create.map((c) => c.name).sort(), ['_Portfolio/V9', '_Portfolio/V9/Acme']);
  assert.equal(hk.create[0].color.backgroundColor, '#c9daf8');
  assert.deepEqual(hk.adoptLabels, ['Household']);
  assert.deepEqual(hk.blocked, [{ name: 'Old', filters: ['f1'] }]);
  assert.deepEqual(hk.handover.sort(), ['Household', 'Portfolio', 'Portfolio/V9', 'Portfolio/V9/Acme']);
  const adopted = L.housekeeping(rows, { labels: [] }, { ...cfg, adopted: { f1: { label: '_Portfolio' } } }, filters);
  assert.ok(adopted.moves.some((m) => m.from === 'Old'), 'adopted with it: the fold goes ahead');
  assert.equal(L.classify(info(live), ['_Portfolio', 'Household'], { _Portfolio: true }, cfg).filter((r) => r.name === 'Household')[0].hand, undefined, 'once handed over it is the board\'s: nothing left to do');
});

test('a label of yours the board took as it is never comes off in a re-sort, though Labelboard owns it now', () => {
  const t = T({ id: 'a', from: 'x@nowhere.example', labels: ['INBOX', 'Household', '_Old'] }), snap = { threads: [t] }, b = R.buildCards(snap, config, []);
  const plan = R.buildPlan(snap, b, config, [], { ownedLabels: ['Household', '_Old'], adoptedLabels: ['Household'] });
  assert.deepEqual(plan.unlabel.map((e) => e.label), ['_Old'], 'its own label still comes off; the adopted one stays');
  assert.ok(!R.stats(snap, b, config, { ownedLabels: ['Household'], adoptedLabels: ['Household'] }).apply.byThread.a, 'and the board counts nothing to change');
});

test('a fold never lands on a left-over label, which moves away in the same Apply', () => {
  const live = ['_M&A', '_M&A/Deals', '_M&A/Deals/NorthWind', '_M&A/NorthWind', 'Deals', 'Deals/Northwind'];
  const owned = ['_M&A', '_M&A/Deals', '_M&A/Deals/NorthWind', '_M&A/NorthWind'], lay = { '_M&A': true, '_M&A/NorthWind': true };
  const rows = L.classify(info(live), owned, lay, { ...config, buckets: [{ id: 'mna', label: '_M&A', color: blue }], handover: { Deals: { into: '_M&A' } } });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by['_M&A/Deals/NorthWind'].kind, 'leftover');
  assert.equal(by['Deals/Northwind'].target, '_M&A/NorthWind', 'not the left-over _M&A/Deals/NorthWind');
  assert.equal(by.Deals.target, '_M&A', 'not the left-over _M&A/Deals folder');
});

test('columns that look alike are flagged, with a colour in a hue nobody uses', () => {
  const cfg = { ...config, buckets: [{ id: 'a', label: '_A', color: { backgroundColor: '#16a766' } }, { id: 'b', label: '_B', color: { backgroundColor: '#2a9c68' } }, { id: 'c', label: '_C', color: { backgroundColor: '#ffad47' } }, { id: 'd', label: '_D', color: { backgroundColor: '#fad165' } }] };
  const list = L.lookalikes(cfg, info(['Hobby'], { Hobby: { backgroundColor: '#16a765' } }).map((r) => ({ ...r, kind: 'yours' })));
  assert.deepEqual(list.map((x) => x.column + '~' + x.like), ['b~a'], 'orange and yellow stay apart; a label of yours flags no column');
  const hue = (c) => R.paletteIndex(c) % 8;
  assert.ok(![hue('#16a766'), hue('#2a9c68'), hue('#ffad47'), hue('#fad165')].includes(hue(list[0].suggest.backgroundColor)));
});
