// Turns Gmail MCP `search_threads` pages (THREAD_VIEW_MINIMAL) into a Labelboard snapshot.
// Usage: node dev/ingest-mcp.mjs <pagesDir> <labels.json {id: name}> <out.json> <me@address> [--window <snapshot.json>]
// --window: pages of a `newer_than:30d` search become recent.json (threads not in that snapshot), and the
// snapshot gets its `window` note, as the server's 30-day read leaves them (sent/received counts unknown: 0).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const Sync = createRequire(import.meta.url)('../src/server/Sync.js');

const [pagesDir, labelsFile, outFile, me, flag, inboxFile] = process.argv.slice(2);
if (!me) {
  console.error('usage: node dev/ingest-mcp.mjs <pagesDir> <labels.json> <out.json> <me@address>');
  process.exit(2);
}
const labelNames = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
const lower = (s) => String(s || '').trim().toLowerCase();
const self = lower(me);

const threads = new Map();
for (const f of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'))) {
  for (const t of JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8')).threads || []) threads.set(t.id, t);
}

const out = [...threads.values()].map((t) => {
  const msgs = [...(t.messages || [])].sort((a, b) => a.date.localeCompare(b.date));
  const first = msgs.find((m) => lower(m.sender) !== self) || msgs[0];
  const last = msgs[msgs.length - 1];
  const collect = (field) => [...new Set(msgs.flatMap((m) => (m[field] || []).map(lower)))].filter((a) => a !== self);
  const labels = [...new Set(msgs.flatMap((m) => m.labelIds || []))].map((id) => labelNames[id] || id);
  return {
    id: t.id,
    date: last.date,
    from: lower(first.sender),
    to: collect('toRecipients'),
    cc: collect('ccRecipients'),
    subject: first.subject || '',
    snippet: String(last.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[͏‌\s]+/g, ' ').trim().slice(0, 160),
    labels,
    count: msgs.length,
    msgs: Sync.timeline(msgs.map((m) => ({ internalDate: m.internalDate || Date.parse(m.date), labelIds: m.labelIds }))),
  };
}).sort((a, b) => b.date.localeCompare(a.date));

if (flag === '--window') {
  const inbox = JSON.parse(fs.readFileSync(inboxFile, 'utf8')), ids = new Set(inbox.threads.map((t) => t.id));
  const recent = Sync.splitWindow(out.filter((t) => !ids.has(t.id)), []).window;
  fs.writeFileSync(outFile, JSON.stringify({ threads: recent }));
  inbox.window = { days: Sync.WINDOW_DAYS, since: new Date(Date.now() - Sync.WINDOW_DAYS * 864e5).toISOString(), threads: recent.length, sent: 0, received: 0 };
  fs.writeFileSync(inboxFile, JSON.stringify(inbox));
  console.log(`window: ${recent.length} archived threads → ${outFile}; ${inboxFile} marked as read with the window`);
  process.exit(0);
}

const snapshot = {
  version: 1,
  account: self,
  source: 'mcp',
  query: 'in:inbox',
  generatedAt: new Date().toISOString(),
  threads: out,
};
fs.writeFileSync(outFile, JSON.stringify(snapshot));
console.log(`snapshot: ${out.length} threads → ${outFile}`);
