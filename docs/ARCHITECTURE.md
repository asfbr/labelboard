# Architecture notes

## Sync model (as built, Oct 2026, session 2)
Nothing syncs on its own unless you ask: one hourly trigger exists only while a column or card archives
later or Settings → *Runs on its own* is on (below: On its own; why it was off before: `CLAUDE-PROSE.md`).
- **Board = a snapshot** of the inbox plus the 30-day window (below), read on demand (metadata only).
  *Read mail again* is incremental: it lists
  the inbox (`threads.list`, INBOX, 500 per page) and reads Gmail's change log since the last read
  (`history.list`, 2 units per page). Only threads with a new or deleted message, or a non-system label
  removed, are fetched again (`threads.get`); added labels and read/star/importance/tab changes are
  patched in place, so reading mail or an Apply costs nothing on the next read. Without a usable log
  (about a week old, or a snapshot from before the log was used) a thread whose `historyId` moved is
  fetched only if it has mail since the last read (`messages.list` `after:`, an hour's margin); the rest
  get their own labels redone from one `threads.list` per label (~15 s for 130 labels), or are fetched
  when that is cheaper. A message deleted from a kept thread isn't seen then. Threads that left the
  inbox drop out. The header keeps how the last read went (`snapshot.read`); Review warns after an hour.
- **Your Gmail labels** feed card suggestions ("you labeled 80% as X"). A column's own label counts by
  itself; *Your labels* maps the others (`config.labelMap`, by top-level label; null switches one off).
  The *Gmail* tab shows all of them and lets you merge or hand one over (below: Labels).
- **Filter status on the board.** `rules.js planFilters` (the plan's filters without the inbox backfill,
  ~10 ms) and `LabelboardSync.filterStatus` run on every move: each column head, card drawer and the
  Review button's count say whether a label's filters are live in Gmail, made, changed or removed on
  Apply, or left out. Status is per label, since a label's cards share chunked filters. Each card carries
  a funnel mark with its label's status, and one for filters of yours that match its mail. Filter terms
  are sorted, not in card order: cards sort by size and Apply changes sizes, so card order made every
  multi-card filter read as changed after each Apply (sorting moved 26 of 135 real queries once).
- **Gmail now vs the board, for mail already in the inbox.** No apply record is needed: the snapshot
  has each thread's labels. `rules.js stats` (~20 ms on 1,200 threads, every move) compares them with
  `threadPlace` (labels to add, the inbox to leave, an owned label to take off) into `apply.byThread`;
  cards, column heads, the rack, the drawer and the Review count read it. `threadPlace` is also what the
  plan's backfill sends (primary card, then every filter that matches, as Gmail runs them), so after
  Apply and a read the count is 0. Two models here once left 108 threads "to change" after every Apply.
  Apply sends only the threads that change, then runs a read, so the board shows what Gmail has.
- **How a label got there** (the *Filters* view, the filter drawers, the card drawer). Gmail records
  neither who added a label nor when a filter was made, so `insights.js filterTrace` runs every filter's
  search (`parseQuery`) on every thread: labelled and a live filter matches = *by a filter*; labelled, no
  filter = *by hand*; a live filter matches, no label = *came before the filter* (or the label was taken
  off); only a filter Apply would make = *caught once you apply*. Labelboard records `at` on each filter
  it makes (owned blob, since Oct 2026), so mail older than that with the label reads *labelled at Apply*.
  Filters made before then, and yours, have no date: the view's day bars show where hollow turns solid.
  ~300 ms on a 1,200-thread inbox with 150 filters, so the board computes it only when asked, and keeps it
  until the filter list or the mail changes.
- **Your Gmail filters** are read live on every board load (`filters.list`, 1 unit) and shown in the
  *Gmail filters* lane (Labelboard's own, one card per column, then yours): what each of yours matches in the inbox (when its search is sender/subject-shaped,
  `parseQuery`), and which board label those threads get. They are never written unless you **adopt**
  one: the board then keeps its spec in `config.adopted`, the next Apply adds its id to the owned filters,
  and from then on it is edited or deleted like the board's own. *Hand it back* releases it untouched.
  Only filters that label and/or skip the inbox can be adopted (no forward, mark-read, star…).
- **Drift.** The owned filters (user-property blob `owned`, chunked: specs outgrow one 9 KB property)
  keep each filter's spec (query, label, archive). One deleted in Gmail, or edited there (different
  spec), goes to its `gone` list: Apply leaves the board's version out
  until you restore it, instead of quietly writing it again; an edited one becomes yours. Not checked
  live: whether Gmail's own "edit filter" keeps the id (either way it is caught).
- **Apply** (Review changes) is the only write, besides its undo (below): labels, filters (diffed through `LabelboardSync.
  filterActions`, the same function Review uses), then the inbox threads of the snapshot by id, then
  labels moved (below: Labels).
- **Re-sort.** A label Labelboard created (`ownedLabels`, an id list in one property: fine to ~400 labels,
  then it needs the chunked blob too; labels of yours it took as they are, `adoptedLabels`, are left out:
  they carry mail no card gives) that an inbox thread carries but the board
  no longer gives it comes off on Apply (a card moved, a column renamed). Labels you made never come
  off, including pre-existing labels used as column labels, until you hand one over. Archived mail (even
  in the window) is never re-sorted (not built: it needs a Gmail search per moved card); only a label
  move reaches it.

## Labels: colours, leftovers, hand-over (Oct 2026)
The board used to build its `_` tree next to yours and never look at the rest of the sidebar: folders came
out grey, every layout change left the old labels behind, and `Portfolio/V1/Acme` sat beside
`_Portfolio/V1/Acme`. `src/labels.js` (pure, Node-tested) now sorts Gmail's labels against the board.
- **What a label is** (`classify`): a column's own, the board's (in `layout`: every label a card or
  contact *would* get, mail or not, since `planFilters` makes a company's label only once it has mail in
  the read), left over (owned, not in the layout), or yours. `gmailState_` sends `labelInfo` (name,
  colour) and `adoptedLabels`; counts come from `labelCounts` (`labels.get` per label, when the view opens).
- **Colours** (`rules.js labelColor`): a column's label its colour, everything under it, folders
  included, the palette's lightest shade of that hue with its darkest as text. `buildPlan` emits the
  folders in between, so the server never makes a grey one; `plan.recolor` fixes labels the plan leaves
  out (a company with no mail in this read). Columns closer than ΔE 15 are flagged with a free colour.
- **Leftovers** go to the one layout label they name (same last part, case and accents aside: `_M&A/Orbit`
  → `_M&A/Deals/Orbit` after a restructure), else are deleted only if empty. `config.leftovers` overrides.
- **Hand-over** (`config.handover`): *fold into* a column (each label lands on the same path there, or the
  one label it names; `Buyers` folds onto `_M&A/Buyers`) or *take it as it is* (a top-level one becomes a
  column). A filter of yours that adds a folded label is adopted with its label rewritten; one Labelboard
  can't adopt (it forwards, adds two labels) blocks the fold. Names are matched ignoring case: unverified
  whether Gmail itself refuses `Northwind` next to `NorthWind`.
- **Moves** (`Code.js moveLabels_`, the last Apply phase): per label, children first, its message ids
  (spam and trash too) are listed and recorded before the first change, then moved 500 per
  `batchModify`, then the label is deleted unless labels remain under it. Only owned labels and names in
  `plan.handover` move. The record keeps every id so undo is exact per message; past `Sync.MOVE_CAP`
  (4,000 messages in one Apply, ~70 KB of the 500 KB) Apply stops with a plain message.
- **Scopes:** none added. `labels.delete`, `labels.create` and `messages.batchModify` were already in use
  under `gmail.modify` (undo, Apply).

## Undo and the apply record (Oct 2026, session 3)
- **The record** (user-property blob `record`; a key starting with `apply` would land in the 6 h cache):
  `{ applies: [entry, oldest first], undo: progress, undone: {at, kind, summary} }`. An entry is written
  before Apply's first Gmail write (`Sync.recordApply`, so a full storage stops Apply with nothing
  changed), by label name: `labelled` (threads it labels; the board sends each skip-inbox backfill's
  `had`, threads that already carried the label, so undo never takes off a label a thread had before),
  `archived`, `unlabeled` (re-sort). `Code.js` adds `labelsCreated`, `recolored` (the colour before the
  first change), `filtersCreated` (id, label, archive), `filtersRemoved` (spec), `adopted`, `labelsAdopted`
  and `moved` ({from, to, colour, owned, ids, had}) as each happens; `done` at the end. An Apply run again after it stopped merges into the stopped entry.
- **Undo this Apply** reverses the last entry, once (then only *Remove everything* goes further back).
  **Remove everything** reverses every entry, deletes every owned filter and deletes every owned label
  that ends up empty. `Sync.planUndo` composes entries newest first, oldest wins per thread and label.
- **Order** (`applyUndo`, slices like Apply, progress in `record.undo` so a closed tab resumes with
  *Finish undoing*; Apply refuses to start meanwhile): filters (deleted; the ones the last Apply removed
  are made again, as Labelboard's; adopted ones handed back: `adopted` on the owned spec, plus the
  board's `config.adopted` matches for filters adopted before the flag), then mail a new skip-inbox
  filter kept out since the Apply (`threads.list` on the label, `-in:inbox after:<epoch s>`: back in the
  inbox, label kept, since it may be yours), then moved labels back (`unmove_`: a deleted one made again
  with its colour, parents first; its messages get it back and lose the new one unless they `had` it),
  then one `threads.modify` per thread with all its changes, then labels of yours taken as they are handed
  back, colours back and created labels deleted when `labels.get` says no threads, children first.
- **Not reversed:** a filter handed back (*Hand it back*) stays yours: re-owning it would make the next
  Apply delete it, since the board no longer lists it. A filter you edited in Gmail since is yours
  (`reconcile`) and stays. Mail you labelled with a Labelboard label yourself keeps it, so the label stays.
  The board keeps its placements: Review then offers the same Apply again.
- **Applies before the record** (before 17 Oct 2026) have no entry: *Remove everything* deletes their
  filters but can't tell which mail they labelled, so those labels stay; its confirm counts them
  (`Sync.unrecorded`).
- **Unchecked live:** the `after:` epoch-seconds search, `threadsTotal` on a label holding only trashed
  mail, and whether `labels.patch` can clear a colour (a label that had none keeps Labelboard's).
- **Preview:** `dev/serve.mjs` runs the same `planUndo` on its data folder when it holds a `record.json`.

## Quota and pacing (Gmail API, per user, checked Oct 2026)
6,000 units/min per user (per Cloud project; Apps Script uses its default one). Costs used: threads.get
40, threads.list 10, messages.list 5, messages.batchModify 50 (≤1,000 ids), threads.modify 10,
labels.list/filters.list 1, labels.create and filters.create/delete 5 (labels.patch isn't listed: 5
assumed). Source: developers.google.com/workspace/gmail/api/reference/quota.
- Every call spends from a token bucket (`LabelboardSync.budgetWait`): 90 units/s, burst 400, so no
  60 s window passes 5,800. Its state rides in the slice cursor; the gap between slices refills it, so
  15 s slices cost no speed. Quota errors still get a wait-and-retry.
- Parallel `google.script.run` calls or the HTTP batch endpoint don't help: the limit is units per user.
- A first read stays bound by threads.get: 1,200 threads = 48,000 units ≈ 9 min. Why not messages.get
  for single-message threads: `CLAUDE-PROSE.md`.
- Apply labels by label, not by thread: one `messages.batchModify` per label used by ≥5 threads (on the
  inbox message ids from `messages.list`), `threads.modify` for the rest, for threads that left the
  inbox since the read and for every label removal; archiving goes last. On the real snapshot: 169 calls / 3,510 units instead of
  984 / 9,840. Labelling only the inbox messages of a thread is enough for Gmail to show the thread
  under the label; your sent replies in it don't carry the label.

## Why Apps Script, not the Gmail API from a local tool or XML import
- XML import (Settings → Filters → Import) is one-way. You can't read what's there, can't diff, and someone has to click.
- A local tool on the Gmail API (gmailctl's model) needs every user to create a Google Cloud
  project and OAuth client. That is the hardest step in gmailctl's README.
- Apps Script runs as the user inside Google with the same API (advanced Gmail service) and no
  setup, and it can host the board itself (HtmlService).
- The XML download stays as a fallback for Workspace accounts whose admin blocks Apps Script.

Borrowed from gmailctl: config as the source of truth, diff before apply, rule tests.
Unlike gmailctl, filters Labelboard did not create are never deleted.

## Security (reviewed Oct 2026)
- The web app runs as the person opening it (`executeAs: USER_ACCESSING`) and only its owner may open
  it (`access: MYSELF`). A shared link hits Google's login, then "you need access". Never pair
  `USER_DEPLOYING` with any access wider than `MYSELF`: everyone with the link would read the owner's mailbox.
- The real boundary is the script project's Drive sharing: an editor can change code that runs on the
  owner's Gmail at the next open. Keep it unshared. Baked settings (`build --bake`) sit in that code too.
- `gmail.modify` lets the code read bodies and send mail; the code doesn't. It is the narrowest scope that
  labels threads. Server functions ending in `_` can't be called from the page.
- Mail fields are attacker-controlled (anyone can mail you): every one goes through `h()` before
  `innerHTML`. Sortable, the only outside script, loads with an integrity hash.
- Settings files are outside input too (shared, imported): column colours reach `style`/`fill` raw, so
  `bandOf()` passes only `#rrggbb`.
- `script.scriptapp` exists for one installable trigger, `runLater`, kept while a column or card archives
  later or *Runs on its own* is switched on, deleted when neither is. It runs as you, hourly: it takes inbox
  threads matching a card's or column's own search out of the inbox, and, if you switched it on, reads what
  changed and applies what the rules placed (above: On its own).
- The manifest lists its scopes, so the server can't make outside requests (`UrlFetchApp` needs a scope
  it doesn't ask for). The repo holds no script id (`.clasp.json`), build (`dist/`) or mail data.
- `dev/serve.mjs` listens on 127.0.0.1, refuses a foreign Host header and non-JSON POSTs.

## Gmail behaviours relied on (checked live, Oct 2026)
- `to:` also matches Cc: `in:inbox cc:x -to:x` returns nothing. Filters use `from:` + `to:` only.
- Participant counts matched Gmail exactly on a 15-thread company rule.
- Not yet checked live: subject phrase matching with punctuation (`[Dealflow]`, `Accepted:`), and the
  longest filter query Gmail accepts. Queries are kept under ~900 characters.

## On its own: reading and applying while you're away (Oct 2026)
- Two switches in `config.auto`, off by default: `read` (what changed, every 6 hours) and `apply` (then apply
  what the rules placed). `runLater`, the hourly trigger's handler, archives first, then `runAuto_` reads
  if the last read is 6 hours old, by looping `scanInbox` slices with `{auto: true}` (the snapshot's `read.auto`
  makes the header say "on its own"). Never a first read; a read that doesn't finish in 4 minutes is dropped.
- It applies only when the last Apply finished and sent the same settings (`rules.js settingsKey`, recorded on
  each entry; `ui`, `release` and `restoreFilters` left out): the only news is then what the rules placed.
  `rules.js autoPlan` is Review's plan with nothing only you start (no unlabel, moves, hand-overs, adopts,
  recolours); `Rules.js` ships to Apps Script for it. An empty diff writes no record entry. The entry is
  marked `auto` and undone like any other.
- Yours first: while one runs (cache key `auto`, 10 min) a read, Apply or undo from the board refuses
  with a plain message; it skips an hour while yours runs (`scan` or `apply.m` in the cache, or an undo).
  A user lock keeps two runs apart. `autoLog` keeps the last run for Settings.
- The trigger exists while `timed` rules exist or `auto.read` is on: `setLater_` at Apply and `saveConfig`
  when the switch flips (property `autoRead`) call `syncTrigger_`. No new scope.

## What a card does: actions, conditions, archiving later (Oct 2026)
- When mail leaves the inbox is one answer per column (`b.archive`: right away, Gmail's own; `b.later`: after
  N days or once read, Labelboard's hourly check), and a card follows it unless it sets its own
  (`rules.js leavesOf`/`cardLeaves`; a card's "stays" is `act.archive: false` plus `later: {off: true}`).
  Cards that follow their column share one timed rule (`col:<id>`, its cards' terms chunked), so a
  column's archiving is one search an hour, not one per card. The rules live in the chunked blob `timed`.
- A column sets skip inbox and mark as read; a card overrides either way and adds star, important and
  delete (`rules.js cardDoes`). A card whose actions equal its column's shares the column's OR-filter, so
  boards with nothing set keep their filters byte for byte. Any other card gets its own filter: Gmail
  runs every matching filter, so a card that stays in the inbox can't sit in an archiving one.
- A condition (`when`) adds a second filter for the card's yeses: its terms AND the condition. Its noes
  and its label stay unconditional. Why not conditions on the whole card: docs/CLAUDE-PROSE.md.
- Apply's backfill does skip inbox and mark as read (only threads unread now, recorded, undone by
  marking them unread). Star, important and delete are for new mail; delete takes mail already here out
  of the inbox. Undo of a deleting filter searches `in:trash` for what it caught and untrashes it.
- Archiving later: Apply stores the rules (user property `later`) and keeps one hourly trigger while
  there are any. `runLater` lists `in:inbox (card search) older_than:Nd` (or `-is:unread`) and drops
  every thread that also has a newer or unread message, since Gmail tests those per message. What it
  archived per card (14 days) shows in the card's drawer. Undo puts the previous rules back; mail it
  archived stays archived, as if you had archived it.
- The read adds `dir` (you in To or Cc) and `att` (a message whose MIME type is `multipart/mixed`, close
  to Gmail's `has:attachment`): both are in the metadata response. Threads read before keep neither until
  they change, so the board counts them as not matching those conditions; Gmail decides for new mail.

## Emulation limits (board numbers vs Gmail)
- Domain match includes subdomains (`acme.com` matches `mail.acme.com`), as Gmail's `from:acme.com` does.
- Subject phrases compare whole words, ignoring case and punctuation.
- The board counts threads; Gmail labels messages. A thread whose matching message isn't the
  newest still shows under the label in Gmail, so counts agree for practical purposes.
- Backfill does not trust the emulation: the server runs Gmail's own search for each label.

## Views (Gmail, Inbox, Priorities), Oct 2026
- Five tabs since 28 Oct 2026: Home, Board, Gmail (was Flow, Filters, Labels), Inbox (was Overview, All
  threads), Priorities. A saved `config.ui.view` from before maps to its new tab (`app.js MERGED`).
- Read-only views over the same snapshot and config as the board. Only Priorities' reply numbers need
  more: the 30-day window (below).
  `src/insights.js` (pure, Node-tested) computes them; `src/board/views.js` draws Inbox and Priorities as
  plain SVG/HTML, `src/board/gmail-view.js` the Gmail tab.
- **The Gmail tab** (`insights.js gmailFlow`): every label a thread has, or a filter would give it, comes
  from one source, a column's filters, a filter of yours (or one handed over outside the columns), or none
  (by hand), to a column's labels or a tree outside the columns. Each link counts a thread once, by state:
  labelled now, once you apply, or came before the filter. Rows are HTML (menus live in them), so the bands
  are drawn after the page lays them out, from their measured positions (`rowLayout` with `at`).
- Every number starts from `R.threadPlace` per inbox thread, the function `stats()` (the rack) uses, so a
  view and the rack never disagree on where a thread goes.
- "From a person" = not a machine sender (`R.isMachine`), not a group address (`config.aliases`), not in
  an `automated` column. "Waiting on you" = the thread's last message isn't yours (`I.turns` over the
  record's `msgs` timeline: `[epoch s, 1 if SENT]` per message, drafts left out). Records read before
  timelines existed fall back to "no SENT label in the thread".

## The 30-day window: mail outside the inbox (board, Gmail tab, reply numbers), Oct 2026
- An inbox-only read hid what skips the inbox: mail your own filters archive never showed on the board
  or in Flow, and a column set to skip the inbox emptied itself after Apply. So every read also covers
  the last 30 days of mail outside the inbox. On by default (was opt-in from Priorities until 16 Oct
  2026); `windowOff()` sets `snapshot.window = {off: true}` and reads stay inbox-only until Priorities
  turns it back on (`scanInbox(cursor, {window: true})`). Same read, same metadata, no new scope.
- The read lists the inbox plus `LabelboardSync.windowQuery(days)` (`newer_than:30d -in:chats`, every
  category: group mail a filter archives often sits in Forums), and runs both through the same
  diff/merge. `history.list` is mailbox-wide, so the window stays incremental. Inbox records active in
  the window without a timeline are fetched once (`addTimelines`).
- `splitWindow` puts back apart what the inbox listing returned (the snapshot, unchanged) and the rest
  (blob `recent`, no snippets). The board builds its cards over both (`S.mail`), leaving out window
  threads only you wrote in. Everything that counts or writes still takes the inbox alone, by the INBOX
  label: the rack (`stats`), backfill and re-sort (`buildPlan`), Inbox, Priorities.
  The Gmail tab and the filters lane take both: archived threads flow from their filter to their label,
  and your filters count what they took out of the inbox.
- A card now grows from archived mail too, so Apply can write filters for senders seen only there
  (often already handled by a filter of yours: the card says so), and a process card's `must` terms can
  pick up signals from archived threads. With no window the cards and plan are unchanged (checked on
  the real snapshot).
- Sent and received totals are counted from `messages.list` pages (5 units per 500), never fetched.
- Storage: the snapshot is written first; if `recent` doesn't fit the 500 KB of user properties, the
  window halves its days (`windowShrink`, newest threads kept, `window.shrunk`) until it fits, and later
  reads keep the smaller window. Under 2 days: `{error: 'full'}`, inbox only, offered again in
  Priorities. Bigger needs the cache or Drive (not built).

## Settings and presets
- The engine has no built-in buckets beyond these ids, which `suggest()` and `threadMove` name and every
  preset must ship: `unsorted`, `keep`, `calendar`, `tools`, `newsletters`. Everything else (topic
  buckets, processes, extra newsletter domains) is settings: see `presets/` and the README.
- A card whose column is gone (preset swap, deleted column) is placed in Unsorted with `lost` set
  (`placement()`); `orphans()` lists every id still named, `remapBuckets()` moves them all at once.
- Card keys (`entity:<bucket>:<name>`, `process:<name>`, `domain:…`, `sender:…`) are what placements
  (`config.cards`) and `threadOverrides` key on. Changing their format orphans every placement.
- `AUTOMATED_TOKENS` is part of every people-bucket filter query. Changing it changes every query, so
  the next Apply deletes and recreates all of the tool's filters.

## Demo mailbox (Oct 2026)
- `dev/demo.mjs` generates a made-up mailbox (a design studio on the basic preset) into a folder outside
  the repo; nothing generated is committed. Seeded, so ids and card keys repeat; dates count back from now.
- Records are built like the server's: a timeline first, then `date`, `count` and `SENT` from it, the
  window through `Sync.splitWindow`, placements from `buildCards`' own suggestions. `test/demo.test.mjs`
  holds it to that, and to `.example` addresses only. `snapshot.source: 'demo'` changes the header pill.

## Deploy bundle
`dist/` must ship `Code.js`, `Sync.js` (pure helpers, also inlined into the board), `board.html`,
`appsscript.json`, `Baked.js`, `Presets.js` and `Rules.js` (a copy of `src/rules.js`, for applying on its own):
`Baked.js` and `Presets.js` define the globals `BAKED_CONFIG` and `PRESETS` that `Code.js` reads (a missing one
= blank first open).

## Storage (Apps Script)
- Config, contacts and snapshot: gzip + base64, chunked into user properties (500 KB total).
  About 1,200 inbox threads take ~170 KB. A much bigger inbox needs the snapshot moved to the cache or Drive.
- A scan in progress is kept in the user cache (6 h). It can always be rebuilt.
