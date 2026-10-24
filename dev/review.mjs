// Claude's review of the board, outside Apps Script. Usage:
//   node dev/review.mjs list [dataDir] [--all]      one JSON line per card you haven't placed (--all: every card)
//   node dev/review.mjs merge [dataDir] <review.json> lands a review (or an AI read) in dataDir/config.json, as the board's import does
// A review file: { "labelboard": "claude-review", "cards": { "<card key>": { "bucket", "sublabel"?, "why" } } }.
// The same file goes into the deployed board with Settings → Import. dataDir defaults to ~/.labelboard.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const R = createRequire(import.meta.url)('../src/rules.js');
const [cmd, ...rest] = process.argv.slice(2), all = rest.includes('--all'), args = rest.filter((a) => a !== '--all');
const dir = args[0] && fs.existsSync(path.join(args[0], 'config.json')) ? args.shift() : path.join(os.homedir(), '.labelboard');
const file = (f) => path.join(dir, f), json = (f) => JSON.parse(fs.readFileSync(file(f), 'utf8'));
const seedDir = file('seed'), seeds = fs.existsSync(seedDir) ? fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')).flatMap((f) => json(path.join('seed', f))) : [];

// the board's own card set: the snapshot plus the window's archived threads with a message not from you (app.js rebuild)
function board(config) {
  const snap = json('snapshot.json'), recent = fs.existsSync(file('recent.json')) ? json('recent.json') : { threads: [] };
  const mail = { threads: snap.threads.concat(recent.threads.filter((t) => !t.msgs || t.msgs.some((m) => !m[1]))) };
  return { mail, built: R.buildCards(mail, config, seeds) };
}

if (cmd === 'list') {
  const config = json('config.json'), { mail, built } = board(config), brief = R.reviewBrief(mail, built, config, all);
  console.log(JSON.stringify({ columns: brief.columns }));
  brief.cards.forEach((c) => console.log(JSON.stringify(c)));
} else if (cmd === 'merge' && args[0]) {
  // a review, or an AI read ({ threadVotes }, as dev/ai-read.mjs merge writes it), which lands as a review with no cards
  const config = json('config.json'), read = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const review = read.labelboard === 'claude-review' ? read : read.threadVotes ? { labelboard: 'claude-review', cards: {}, threadVotes: read.threadVotes } : null;
  if (!review) throw new Error(args[0] + ' is neither a review (labelboard: "claude-review") nor an AI read ({ threadVotes })');
  const m = R.mergeReview(config, review, board(config).built);
  fs.writeFileSync(file('config.json'), JSON.stringify(m.config, null, 1));
  console.log(`placed ${m.n.placed}, yours kept ${m.n.yours}, unknown column ${m.n.columns}, card not on the board ${m.n.cards}` +
    (review.threadVotes ? `, AI read of ${Object.keys(review.threadVotes).length} threads` : ''));
} else {
  console.log('node dev/review.mjs list [dataDir] [--all]  |  node dev/review.mjs merge [dataDir] <review.json>');
}
