# Design system

Direction **Tags** (decided 16 Oct 2026): every card on the board is the label tag from the mark, so the
board and the brand say the same thing. The tag is the one bold element; everything around it stays
quiet so any Gmail label color can sit on it. Tokens live at the top of `src/board/style.css`.

Rejected: *Sorting frame* (the old board, re-tokened: fine, but no personality) and *Trays* (columns
filled with their label color: friendly, but a user's loud palette makes a loud board).

## Color
The chrome is violet-tinted neutrals plus one accent. Gmail label colors never touch the chrome: they
reach the page only as the card's tag (`--band`), the column dot, chips, rack slices and the Labels
tab's swatches. A sub-label chip uses the column hue's lightest shade, as Gmail shows it after Apply
(`rules.js shadeOf`); a label with no colour gets a hatched swatch.

| Token | Light | Dark | For |
|---|---|---|---|
| `--board` | `#ecebf1` | `#16141c` | page background |
| `--surface` | `#ffffff` | `#24212d` | cards, rack, drawer, sheet, inputs |
| `--raised` | `#e3e1ea` | `#1d1b25` | column wells, tracks, query box |
| `--ink` | `#1d2230` | `#f1efe9` | text, the mark's stem, toast background |
| `--muted` | `#5d5970` | `#a29cb6` | secondary text |
| `--rule` | `#d3d0de` | `#36323f` | borders, dividers |
| `--hatch` | `#bdb8cc` | `#4a4558` | dashed wells, no-label tags, switch off |
| `--accent` | `#6247d6` | `#a896ff` | primary button, links, focus, "after" number, the mark's tag |
| `--on-accent` | `#ffffff` | `#15131c` | text on the accent |
| `--danger` | `#b3261e` | `#ff8a80` | drift, stale read, warnings |
| `--claude` | `#b4532a` | `#f0a07e` | what Claude placed: its ring and *Claude* pill, nothing else |

- Chip text color comes from Gmail's own `textColor` for the label (or `textOn()` in `app.js`).
- Dark mode follows the system unless Settings → Look sets `data-theme="light"` or `"dark"`
  on `<html>`. The dark tokens are written twice (system block and `:root[data-theme="dark"]`): keep them equal.
- The mark's SVGs use ink and accent with the same hex values.

## Type
- **Bricolage Grotesque** (600–800) for display: wordmark, numbers, headings, counts. Tight tracking
  (−.01 to −.04em), heavier as it gets bigger.
- **Atkinson Hyperlegible** (400/700, italic 400) for everything you read.
- Monospace only for Gmail filter queries, which are code.

| Use | Size / weight |
|---|---|
| Rack numbers | 60 / 800 (40 on phones); "still unsorted" 32 |
| Home's next step | 44 / 800 (32 on phones) |
| First-run heading | 30 / 800 |
| Drawer, sheet title | 24 / 700 |
| Wordmark | 23 / 700 |
| Column heading, review section | 18 / 700 |
| Card count | 16 / 700 |
| Body | 15 / 400, line-height 1.45 |
| Meta, hints, card details | 13 and 12 |

## Shape
- `--r-pill` buttons, search, chips, rack bar, toast. `--r-panel` 16 rack, sheet. `--r-well` 14 column
  wells, add-bucket. `--r-field` 8 form fields, query box. `--r-tag` 6 the tag's square end.
- One shadow (`--shadow`) for the rack and filter slips, one (`--lift`) for the drawer and sheet.

## The tag card
- `clip-path` cuts a 12px point on the left (16px tall at the middle); the left 20px is the label color
  with a 3px punched hole at x=9px in `--surface`. Text starts at 30px.
- A tag without a label (Unsorted, Keep in inbox) is `--hatch`.
- `clip-path` clips outlines and shadows, so every ring is an inset box-shadow: hover 1px `--hatch`,
  placed by you 1.5px `--accent`, placed by Claude 1.5px `--claude`, keyboard focus 3px `--accent`.
- **Who put it there** opens the reason line as a small pill: *You* (`--accent`), *Claude* (`--claude`, a
  review you imported or Claude's read), *Rule* (contacts, topics, subject rules, the sender's look) and
  *Gmail* (dashed: labels the mail had before). `rules.js placement().who`. The toolbar's *Show* pick
  filters by it; *Keep it here* in the drawer turns Claude's card into yours.
- **Its own rule** (`.card-does`): a card that does something its column doesn't (skip inbox, mark read,
  star, delete, a condition, archiving later) shows it in one `--accent` line with a bolt, above the
  reason line. Column defaults are never repeated on cards. Hidden on compact cards.
- Filter slips in *Gmail filters* stay rectangular with a 5px band: Gmail's filters, not
  Labelboard's tags. Their drift outline is a dashed `--danger` line.
- Filter status (`.fs`, column heads, card drawer, lane): a muted ✓ for live in Gmail, an `--accent` dot
  for anything waiting on Apply (the same accent as the Review button), `--danger` for left out, a
  dashed hollow dot for no filter. The Review button shows the count of waiting changes as a badge, and
  turns into a plain *Gmail is up to date* button when there are none.
- The funnel means "a Gmail filter". Column heads show the status as a pill with the funnel (accent
  border while waiting on Apply, dashed when there is none). Every card has a funnel line under its
  title: solid in `--ink` when live, `--accent` on Apply, `--danger` left out, dashed hollow for none;
  a hollow muted funnel with a count for filters of yours that match its mail. Compact cards keep the
  funnels only, before the count.
- The tag icon means "the mail already here". Same code: `--ink` *Sorted in Gmail* when Gmail's labels
  already match the board, `--accent` *N to sort on Apply* while Apply would label, archive or unlabel
  some of it. It sits on the card's funnel line (compact: icon and count), as a second pill on the column
  head, as a line under the rack (counts for the whole inbox), and per thread in the card drawer ("On
  Apply: gets X, leaves the inbox"; Gmail's labels now as "In Gmail:"). *Only what Apply changes* in the
  toolbar keeps the cards with a mail or filter change. The rack's accent number says "after you apply".
- Known overlap: "placed by you" is also an accent ring, though it is a board choice, not a pending change.

## Layout
- The page doesn't scroll on a desktop: header, rack and toolbar stay put and the board takes the rest
  of the height; each well scrolls by itself. Under 640px the page scrolls and wells cap at 82dvh.
- Header: wordmark, meta, *Read mail again*, *Review changes* (the one primary) and a gear that opens
  Settings where you left it. No menu: theme, card density, import, export and *Remove everything
  Labelboard made…* (a `--danger` button under *Start over*) all live in Settings.
- The meta ends with the last Apply ("applied 2 hours ago: 11 filters, 360 threads", dotted underline,
  opens Review), "undone …" after an undo, or a `--danger` "undo stopped". Review leads with that Apply
  in a `--raised` box with *Undo this Apply…* (a `--danger` outline button). Undo and Remove everything
  confirm in the Review sheet: *What goes back* / *What stays* in numbers, a filled `--danger` button.
- The rack goes slim (numbers inline, 8px bar, no key) while a long column is scrolled, and opens again
  at its top.
- Compact cards (the Cards pick) keep title, count and sub-label; kind and reason hide.
- Opening: until the settings and snapshot arrive, the header is the wordmark alone and the rack holds
  only its progress bar, sweeping under *Opening your board…* ("Still opening…" past 8 s). No numbers
  show before they're real. A failure stays there in plain words with *Try again*. The theme pick is
  kept in the browser too, so a dark board opens dark.
- First run: two numbered steps (pick a preset, read the inbox); the rack and toolbar wait for the read.
- Settings is a wide sheet: sections on the left in three groups (Sorting, You, More; a pill row on
  phones), list sections show their count, one section at a time, edits apply as you leave a field.
  Every list (columns, topics, processes, subject rules) is folded rows: dot, name, the Gmail label it
  makes in mono, a summary, a chevron; one opens at a time, *Remove* at the foot of its form, a search
  over 6 rows. Lists of values (addresses, domains, phrases) are chips: Enter adds, a pasted list
  splits. Something that needs a decision (columns that are gone) gets a `--danger` nav item and a
  banner over the board.

## Columns
A heading on the board background over a `--raised` well that holds the cards and scrolls. Columns
without a label (Unsorted, Keep in inbox, Gmail filters) get a dashed, transparent well. Dragging
over a column rings its well in the accent. A column's heading drags it to a new place; its chevron folds
it into a 48px rail (name set vertically, count under it) that still takes drops.
- **Width.** Up to six columns share the screen (`.board.fit`, floor 176px, then the board scrolls) and
  *Add a column* becomes a 40px rail, so a basic board fits 1280px. Above six they are a fixed 272px,
  where scrolling is honest. The filters lane is 300px and starts folded until you open it, unless one
  of Labelboard's filters changed in Gmail (`ui.lane` remembers your pick).
- **Narrow columns** (under 230px, a container query): the kind line hides, the title and the reason
  wrap to two lines, and domains break at their dots.
- A column with suggested cards offers *Accept the N suggested cards* under its numbers: they become
  placed by you. Unsorted has nothing to accept.

## Numbers
Everything counts the inbox; archived mail (the 30-day window) is only ever a suffix: "172 in your
inbox +99 archived". A card whose mail is all archived shows that count muted, with "all archived".
The Gmail tab is the one exception: its bands include archived mail (that is what it shows). "Answered" has one definition everywhere: the last message in the
thread is yours (`insights.js waitsSince`), counted over threads from people.

## Triage
*Sort N unsorted cards one by one* (in the rack, beside "still unsorted") opens a centred sheet over
the dimmed board, one card at a time, biggest first: its numbers, the reason, the latest five subjects
(three on phones), and a button per column. Keys: 1–9 and 0 pick a column in board order (Unsorted
left out), Enter keeps the suggestion, S skips, ← goes back, Esc closes. A pill pick switches between
*Unsorted* and *Not placed yet* (every card you haven't placed). The end screen points to Review.

## Home
The first tab, and where the wordmark goes (`home.js`). The rack and search hide on it: Home says the
same thing as the next step. Settings → Look picks the look (`config.ui.home`) and what opens
(`config.ui.open`: Home by default, the board, or where you left off).
- **What now** (default). A `--surface` hero: a Read · Sort · Apply · Answer trail (the current step
  an `--accent` dot), the next step as one sentence at 44/800, what it means in `--muted`, the rack's
  bar at 16px, and one primary button that does it. Before the first Apply the steps run in order;
  after it, waiting changes come first, then replies, then new senders in Unsorted. Beside it the
  rest of what waits, a number each; under it the *Since …* line and a row of doors, one per view
  with a small picture drawn from its own numbers.
- **Gallery.** The next step as one line, then a tile per view (4 in a row): its picture at 90px on
  `--raised`, its number at 32/800.
- **Labels.** Now → after Apply at 60/800, the next step as one line, then each column as the tag card
  at poster size (32px band, 8px hole), biggest first; a tag opens the board at that column.
- *Since …* counts from the read you saw last time (`config.ui.seen`, `insights.js since`): threads
  with new mail, answered by you, went to a column, new senders in Unsorted. No newer read, no line.

## Views
Tabs (a pill row like the menu's picks) in the toolbar switch between Home, the board and three views
(Gmail, Inbox, Priorities);
the pick is kept in `config.ui.view`. Off the board, the rack stays slim (hidden on Home), the search
dims what doesn't match, and the *Show* pick and the drag hint hide.
- **The pane under the board** (board only, `views.js pane`). A `--surface` panel with a grip on top.
  Folded: *Gmail now* and *After Apply* as two 10px bars by column (hatched leaves the inbox, `--hatch`
  no label yet) and, on the right, the last move in numbers with *Undo*, else how many inbox threads
  Apply changes. Pulled up (grip or *Show the flow*, height kept in `config.ui.pane`): a Sankey, Gmail now
  → cards → after Apply; bands Apply leaves alone are faint, the card just moved has an `--accent`
  outline, and a card's bar drags onto a column (accent ring on the target). The rack goes slim while it's
  open, and the board keeps 240px.
- Colour is the column's Gmail label colour, nothing else: rack slices, flow bands, bubbles and squares
  all say "this column". Single-series charts (months, ages) use `--accent`; age steps are opacity on
  the accent (1, .7, .45, .25). Hatched means "skips the inbox", as in the rack.
- Text stays in `--ink`/`--muted`, never the series colour. Sankey labels on the board background get a
  `--board` halo so bands can pass under them.
- One tooltip (`#tip`, ink on surface text) for every view; keyboard focus shows it too. Anything that
  stands for a card is a button that opens its drawer.
- **Gmail** answers "what does Gmail do with my mail". Two columns of `--surface` rows, filters left (a
  column's: its dot, name, status, *Leaves the inbox* menu, *Show N cards* with each card's own menu; yours:
  the query in mono; *No filter* dashed), labels right (a column's chip and its tree on demand, your trees with
  their menu, drag handle and lookalike line), a 5px bar in the series colour on the inner edge of each. Between
  them, filled ribbons in the filter's colour: 42% opacity labelled now, 24% once you apply, 7% came before the
  filter, a `--surface` hatch over any that leaves the inbox. Hovering a row lights its ribbons. Above: chips
  in numbers, the lookalikes bar (accent edge, *Merge it* / *Merge all*), the drag confirm in the same bar.
  Below, *Day by day*: a row per column and per filter of yours, its days as bars (solid column colour by a
  filter, 40% at Apply, `--hatch` by hand, hollow came before the filter, dashed `--accent` once you apply),
  the older mail as one share bar, a dotted line on the day Labelboard made the filter.
- **Inbox**: *Who writes* (bubbles by column, top writers, months), *Every thread* and *By age* (a square per
  thread), one segmented pick.
- Avatars are initials on the column colour. No logos yet (they would send sender domains to a favicon
  service; see the roadmap).

## Motion
Only in answer to an action: the drawer slides, the tag recolors when it lands in a column, the rack
slices resize, the toast rises, the progress stripes crawl while a read runs (and sweep while the board opens). One easing (`--ease`).
All of it is off under `prefers-reduced-motion`.

## Floor
Text contrast at least 4.5:1 on its surface in both themes, visible keyboard focus everywhere, works at
phone width (columns are 84vw there), no Google colors or Gmail envelope (see `BRAND.md`).
