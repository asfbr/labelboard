# Roadmap

Goal: a Gmail sorter any stranger can install, understand and trust. Open source, runs as their own
Apps Script. How things work lives in `ARCHITECTURE.md` and `DESIGN.md`; this page is what's next.

**Status:** ✅ Done · 🟢 Now · 🔵 Next · ⚪ Later · ✖ Dropped
**Decision:** ✔ decided (date) · ❓ open
**Flags:** Scope (widens Gmail permissions or reads) · Data out (mail data leaves the account)
**Size:** S an hour or two · M a session · L more than one

Keeping this page readable: every item is one row in *At a glance* with exactly one status. A choice
inside an item is marked ✔ or ❓ with a date, never left in prose. When an item ships, it moves to
*Done* as one line and its brief is deleted. Open questions also go in *Open decisions*.

## Open decisions

- ❓ **One-link install**: which Google account owns the shared template (a dedicated one, not a
  personal mailbox). Parked with going public, so no rush.
- ❓ **Unscheduled Now items**: *Guide fixes* and *Estimate, then resume* are Now but in no session.
  Fold them into one, or move them to Next.
- ❓ **Folder map**: its own tab, or part of *Flow and Filters as one tab* (session 5).
## Session order

✔ Decided 17 Oct 2026.

| # | Session | Status | What's in it |
|---|---|---|---|
| 1 | First sort | ✅ Done 17 Oct | fit the board, triage mode, card words, accept suggestions, one scope for numbers |
| 2 | Speed | ✅ Done 17 Oct | `buildPlan` and `buildCards` under 300 ms |
| 3 | Trust | ✅ Done 17 Oct | undo, apply record, remove everything (filter status on the board ✅ 17 Oct) |
| 4 | Daily use | 🟢 | re-read on open, Priorities that remembers; what changed ✅ 19 Oct (on Home) |
| 5 | Before and after | 🟢 | the before → after strip and Flow you drag in ✅ 19 Oct; Flow and Filters as one tab |

✔ The repo is open (19 Oct 2026, history in `CHANGELOG.md`). The landing page and one-link install have
no date and stay Later.

## At a glance

| Item | Area | Status | Size | Session | Decision / flags |
|---|---|---|---|---|---|
| Guide fixes | Install | 🟢 Now | S | — | |
| Estimate, then resume | First read | 🟢 Now | M | — | |
| Re-read on open when stale | Daily use | 🟢 Now | S | 4 | |
| Priorities that remembers | Daily use | 🟢 Now | S | 4 | |
| Big inboxes: the storage wall | First read | 🔵 Next | M | — | ✔ cap at newest 2,500, no Drive |
| Smaller paste path | Install | 🔵 Next | S | — | |
| See a finished board first | First read | 🔵 Next | S | — | needs the hosted demo |
| Merge and split on the board | First sort | 🔵 Next | M | — | ✔ no drop-on-card merge |
| Column menu | First sort | 🔵 Next | S | — | |
| Multi-select | First sort | 🔵 Next | S | — | |
| Why this thread is here | First sort | 🔵 Next | S | — | |
| Show Gmail the rules | Review and Apply | 🔵 Next | S | — | |
| Keyboard | Daily use | 🔵 Next | S | — | |
| Contacts editor and CSV import | Integrations | 🔵 Next | M | — | |
| Adopt all, hand back all | Integrations | 🔵 Next | S | — | |
| More presets | Integrations | 🔵 Next | S each | — | |
| Browser extension or Claude in Chrome | Integrations | ⚪ Later | L | — | ✔ only if the brief and the skill fall short (19 Oct) · Data out |
| Search without a full redraw | Speed | 🔵 Next | S | — | |
| Flow and Filters as one tab | Before and after | 🟢 Now | M | 5 | ✔ 19 Oct |
| Folder map | Before and after | 🔵 Next | M | 5 | ❓ own tab or part of Flow and Filters |
| One-link install | Install | ⚪ Later | M | — | ❓ template owner |
| Gmail add-on | Install | ⚪ Later | — | — | needs Marketplace verification |
| Board while it reads | First read | ⚪ Later | L | — | |
| Phone | First sort | ⚪ Later | M | — | ✔ laptop first |
| Landing page with the demo | Integrations | ⚪ Later | M | — | |
| Languages | Integrations | ⚪ Later | — | — | |
| gmailctl export | Integrations | ⚪ Later | — | — | only if asked |

## Done

- ✅ Oct 2026, before the roadmap: brand (`BRAND.md`), the rename, generic engine plus `basic` and
  `investor` presets, two-way sync (incremental re-read, your filters, adopt, drift, re-sort), the
  Tags design system, the shell and Settings, README and `INSTALL.md`, the four views, the 30-day
  window and reply numbers, the demo mailbox and screenshots, a security pass.
- ✅ 17 Oct, session 1 "First sort" (how they look: `DESIGN.md` → Columns, Numbers, Triage):
  - Fit the board: up to six columns share the width (floor 176 px, narrow cards below 230), *Add a
    column* is a rail, the filters lane starts folded unless a filter drifted. Checked at 1280, 1366,
    1440 on the demo; the real 12-column board keeps 272 px.
  - Triage mode (`src/board/triage.js`): centred sheet, biggest first, keys 1–9/0, Enter, S, ←, a pill
    to switch to every card not placed yet.
  - Accept suggestions per column: a link under the column's numbers (no column menu yet).
  - Card words: `rules.js suggest()` reasons are sentences; card keys and filter queries checked
    identical on the real snapshot. Error toasts say what stopped, what's safe, what to do (`e.plain`
    in the board, `plain_()` in `Code.js`); anything else goes to the console.
  - One scope for numbers: rule in `DESIGN.md`; heads, cards and Flow say "N in your inbox +M
    archived"; Overview's answered share is Priorities' (tested).
- ✅ 17 Oct: storage stopgap. Over `LabelboardSync.INBOX_CAP` (2,500) the read stops before it starts,
  in plain words; a snapshot that still doesn't fit fails the same way, not with a raw `setProperties` error.
- ✅ 17 Oct: search waits 120 ms for typing to pause.
- ✅ 17 Oct, session 2 "Speed": `buildCards` 149 → 24 ms, `buildPlan` 270 → 18 ms in the preview on the
  real snapshot. Contacts looked up by domain, then its parents; the backfill indexes every filter's
  terms once and looks up each thread's own addresses and subject words. Cards, keys, filters, plan
  and backfill checked byte-identical on the real snapshot and the demo; a matching test in `test/`.
- ✅ 17 Oct: filter status on the board. Column heads and the card drawer say whether the filter is
  live in Gmail, made, changed or removed on Apply, or left out; the Review button counts what isn't in
  Gmail yet ("Gmail is up to date" otherwise); Review leads with what Apply does; Labelboard's own
  filters show in the *Gmail filters* lane, one card per column. Checked on a demo copy set up as
  after an Apply.
- ✅ 17 Oct: filters you can see. A funnel line on every card and a pill on every column head; a
  *Filters* view (how each label got there: by a filter, by hand, at Apply, came before the filter,
  caught once you apply; then each filter day by day); the same counts in the filter and card drawers.
  Apply now records when it made each filter. Filter matching 3× faster (tokens memo, matchers built
  once per search); cards, filters and matches checked identical on the real snapshot.
- ✅ 17 Oct: Gmail now vs the board. A tag mark on cards, column heads, the rack and each drawer thread:
  *Sorted in Gmail* or *N to sort on Apply*, from the labels the read already has (no apply record).
  Review counts only threads that change, Apply sends only those and reads again after, the Review
  badge counts threads too, and a toolbar check keeps the cards Apply changes. Filter terms sorted so
  an Apply no longer marks its own filters as changed (one-time remake of 26 real queries).
- ✅ 17 Oct, session 3 "Trust" (✔ picked 17 Oct from mocked options: 1A, 2A, 3B; model in
  `ARCHITECTURE.md` → Undo): every Apply leaves a record; the header says "applied 2 hours ago: 11
  filters, 360 threads" and opens Review, which leads with that Apply and *Undo this Apply…* (once,
  the last Apply only). The ⋯ menu has *Remove everything Labelboard made…* (adopted filters handed
  back). Both confirm in numbers first; mail a new skip-inbox filter caught since comes back to the
  inbox with its label; a stopped undo says so in the header and Review and finishes from where it
  stopped. Checked against a fake Gmail (apply, undo one slice per call, remove everything, a swapped
  filter made again) and live on a demo copy set up as after an Apply.
- ✅ 19 Oct: who put each card there (✔ picked 19 Oct from mocked options). A pill on every card (You,
  Claude, Rule, Gmail) from `placement().who`; Claude's placements are stored `by: 'claude'` with a why,
  ringed in `--claude`, and become yours on *Keep it here* or any move. Claude's review is a file
  (`labelboard: 'claude-review'`) that Settings → Import lands in place, never over a card you placed;
  `dev/review.mjs` lists cards to review and merges a review into a local data folder. Toolbar *Show*
  filters by who. Checked live on a demo copy, light and dark.
- ✅ 19 Oct: the pane under the board (✔ P1, picked 19 Oct from mocks). Folded: Gmail now and after
  Apply as two bars by column, and the last move in numbers ("tasktrack.example → Clients: Clients +22,
  Tools −22, inbox after Apply +22") with Undo. Pulled up by its grip or *Show the flow*: a live Sankey,
  inbox by the label Gmail has now → cards → columns after Apply, bands Apply leaves alone faint; drag
  a card's bar onto a column to move it, click to open it. The rack goes slim while it's open; the
  board keeps 240 px. `insights.js shift()`, tested; checked live on a demo copy, light and dark.
- ✅ 19 Oct: folders inside a column. A process takes a `folder` (Settings → Processes; the investor
  preset's sale process uses `Deals`), so deals land in `_M&A/Deals/<company>`. A contact filed under a
  sub-label (`Advisors`) goes there when no topic is named, instead of Unsorted; its Gmail rule still
  waits until you place it.
- ✅ 19 Oct: Home (✔ picked 19 Oct from mocked options: all three looks, What now first). The first tab
  and where Labelboard opens: the next step big (sort, apply, answer), the rest of what waits, *Since …*
  and a door per view. Settings → Look picks What now, Gallery or Labels, and what opens. This was
  *What changed since you last looked*, done without a digest: the read you saw last is one date in
  `config.ui`. `insights.js since()`, tested; checked live on a demo copy, desktop and phone, light and dark.
- ✅ 19 Oct: AI for anyone (✔ picked 19 Oct: brief first, then the skill; an extension only if they fall
  short). *Settings → Ask an AI* downloads a brief for any AI (the cards you haven't placed, a few senders,
  subjects and a line each, never your addresses; `rules.js reviewBrief`/`briefText`, tested) and takes
  its answer pasted back. `skills/labelboard` is the public Claude skill: places cards from the brief
  through the Gmail connector, and reads every thread with Haiku readers and one Sonnet
  (`dev/ai-read.mjs`, `dev/mcp-page.mjs`).
- ✅ 21 Oct: what a card does to its mail (asked for after skip inbox could only be set per column). Each
  card sets skip inbox and mark as read either way (its column is the default), star, important always /
  never, delete (asks first); a condition the yeses wait for (came through a group address, not sent to
  you by name, an attachment, subject words, except senders or words); archiving later (N days after it
  arrives, or once read) by an hourly trigger, the one new permission (`script.scriptapp`). An idea line
  from the card's mail ("came through deals@ and you answered none"). Cards with nothing set keep
  byte-identical filters, keys and backfill on the real snapshot. `rules.js cardDoes`/`whenQuery`/
  `laterRules`/`actionHint`, `Sync.js filterAction`, `Code.js runLater`; tested.

Latest build v0.0.26 (`package.json`).

## Item briefs

Each brief is enough for a session to start from: the moment it fixes, what *done* looks like, where
it lives.

### Install and deploy

Today: Node, clasp, the Apps Script API switch, two consent screens and the "unverified app" warning,
or a six-file paste. The heaviest step for a product aimed at anyone with Gmail.

- **Guide fixes** · 🟢 Now · S. A screenshot of the "unverified app" screen with the two clicks
  marked, taken on the fresh-account install walk (the `/exec` bookmark note ✅ 19 Oct).
- **Smaller paste path** · 🔵 Next · S. A build target that folds `Sync.js`, `Presets.js` and
  `Baked.js` into `Code.js`, so the no-terminal path is two files plus the manifest.
  `dev/build.mjs --single`. The release zip of `dist/` ✅ 19 Oct: `.github/workflows/release.yml`
  on a `v*` tag, notes taken from `CHANGELOG.md`.
- **One-link install** · ⚪ Later · M · ❓ template owner. A standalone Apps Script project is a Drive
  file: shared read-only, anyone can open it and *File → Make a copy*; the copy runs in their own
  account with the manifest and the Gmail service along. Install becomes: open the link, make a copy,
  *Deploy → New deployment → Web app* (run as user accessing, only myself), open the address. Verify on
  a second Google account first (that the copy keeps `appsscript.json` and the advanced service, and
  what the consent screen says). Done when `INSTALL.md` leads with this path and clasp is the developer
  path. Needs a `dev/release.mjs` that pushes `dist/` to the template project.
- **Gmail add-on** · ⚪ Later. A sidebar inside Gmail would be the natural home, but it needs
  Marketplace publishing and Google's verification. Not before the web app has users.

### First open and the first read

Today: pick a preset, click *Read my mail*, wait with no estimate (the "7 minutes per 1,000 threads"
line lives only in `INSTALL.md`), and lose the run if the tab closes.

- **Estimate, then resume** · 🟢 Now · M. *Read my mail* first lists (seconds), then says "About 9
  minutes for 1,204 threads. Leave this tab open." The slice cursor lives only in the page today, so a
  closed tab starts over even though the `scan` blob survives 6 h. Keep the cursor in that blob and, on
  reopen, offer "Continue reading: 600 of 1,204 done". `Code.js scanInbox`, `adapter-gas.js refresh`,
  the first-run screen in `settings.js`.
- **Big inboxes: the storage wall** · 🔵 Next · M · ✔ cap, no Drive (17 Oct). Measured on the real
  snapshot: 160 bytes per thread compressed, so the 500 KB of user properties fits about 2,900 inbox
  threads on its own; settings, contacts, owned filters and the window share that space, so the real
  ceiling is lower. The stopgap is done (see Done); those users still can't use the board. Done when
  the first slice counts the inbox and, over the cap, reads the newest N threads and says so: "Your
  inbox has 8,400 threads. Labelboard reads the newest 2,500. Older mail keeps its place; the filters
  still catch new mail like it." The cap comes from a pure `LabelboardSync` function (bytes per thread
  with margin, tested), the read never throws on storage, and the header shows "newest 2,500 of 8,400".
  Slimming records (snippet 160 → 100 chars) buys about 15%: only if it falls out of this.
- **See a finished board first** · 🔵 Next · S. The first-run screen links to the demo, once hosted
  (Integrations), so the user knows what the wait buys. Also show the three permissions it asked for,
  in the same words as `INSTALL.md`, so the consent screen isn't the last time they are explained.
- **Board while it reads** · ⚪ Later · L. Render kept plus fetched-so-far threads during the read. The
  estimate and resume cover most of the pain; only do this if first reads stay long.

### The first sorting session

Still open after session 1: on a phone the header meta wraps to five lines before the first button.
Not yet seen on the deployed board: the new error toasts for a failed read or Apply.

- **Merge and split on the board** · 🔵 Next · M · ✔ no drop-on-card merge (too easy to trigger while
  moving a card). In the card drawer, *Same as…* opens a search list of cards; picking one creates or
  extends a topic with both terms. Also in the drawer: "split this sender out of this card". Today this
  only exists in Settings → Topics, which shows empty while seven cards say "In your contacts",
  because contacts aren't editable (Integrations).
- **Column menu** · 🔵 Next · S. The colour stamp opens Settings; a ⋯ on the column head should offer
  rename, colour, skip inbox, fold, accept suggestions, delete, in place.
- **Multi-select** · 🔵 Next · S. Shift-click cards, then drag or Shift + ← → moves them together.
- **Why this thread is here** · 🔵 Next · S. Each thread row in the drawer names the term that matched
  (hover or a small line), using `termMatches`.
- **Phone** · ⚪ Later · M · ✔ laptop first; triage already works at phone width. Under 640 px: header
  meta in one line with a tap for the rest, rack numbers in one row, and a card tap that leads with the
  column picker (the drawer already has it). Drag stays a desktop thing.

### Review and Apply

Today: the board shows where every filter stands in Gmail, every Apply is recorded and the last one
can be undone, and the ⋯ menu removes everything Labelboard made (Done, 17 Oct).

- **Show Gmail the rules** · 🔵 Next · S. Each filter's search now shows in its column's filter drawer
  (from the column head or the *Gmail filters* lane); left: a copy button. Check Gmail's filter count and query-length
  limits live and show "n of the limit" if there is one (`ARCHITECTURE.md` lists this as unchecked).

### Before and after

Today Board, Flow and Filters answer one question (where does this mail end up, and why) in three tabs,
and the views don't show what a move just did. The pane under the board does now (Done, 19 Oct).

- **Flow and Filters as one tab** · 🟢 Now · M · ✔ 19 Oct. Now that the pane shows Now → After live,
  the tab can be about how labels got there. One Sankey, Now → After, the left side split by who
  placed the card (You, Claude, Rule, Gmail), the filter day bars below.
- **Folder map** · 🔵 Next · M · ❓ own tab or folded into the one above. The Gmail label tree after
  Apply (`_M&A` → `Deals` → `Acme`), threads now and after per folder; click a folder for its cards.
  Asked for 19 Oct while setting up M&A as Advisors / Buyers / Deals.

### Daily use

Today the board is a one-time sorter with manual re-reads; Priorities is the page people would come
back to, and it has no memory between visits.

- **Re-read on open when stale** · 🟢 Now · S. Opening the board with a read older than an hour starts
  the incremental read (seconds) while the old snapshot shows, with a slim "Reading what changed…" line
  in the header. The user opened the page, so this isn't a background trigger (`CLAUDE-PROSE.md` keeps
  those out).
- **Priorities that remembers** · 🟢 Now · S. "Hide" on a waiting thread (a local list, cleared when
  the thread gets a new message) and a switch, off by default, to leave colleagues out ("Printer is
  fixed" is not a priority). Pace and view already persist in `config.ui`.
- **Keyboard** · 🔵 Next · S. `/` focuses search, `1`–`5` switch views, `?` lists the shortcuts, Esc
  already closes everything.

### Integrations and sharing

- **Contacts editor and CSV import** · 🔵 Next · M. Contacts show as a count with no list. A table in
  Settings (name, match, value, column, role) and an import of a Google Contacts CSV export, scope-free.
- **Adopt all, hand back all** · 🔵 Next · S. Two buttons on the filters lane for people with 60 filters.
- **More presets** · 🔵 Next · S each. `freelancer`, `job-search`, `household`, `small-shop` in
  `presets/`, each with a line in the README. A preset is a JSON file; the first-run screen already lists them.
- **Landing page with the demo** · ⚪ Later · M. A `dev/build.mjs --static <demo dir>` target inlines
  the demo state with a no-op adapter into one HTML file; the README and the first-run screen link to
  it. The demo data exists.
- **Browser extension or Claude in Chrome** · ⚪ Later · L. An extension needs the Chrome Web Store and
  access to mail.google.com, a bigger trust ask than the app itself. Claude in Chrome can't drive the
  deployed board (a cross-origin iframe) and would read Gmail screen by screen. Only if the AI brief
  and the Claude skill (Done, 19 Oct) fall short.
- **gmailctl export** · ⚪ Later. Writing the board as gmailctl's config would reach its users; low
  cost, low demand. Only if asked.
- **Languages** · ⚪ Later. Strings are inline. A strings table has to come first.

### Performance

Measured 17 Oct 2026 in the local preview on the real snapshot (1,200 inbox threads, 247 cards, 727
contacts, 1,200 AI votes, 12 columns) and the demo (421 threads, 32 cards):

| What | Real | Demo | When it runs |
|---|---|---|---|
| `buildCards` | 24 ms (was 1.3 s, 149 ms before session 2) | — | load, every Settings change, every import |
| `buildPlan` | 18 ms (was 3.7 s, 270 ms before session 2) | — | every Review open |
| `renderBoard` | 150 ms | 22 ms | every search keystroke, every move |
| `stats`, views (`flow`, `overview`, `priorities`, `grid`) | 3–18 ms | — | fine |
- **Search without a full redraw** · 🔵 Next · S. The redraw could cover only the card wells, not the
  heads and the lane.
- **First read** · ✔ no change. Bound by Gmail's per-minute quota: 1,200 threads ≈ 9 min.
  `messages.get` and GmailApp were measured and rejected (`CLAUDE-PROSE.md`). The estimate, the resume
  and the cap are the only levers left.

## Live checks still owed

On the real account, before touching that area.

- [ ] *Read mail again* on the live board (now reads the last 30 days too), then Flow and a second re-read.
- [ ] Move a labelled card, Review, Apply: re-sort removing a label was never seen live.
- [ ] The re-read without Gmail's change log (last read about a week old).
- [ ] The drift and hand-back screens for filters.
- [ ] Inside the deployed board: the first read's progress on the first-run screen, the settings
  download, a Priorities link opening the right thread in Gmail.
- [ ] The new error toasts for a failed read or Apply.
- [ ] Filter status after a real Apply: the button reads *Gmail is up to date*, columns say live.
- [ ] The *Filters* view on the real mailbox: "by hand" and "came before the filter" look plausible;
  after the next Apply, the dotted "made" line and *labelled at Apply* appear.
- [ ] `INSTALL.md` walked end to end on a fresh Google account.
- [ ] Undo and *Remove everything* on the real account (only the preview and a fake Gmail so far):
  the `after:` search for mail caught since, `labels.get`'s `threadsTotal` on an empty label, a label
  colour put back. Applies before this build have no record: their labels stay on that mail.
- [ ] Card actions after a real Apply: a starring / mark-read / delete filter reads back from Gmail as
  Labelboard's own (not "edited"), `runLater` archives on its first hourly run, undo puts unread and
  trashed mail back. Only Node tests and the preview so far.

## Known gaps kept as they are

- Moving a card re-sorts inbox threads only; archived mail keeps its labels (a Gmail search per card
  would be needed).
- Archived mail older than the window (30 days) isn't on the board.
- Your own Gmail filters don't change the before/after numbers (they act on new mail); they count in
  their lane.
- In the local preview, a column remap can't rewrite contacts files in the seed folder.
- The apply record has no cap: one entry per Apply (thread ids only, a few KB), in the same 500 KB as
  the snapshot. *Remove everything* empties it.
- *Remove everything* after Applies from before the record: mail their filters archived stays archived
  under its label (the label isn't empty, so it stays too).

## Decided against

- ✖ Favicon logos in Overview (16 Oct): would send every sender's domain to Google's favicon service.
- ✖ Cheaper first read with `messages.get`: wrong records for 10% of threads (`CLAUDE-PROSE.md`).
- ✖ Automatic background re-reads: re-read stays manual or on open (`CLAUDE-PROSE.md`).
- ✖ GmailApp instead of the Gmail API: needs the broadest mail scope (`CLAUDE-PROSE.md`).
- ✖ External email benchmarks in Priorities: what exists is mostly vendor surveys.
- ✖ In-app AI read (17 Oct): subject and snippet would leave the account. The AI stays outside the
  app and its answer comes in as a file you import (*AI brief*, *Claude skill*).
- ✖ People's photos (17 Oct): needs a Contacts permission; initials stay.
- ✖ Drive `appDataFolder` for big inboxes (17 Oct): lifts the storage cap but adds a permission;
  reading the newest 2,500 is enough.
- ✖ Drop-on-card merge (17 Oct): too easy to trigger while moving a card to a column.
- ✖ Undo back through every Apply, one at a time (17 Oct): a later Apply already fixes older board
  mistakes, and *Remove everything* is the way out.
- ✖ Undo taking labels off mail the new filters caught since (17 Oct): it can't be told from a label
  you added by hand. That mail comes back to the inbox with its label instead.
