// The AI read, outside Apps Script (skills/labelboard/SKILL.md, step 2). Usage:
//   node dev/ai-read.mjs prep [dataDir] [--parts N]   one JSON line per thread in dataDir/ai-read/part-N.jsonl, plus reference.md
//   node dev/ai-read.mjs merge [dataDir]              part-N.json (+ fixes.json) → dataDir/ai-read.json, { threadVotes }, to import
// dataDir defaults to ~/.labelboard: snapshot.json (+ recent.json), config.json, seed/*.json. Your own addresses never go in a part.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [cmd, ...rest] = process.argv.slice(2), flag = rest.indexOf('--parts'), parts = flag >= 0 ? +rest[flag + 1] : 0;
const args = flag < 0 ? rest : rest.filter((a, i) => i !== flag && i !== flag + 1);
const dir = args[0] || path.join(os.homedir(), '.labelboard'), out = path.join(dir, 'ai-read');
const file = (f) => path.join(dir, f), json = (f) => JSON.parse(fs.readFileSync(file(f), 'utf8')), has = (f) => fs.existsSync(file(f));
const config = json('config.json'), lower = (s) => String(s || '').toLowerCase();
const seeds = has('seed') ? fs.readdirSync(file('seed')).filter((f) => f.endsWith('.json')).flatMap((f) => json(path.join('seed', f))) : [];
const columns = config.buckets.filter((b) => b.id !== 'unsorted');

if (cmd === 'prep') {
  const me = new Set((config.me || []).map(lower)), mine = new Set((config.firmDomains || []).map(lower)), groups = new Set((config.aliases || []).map(lower));
  const dom = (a) => lower(a).split('@')[1] || '';
  const recent = has('recent.json') ? json('recent.json').threads : [];
  const threads = json('snapshot.json').threads.concat(recent.filter((t) => !t.msgs || t.msgs.some((m) => !m[1]))); // as the board: archived mail someone else wrote
  const lines = threads.map((t) => {
    const ppl = [...(t.to || []), ...(t.cc || [])].map(lower), alias = [...new Set(ppl.filter((a) => groups.has(a)))];
    const also = [...new Set(ppl.filter((a) => !me.has(a)).map(dom).filter((d) => d && !mine.has(d)))].slice(0, 6);
    const labels = (t.labels || []).filter((l) => !/^(INBOX|IMPORTANT|UNREAD|STARRED|SENT|DRAFT|CHAT|CATEGORY_)/.test(l));
    return JSON.stringify({ id: t.id, from: me.has(lower(t.from)) ? 'you' : t.from, also: also.length ? also : undefined, alias: alias.length ? alias : undefined,
      subject: String(t.subject || '').slice(0, 120), snippet: String(t.snippet || '').slice(0, 140), labels: labels.length ? labels : undefined, n: t.count > 1 ? t.count : undefined });
  });
  const n = parts || Math.max(1, Math.ceil(lines.length / 300)), size = Math.ceil(lines.length / n);
  fs.mkdirSync(out, { recursive: true });
  fs.readdirSync(out).filter((f) => /^part-\d+\.jsonl?$/.test(f)).forEach((f) => fs.unlinkSync(path.join(out, f))); // a new read starts clean
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(out, `part-${i + 1}.jsonl`), lines.slice(i * size, (i + 1) * size).join('\n'));
  // what the readers need to know: the columns, the topics and processes, and who is who
  const flags = (b) => [b.topics && 'its topics are companies or projects', b.newTopics && 'a new topic may be named', b.automated && 'machine mail', b.subLabels && 'takes a sub-label'].filter(Boolean);
  const who = {};
  seeds.forEach((s) => { const k = s.bucket + (s.sublabel && !s.sublabel.includes('/') ? '/' + s.sublabel : ''); (who[k] = who[k] || new Set()).add(s.name + (s.match === 'domain' ? ' (' + s.value + ')' : '')); });
  const sec = (title, items) => (items.length ? ['', '## ' + title, ...items] : []);
  const md = ['# Reference', ...sec('Columns (bucket ids)', columns.map((b) => `- \`${b.id}\`: ${b.name}${b.description ? ', ' + b.description : ''}${flags(b).length ? ' [' + flags(b).join('; ') + ']' : ''}`)),
    ...sec('Topics already known (name → column)', (config.topics || []).map((t) => `- ${t.name} → ${t.bucket}${t.subjects && t.subjects.length ? '; named in subjects as ' + t.subjects.join(', ') : ''}`)),
    ...sec('Processes (a sale, a hire…: a topic plus these words)', (config.processes || []).map((p) => `- ${p.title || p.name} → ${p.bucket}; words: ${(p.words || []).join(', ')}`)),
    ...sec('Group addresses', (config.aliases || []).map((a) => `- ${a}${config.aliasBuckets && config.aliasBuckets[a] ? ' → ' + config.aliasBuckets[a] : ''}`)),
    ...sec('Contacts (column/sub-label: names)', Object.keys(who).sort().map((k) => `- ${k}: ${[...who[k]].slice(0, 40).join('; ')}`))].join('\n');
  fs.writeFileSync(path.join(out, 'reference.md'), md + '\n');
  console.log(`${lines.length} threads in ${n} parts (${out}), reference ${md.length} chars`);
} else if (cmd === 'merge') {
  const ids = new Set(columns.map((b) => b.id)), known = new Set([...(config.topics || []).map((t) => t.name), ...seeds.map((s) => s.name)]);
  const read = (f) => (fs.existsSync(path.join(out, f)) ? JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) : []);
  const all = fs.readdirSync(out).filter((f) => /^part-\d+\.json$/.test(f)).flatMap(read).concat(read('fixes.json')); // fixes last: they win
  const votes = {}, n = { dropped: 0 }, fresh = {};
  all.forEach((x) => {
    if (!x || !x.id || !ids.has(x.bucket)) return n.dropped++;
    const t = x.topic ? String(x.topic) : null;
    if (t && !known.has(t)) fresh[t] = (fresh[t] || 0) + 1;
    votes[x.id] = { b: x.bucket, t, c: ['high', 'medium', 'low'].includes(x.confidence) ? x.confidence : 'low', w: String(x.why || '').slice(0, 60) };
  });
  fs.writeFileSync(file('ai-read.json'), JSON.stringify({ threadVotes: votes }));
  console.log(`${Object.keys(votes).length} threads read, ${n.dropped} dropped (no id or a column the board doesn't have) → ${file('ai-read.json')}`);
  const names = Object.keys(fresh).sort((a, z) => fresh[z] - fresh[a]);
  if (names.length) console.log('Topics not in your settings (add them under Settings → Topics to claim future mail): ' + names.map((t) => `${t} (${fresh[t]})`).join(', '));
} else {
  console.log('node dev/ai-read.mjs prep [dataDir] [--parts N]  |  node dev/ai-read.mjs merge [dataDir]');
}
