# Labelboard

Gmail inbox sorter: a drag-and-drop board of rule cards that becomes Gmail labels + filters. Runs as
the user's own Apps Script web app. A product for any Gmail user (see `docs/ROADMAP.md`). Name, mark
and voice for UI strings: `docs/BRAND.md`. Formerly mailboard (renamed Oct 2026).

## Layout
- `src/rules.js` — the rule engine, the **only** place rules live. Pure ES5-style JS, no DOM, no Apps
  Script APIs: it runs in Node tests, the board and the server.
- `src/insights.js` — pure numbers and layouts for the views (the Gmail tab's flow, packing, priorities), Node-tested.
- `src/labels.js` — pure: Gmail's labels against the board (the board's, left over, yours), colours,
  hand-over, merges and leftover moves, lookalike colours. Node-tested; the Gmail tab is `board/gmail-view.js`.
- `src/board/` — the board UI (`index.html`, `style.css`, `app.js`, `settings.js` for Settings, first
  run, import/export, `views.js` for Inbox, Priorities and the pane, `triage.js` for one card at a
  time, `home.js` for Home). Talks to a backend only through
  `window.LabelboardAPI` (`adapter-gas.js` for Apps Script, `adapter-dev.js` for the local preview).
- `src/server/` — Apps Script (`Code.js`, `appsscript.json`): scan, storage, apply. `Sync.js` holds its
  pure parts (quota pacing, read diff, bulk apply, filter ownership/drift, the apply record and undo): Node-tested, and inlined into
  the board too so Review diffs filters with the server's own code.
- `presets/` — settings presets (`basic` is the first-run default, inlined by the build as `PRESETS`).
  Anything specific to one person or domain goes in a preset or the user's settings, never in the engine.
- `skills/labelboard/` — the public Claude skill (brief, AI read with Haiku readers + one Sonnet). Not in
  `.claude/skills/` on purpose: it would load into every session here. Its scripts are `dev/ai-read.mjs`,
  `dev/mcp-page.mjs`, `dev/ingest-mcp.mjs`, `dev/review.mjs`.
- `dev/build.mjs` inlines style, rules, adapter and app into one `board.html` (Apps Script serves a
  single HTML file). No bundler, no npm dependencies; keep it that way unless a session decides otherwise.

## Commands (PowerShell)
- `npm test` — rule engine, sync, views and demo tests (Node built-in runner).
- `node dev/demo.mjs <dir>` then `node dev/serve.mjs <dir> 8765` — the made-up mailbox (default dir
  `~/.labelboard-demo`, never in the repo). README screenshots (`docs/screenshots/`) come from it.
- `node dev/review.mjs list|merge` — Claude's review: list cards you haven't placed, land a review file
  (`labelboard: 'claude-review'`) in a data folder. The same file imports on the deployed board.
- `node dev/serve.mjs $HOME/.labelboard 8765` — board on a local snapshot, Gmail untouched. Use this
  for live UI checks; kill it before the turn ends.
- `npm run build` then `clasp push` — ship to Apps Script. Push only moves the `@HEAD` (/dev) URL; the
  /exec URL moves with `clasp deploy -i <its id from clasp deployments> -d "…"`. The deployed board is a
  cross-origin iframe: browser automation can't drive its file picker.

## Rules
- Changing rules: `npm test`, plus a before/after diff of cards, filters and backfill on a real
  snapshot when the change should keep behaviour (card keys and filter queries must not move).
- Mail data never enters the repo. Snapshots, configs and seeds live in `~/.labelboard/`. That includes
  **names**: no real company, deal, person, address or label name from the mailbox in any file (tests,
  comments, docs, commit messages), not even for a moment. Made-up names (Acme, Orbit, Northwind) from
  the first keystroke. `node dev/check-names.mjs` before every commit (`--range origin/main..HEAD`
  before a git push); it blocks names found in `~/.labelboard`.
- Metadata only: the server reads From/To/Cc/Subject/labels/snippet and each message's MIME type
  (attachment yes/no), never bodies. Don't widen
  scopes or reads without flagging it; it is a core promise in the README.
- Never touch filters the tool didn't create or wasn't handed by an explicit adopt (`readOwned_` in `Code.js`).
  Same for labels: only `ownedLabels`, or one named in the plan's `handover` (picked on the Gmail tab).
- Web app stays `executeAs: USER_ACCESSING` + `access: MYSELF`; mail fields reach `innerHTML` only through
  `h()`; outside scripts carry an integrity hash. Why: `docs/ARCHITECTURE.md` → Security.
- Code style: `var`, function expressions, dense one-liners, short comments, as in the existing files.
- Commit messages: plain, saying what was done. No model-name prefix ("Opus - …").

## Docs
- `docs/INSTALL.md` — install and first run for a stranger, every Google screen included. Keep it true
  when setup, scopes or deploy steps change.
- `docs/ARCHITECTURE.md` — why Apps Script, the sync model, Gmail behaviours relied on, emulation limits.
- `docs/ROADMAP.md` — direction, open decisions, the session plan.
- `docs/BRAND.md` — name, mark (`docs/brand/*.svg`), voice rules for every UI string, tagline.
- `docs/DESIGN.md` — design system: tokens, type, the tag card, columns, motion. Restyles follow it.
- `docs/CLAUDE-PROSE.md` — long-form rationale that doesn't fit a code comment (create when needed).
- `docs/decisions/` — the mocked decision pages, one HTML per decision session (`YYYY-MM-DD-topic.html`),
  pointed to from the ROADMAP's ✔ line. Demo names only; it's in the repo, so `check-names` covers it.
