// Claude Code saves a Gmail connector page too big to show (search_threads, a full 50-thread page) as a file under
// its tool-results folder. This copies the newest one into <dataDir>/raw/<folder>/ and prints the next page token.
// Usage: node dev/mcp-page.mjs <folder> <tool-results dir> [dataDir]   (dataDir defaults to ~/.labelboard)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [folder, root, dataDir = path.join(os.homedir(), '.labelboard')] = process.argv.slice(2);
if (!folder || !root) { console.error('usage: node dev/mcp-page.mjs <folder> <tool-results dir> [dataDir]'); process.exit(2); }
const pages = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => /search_threads.*\.(txt|json)$/.test(path.basename(f)))
  .map((f) => path.join(root, f)).sort((a, z) => fs.statSync(z).mtimeMs - fs.statSync(a).mtimeMs);
if (!pages.length) { console.error('no search_threads page under ' + root); process.exit(1); }
const src = pages[0], d = JSON.parse(fs.readFileSync(src, 'utf8')), raw = path.join(dataDir, 'raw', folder);
fs.mkdirSync(raw, { recursive: true });
const dest = path.join(raw, path.basename(src).replace(/\.txt$/, '.json'));
fs.copyFileSync(src, dest);
const last = (d.threads || []).slice(-1).flatMap((t) => (t.messages || []).map((m) => m.date)).sort().pop();
console.log(`saved ${path.basename(dest)}, ${(d.threads || []).length} threads, last thread ${last}, NEXT ${d.nextPageToken || 'None'} | pages in folder: ${fs.readdirSync(raw).length}`);
