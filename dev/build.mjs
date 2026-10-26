// Inlines style, rules and app into one HTML page. Target "gas" also writes the Apps Script bundle in dist/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const presets = () => Object.fromEntries(fs.readdirSync(path.join(root, 'presets')).map((f) => [path.basename(f, '.json'), JSON.parse(read('presets/' + f))]));

export function boardHtml(target) {
  // Replacement functions: a string replacement would expand "$&" etc. inside the inlined code.
  const html = read('src/board/index.html')
    .replace('/*@STYLE@*/', () => read('src/board/style.css'))
    .replace('/*@RULES@*/', () => read('src/rules.js'))
    .replace('/*@INSIGHTS@*/', () => read('src/insights.js'))
    .replace('/*@LABELS@*/', () => read('src/labels.js'))
    .replace('/*@LABELSVIEW@*/', () => read('src/board/labels-view.js'))
    .replace('/*@VIEWS@*/', () => read('src/board/views.js'))
    .replace('/*@TRIAGE@*/', () => read('src/board/triage.js'))
    .replace('/*@HOME@*/', () => read('src/board/home.js'))
    .replace('/*@SYNC@*/', () => read('src/server/Sync.js')) // the board diffs filters with the server's own code
    .replace('/*@ADAPTER@*/', () => read(`src/board/adapter-${target}.js`))
    .replace('/*@PRESETS@*/', () => 'var LabelboardPresets = ' + JSON.stringify(presets()) + ';') // first run and Settings offer them
    .replace('/*@SETTINGS@*/', () => read('src/board/settings.js'))
    .replace('/*@APP@*/', () => read('src/board/app.js'));
  // Apps Script runs a // comment past a closing script tag on its line and swallows the markup after it
  const bad = /^(?![^\n]*<script src)[^\n]*\/\/[^\n]*<\/script>/m.exec(html);
  if (bad) throw new Error('board.html: a // comment shares a line with </script>: ' + bad[0].trim().slice(0, 120));
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'board.html'), boardHtml('gas'));
  for (const f of fs.readdirSync(path.join(root, 'src/server'))) fs.copyFileSync(path.join(root, 'src/server', f), path.join(dist, f));
  fs.writeFileSync(path.join(dist, 'Presets.js'), `var PRESETS = ${JSON.stringify(presets())};\n`);
  // --bake <config.json>: ship settings with the code; the script takes them once (see Code.js takeBaked_)
  const i = process.argv.indexOf('--bake'), bake = i > 0 ? fs.readFileSync(process.argv[i + 1], 'utf8') : null;
  const stamp = bake ? createHash('sha1').update(bake).digest('hex').slice(0, 12) : '';
  fs.writeFileSync(path.join(dist, 'Baked.js'), bake ? `var BAKED_CONFIG = ${JSON.stringify(JSON.parse(bake))};\nvar BAKED_STAMP = '${stamp}';\n` : 'var BAKED_CONFIG = null;\nvar BAKED_STAMP = \'\';\n');
  console.log('dist/ ready for clasp push' + (bake ? ' (settings baked in, ' + stamp + ')' : ''));
}
