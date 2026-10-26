// Local preview of the board on a snapshot. Usage: node dev/serve.mjs [dataDir] [port]
// dataDir holds snapshot.json, config.json and optional seed/*.json (default ~/.labelboard, or the
// pre-rename ~/.mailboard while that is the only one there).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { boardHtml } from './build.mjs';

const Sync = createRequire(import.meta.url)('../src/server/Sync.js');
const home = (d) => path.join(os.homedir(), d);
const dataDir = process.argv[2] || (!fs.existsSync(home('.labelboard')) && fs.existsSync(home('.mailboard')) ? home('.mailboard') : home('.labelboard'));
if (dataDir === home('.mailboard')) console.log('Using ~/.mailboard: rename it to ~/.labelboard');
const port = Number(process.argv[3] || 8765);
const json = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

// Your Gmail filters as the server would report them, from existing_filters.json ({criteria, add[], remove[]},
// label names): shown as yours unless an entry says `owned: true` (to preview the board after an Apply), `at` when it was made.
// The labels of owned filters stand in for the labels Labelboard created (ownedLabels), the ones re-sorting may take off.
// labels.json: { id: name } or { id: {name, color, owned, adopted, threads, messages} } (Gmail's colours and counts).
const labelName = (v) => (typeof v === 'string' ? v : v.name);
function labelFile() { return has('labels.json') ? Object.values(json('labels.json')).map((v) => (typeof v === 'string' ? { name: v } : v)) : null; }
function gmail() {
  if (!fs.existsSync(path.join(dataDir, 'existing_filters.json'))) return {};
  const filters = json('existing_filters.json').map((f, i) => ({ ...Sync.normFilter({ id: f.id || 'local' + i, criteria: f.criteria, action: { addLabelIds: f.add, removeLabelIds: f.remove } }, {}), owned: !!f.owned, at: f.at || null, adopted: !!f.adopted }));
  const file = labelFile(), labels = file ? file.map((l) => l.name) : undefined;
  const ownedLabels = [...new Set(filters.filter((f) => f.owned).flatMap((f) => f.labels).concat((file || []).filter((l) => l.owned).map((l) => l.name)))];
  const labelInfo = file ? file.map((l) => ({ name: l.name, color: l.color || null, type: 'user' })) : undefined;
  return { filters, gone: [], labels, ownedLabels, adoptedLabels: (file || []).filter((l) => l.adopted).map((l) => l.name), labelInfo };
}
// Counts per label for the Labels view: labels.json's own, else what the snapshot and the window hold.
function labelCounts() {
  const file = labelFile() || [], mail = json('snapshot.json').threads.concat(has('recent.json') ? json('recent.json').threads : []), out = {};
  file.forEach((l) => {
    const ts = mail.filter((t) => t.labels.includes(l.name));
    out[l.name] = { threads: l.threads != null ? l.threads : ts.length, messages: l.messages != null ? l.messages : ts.reduce((n, t) => n + (t.count || 1), 0) };
  });
  return out;
}

// Undo in the preview: Sync.planUndo, the server's own plan, applied to the files in this data folder (record.json
// holds the Applies, `id` on existing_filters.json entries ties them to it). Gmail is never touched.
const has = (f) => fs.existsSync(path.join(dataDir, f));
const put = (f, data) => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(data, null, 1));
function undo({ kind, keep = [] }) {
  const rec = json('record.json'), all = kind === 'all', n = all ? rec.applies.length : 1;
  if (!all && (!rec.applies.length || rec.undone)) throw new Error('Labelboard: There is no Apply to undo. Nothing changed.');
  const plan = Sync.planUndo(rec.applies.slice(rec.applies.length - n).reverse(), all), snap = json('snapshot.json'), recent = has('recent.json') ? json('recent.json') : { threads: [] };
  const mail = snap.threads.concat(recent.threads), ops = new Map(Sync.undoOps(plan, Sync.sinceMail(mail, plan)).map((o) => [o.thread, o]));
  const threads = mail.map((t) => { const o = ops.get(t.id), s = new Set(t.labels); if (!o) return t; o.remove.forEach((l) => s.delete(l)); o.add.forEach((l) => s.add(l)); return { ...t, labels: [...s] }; });
  snap.threads = threads.filter((t) => t.labels.includes('INBOX')).sort((a, b) => b.date.localeCompare(a.date)); recent.threads = threads.filter((t) => !t.labels.includes('INBOX'));
  const log = { deleted: 0, back: 0, restored: 0, labels: 0 }, before = has('existing_filters.json') ? json('existing_filters.json').map((f, i) => ({ ...f, id: f.id || 'local' + i })) : [];
  const owned = before.filter((f) => f.owned).flatMap((f) => f.add), filters = before.filter((f) => {
    if (!f.owned) return true;
    if (plan.filters.handBack.includes(f.id) || keep.includes(f.id) || (all && f.adopted)) { log.back++; f.owned = false; delete f.adopted; return true; }
    const go = all || plan.filters.remove.includes(f.id); if (go) log.deleted++; return !go;
  });
  plan.filters.restore.forEach((s, i) => { log.restored++; filters.push({ id: 'restored' + Date.now() + i, criteria: { query: s.query }, add: [s.label], remove: s.archive ? ['INBOX'] : [], owned: true, adopted: s.adopted, at: Date.now() }); });
  if (has('labels.json')) {
    const labels = json('labels.json'), used = new Set(threads.flatMap((t) => t.labels));
    Sync.childrenFirst(all ? [...new Set(owned)] : plan.labels).forEach((l) => {
      const id = Object.keys(labels).find((k) => labelName(labels[k]) === l);
      if (id && !used.has(l) && !Object.values(labels).some((x) => labelName(x).startsWith(l + '/'))) { delete labels[id]; log.labels++; }
    });
    put('labels.json', labels);
  }
  const c = Sync.undoCounts(plan), summary = (all ? 'Removed what Labelboard made (preview): ' : 'Apply undone (preview): ') + [log.deleted && log.deleted + ' filters deleted', log.restored && log.restored + ' made again',
    log.back && log.back + ' handed back to you', c.unlabel && c.unlabel + ' threads unlabelled', ops.size - c.threads + c.inbox && (ops.size - c.threads + c.inbox) + ' back in your inbox', log.labels && log.labels + ' labels deleted'].filter(Boolean).join(', ');
  put('snapshot.json', snap); if (has('recent.json')) put('recent.json', recent); put('existing_filters.json', filters);
  rec.applies = rec.applies.slice(0, rec.applies.length - n); rec.undone = { at: Date.now(), kind: all ? 'all' : 'last', summary }; delete rec.undo; put('record.json', rec);
  return { done: true, summary };
}

function seeds() {
  const dir = path.join(dataDir, 'seed');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => json(path.join('seed', f)));
}

// Only this machine's own pages: a foreign Host (DNS rebinding) or a non-JSON POST (a form on another site) is refused.
const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
http.createServer((req, res) => {
  try {
    if (!hosts.has(req.headers.host)) { res.writeHead(403); return res.end(); }
    if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] || '')) { res.writeHead(415); return res.end(); }
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(boardHtml('dev')); // rebuilt per request: edit and reload
    }
    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const recent = fs.existsSync(path.join(dataDir, 'recent.json')) ? json('recent.json') : null; // the 30-day window's archived threads
      return res.end(JSON.stringify({ mode: 'preview', snapshot: json('snapshot.json'), config: json('config.json'), seeds: seeds(), gmail: gmail(), recent, record: has('record.json') ? json('record.json') : null }));
    }
    if (req.url === '/api/counts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(labelCounts()));
    }
    if (req.url === '/api/undo' && req.method === 'POST' && has('record.json')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { const out = undo(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e && e.message || e)); }
      });
      return;
    }
    if (req.url === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { JSON.parse(body); } catch { res.writeHead(400); res.end('not JSON'); return; } // refuse to write anything that isn't JSON
        fs.writeFileSync(path.join(dataDir, 'config.json'), body);
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e && e.message || e));
  }
}).listen(port, '127.0.0.1', () => console.log(`Labelboard preview on http://localhost:${port} (data: ${dataDir})`));
