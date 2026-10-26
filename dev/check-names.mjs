// Stops names from your mailbox reaching this public repo. Usage: node dev/check-names.mjs [--range origin/main..HEAD] [dataDir]
// (--range: commits not pushed yet, before a git push; without it, what is staged)
// Names: your Gmail labels (gmail-label-names.json, labels.json), contacts (seed/*.json), topics, aliases, your addresses.
// Checks the lines a commit adds (staged); a name GitHub's copy already has (Portfolio, Acme) counts as public.
// As a git hook, .git/hooks/pre-commit:  #!/bin/sh  then  exec node dev/check-names.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2), ri = args.indexOf('--range'), range = ri >= 0 ? args.splice(ri, 2)[1] : null;
const dir = args[0] || path.join(os.homedir(), '.labelboard');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const names = new Set(), add = (s) => { s = String(s || '').trim(); if (s.length >= 4) names.add(s); };
(read('gmail-label-names.json') || []).concat(Object.values(read('labels.json') || {}).map((v) => (typeof v === 'string' ? v : v.name)))
  .forEach((l) => String(l).split('/').forEach(add));
const seedDir = path.join(dir, 'seed');
if (fs.existsSync(seedDir)) fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')).forEach((f) => {
  const s = read(path.join('seed', f));
  (Array.isArray(s) ? s : (s && s.seeds) || []).forEach((x) => { add(x.name); add(x.value); add(String(x.sublabel || '').split('/').pop()); });
});
const c = read('config.json') || {};
(c.topics || []).forEach((t) => add(t.name)); [].concat(c.aliases || [], c.me || [], c.firmDomains || []).forEach(add);
if (!names.size) { console.error(`check-names: no mailbox data in ${dir}, nothing to check against.`); process.exit(0); }

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), word = (s) => new RegExp('(?<![\\p{L}\\p{N}])' + esc(s) + '(?![\\p{L}\\p{N}])', 'iu');
// public = what GitHub has (origin/main), not local commits that were never pushed
const ref = (() => { try { sh('git rev-parse --verify origin/main'); return 'origin/main'; } catch { return 'HEAD'; } })();
const tracked = sh('git ls-tree -r --name-only ' + ref).split('\n').filter(Boolean).map((f) => { try { return sh('git show ' + ref + ':' + JSON.stringify(f)); } catch { return ''; } }).join('\n');
const secret = [...names].filter((n) => !word(n).test(tracked)).map((n) => [n, word(n)]);
const added = sh(range ? 'git diff -U0 --no-color ' + JSON.stringify(range) : 'git diff --cached -U0 --no-color').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const hits = new Set();
added.forEach((l) => secret.forEach(([n, re]) => { if (re.test(l)) hits.add(n); }));
if (hits.size) {
  console.error(`Commit blocked: these come from your mailbox (${dir}) and aren't in the public repo yet:\n  ${[...hits].join(', ')}\n` +
    'Use made-up names instead. Only if one is truly public, commit with --no-verify.');
  process.exit(1);
}
console.log(`check-names: ${added.length} added lines clear of ${secret.length} names from your mailbox.`);
