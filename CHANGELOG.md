# Changelog

One section per version, newest first; changes not released yet go under `## Unreleased` at the top. Each version is one Apps Script deploy, and the release zip of
the same tag holds its `dist/`. v0.0.1 to v0.0.8 went out labelled v0.1 to v0.8.0 and were renumbered.

## v0.0.27 · 26 Oct 2026
- A *Labels* tab: every label in your Gmail, in the colour Gmail shows it, under the board's columns or
  as yours. Fold a label of yours into a column (its mail moves, inbox and archived, onto the same
  sub-labels there, and a filter of yours that adds it goes with it) or let the board take it as it is;
  a top-level one becomes a column. Nothing of yours changes until you pick it and apply.
- Labels Labelboard made for an earlier layout (a renamed column, folders reorganised) are listed as left
  over: Apply moves their mail to where each card is now and deletes them; empty ones are just deleted.
- Colours: a column's label keeps its colour, its sub-labels and folders get a lighter shade of it. The
  folders in between (`_Portfolio/Fund I`) no longer come out grey. Columns that look alike are flagged
  with a colour to switch to.
- Undo puts moved mail and deleted labels back, message by message, with their colours.
- Home: a Labels door; a four-digit count no longer runs into its text.

## v0.0.26 · 21 Oct 2026
- *Gmail now* and *After Apply* under the board match when Apply has nothing to change. Mail with no
  label now shows as Unsorted or Keep in inbox in both bars, and a thread with two column labels counts
  in its card's column, not in whichever label Gmail lists first.
- A column's "in your inbox" counts threads where they land: a thread you moved on its own counts in the
  column you moved it to, as the bar above the board does.

## v0.0.25 · 21 Oct 2026
- A card decides what happens to its mail, not only its column: open a card, *What happens to its mail*.
  Skip the inbox and mark as read (yes, no, or as the column), star it, always or never important, delete
  it (asks first). One company in Portfolio can now skip the inbox while the rest stays.
- *Only when…*: the yeses wait for a condition: it came through a group address, it isn't sent to you
  by name, it has an attachment, the subject has a word, except some senders or words. The label always
  goes on.
- *Archive it later*: a day, three, a week, two, a month after it arrives, or once you've read it.
  Labelboard checks every hour. This needs one new Google permission (run while you're away), asked once
  when you next open the board.
- An idea line on cards whose mail suggests one, e.g. "9 of these 12 came through deals@yourfirm.com and
  you answered none. Skip the inbox when it comes that way?" with *Do that*.
- Apply marks mail already in the inbox read where a card says so; Undo makes it unread again and takes
  deleted mail out of the trash. *Mark as read* is also a column setting.
- The read notes whether you were in To or Cc and whether a message has an attachment (its MIME type),
  still no message bodies.

## v0.0.24 · 19 Oct 2026
- *Settings → Ask an AI*: download a brief of the cards you haven't placed for Claude, ChatGPT or any AI
  (senders, subjects, the newest email's first line; never your own addresses), and paste its answer
  back. Says what the file holds before you download it.
- A pasted answer or an imported review may also carry an AI read, or only that.
- `skills/labelboard`: a Claude skill that places cards from the brief through Claude's Gmail
  connector, and reads every thread with many Haiku readers and one Sonnet (`dev/ai-read.mjs`,
  `dev/mcp-page.mjs`). It never changes Gmail.

## v0.0.23 · 19 Oct 2026
- Security: a column colour from an imported settings file could carry script into the page. Colours now
  pass only as `#rrggbb`.
- The local preview answers a body that isn't JSON with an error instead of crashing.

## v0.0.22 · 19 Oct 2026
- After Apply, the count of changes Gmail doesn't have yet reaches 0. The board and Apply's backfill now
  place each thread by one rule: its card first, then every Gmail filter that matches, as Gmail runs them.
- Home's Apply line says when threads lose a label.
- The *After Apply* bar puts columns without a label (Unsorted, Keep in inbox) first, as Gmail does.

## v0.0.21 · 19 Oct 2026
- Fixes v0.0.20's blank page on Apps Script: a `//` comment on a `</script>` line made it read past the
  tag. The build now refuses one.

## v0.0.20 · 19 Oct 2026
- The board opens on a progress bar ("Opening your board…", "Still opening" after 8 s) instead of zeros.
  The header and toolbar wait for real numbers; a failed load stays in place with *Try again*.
- The first paint sets the numbers without counting up from 0.
- The theme is kept in the browser, so a dark board opens dark.

## v0.0.19 · 19 Oct 2026
- **Home**, the first tab and where Labelboard opens: the next step big (sort, apply, answer), the rest of
  what waits beside it, what came in since the read you saw last, and a door to each view.
- Settings → Look picks What now, Gallery or Labels, and which tab opens. The wordmark goes Home.
- Repo: `SECURITY.md`, README badges, tests on every push, and a release workflow that attaches a built
  `dist/` zip to each tag.

## v0.0.18 · 19 Oct 2026
- Settings redone: topics, processes, subject rules and columns are folded rows (name, the Gmail label it
  makes, a summary) that open one at a time, with a search past 6. Addresses, domains and phrases are chips.
- A gear in the header replaces the ⋯ menu. Theme, cards, import/export and *Remove everything* move into
  Settings, grouped as Sorting, You and More.

## v0.0.17 · 19 Oct 2026
- A process can take a folder (Settings → Processes), so deals land in `_M&A/Deals/<company>` with the
  investor preset.
- A contact filed under a sub-label of its own (Advisors) goes there when no topic is named, instead of
  Unsorted. Its Gmail rule still waits until you place it.

## v0.0.16 · 19 Oct 2026
- Under the board: Gmail now against after Apply, and the last move in numbers with Undo.
- Pull it up for a live flow (Gmail now → cards → after Apply) where you drag a card onto a column.

## v0.0.15 · 19 Oct 2026
- Every card says who placed it: You, Claude, Rule or Gmail. Claude's placements are marked and become
  yours when you keep or move them.
- Claude's review is a file you import; it never lands over a card you placed. `dev/review.mjs` lists the
  cards to review and merges a review.
- *Show* in the toolbar filters cards by who placed them.

## v0.0.14 · 17 Oct 2026
- Undo the last Apply, or remove everything Labelboard made. Both confirm in numbers first.
- Every Apply is recorded (threads, labels, filters, colours) before its first Gmail write. The header
  shows the last Apply and opens Review, which leads with what it did.
- Undo runs in slices and finishes where it stopped. Mail a new skip-inbox filter caught since comes back
  to the inbox with its label; filters you handed over are handed back.

## v0.0.13 · 17 Oct 2026
- The board and the Apply plan build 6 to 15 times faster on a 1,200-thread inbox. Cards, filters and
  the backfill stay the same.

## v0.0.12 · 17 Oct 2026
- Cards, columns and the rack say what Gmail already has sorted and what Apply still changes. Apply sends
  only those threads and reads again after.
- Filter terms are sorted, so an Apply no longer remakes its own filters.

## v0.0.11 · 17 Oct 2026
- Filter marks on cards and columns, and a *Filters* view: how each label got there, filter by filter.
- Column heads, the card drawer and Review say where each filter stands in Gmail. Labelboard's own
  filters show in the filters lane.
- Apply records when it made each filter. Filter matching is 3 times faster.

## v0.0.10 · 17 Oct 2026
- The board fits the screen: up to six columns share the width, *Add a column* is a rail, the filters
  lane starts folded.
- Triage, one card at a time, biggest first: 1–9 picks a column, Enter keeps the suggestion, S skips.
- A column can accept all its suggested cards at once. Reasons on cards are sentences.
- Errors say what stopped, what's safe and what to do. Numbers count the inbox, with archived mail as
  "+N archived".

## v0.0.9 · 16 Oct 2026
- Security pass: the one outside script (Sortable) loads with an integrity hash, and the local preview
  refuses requests from anywhere but your own browser.

## v0.0.8 · 16 Oct 2026
- Mail that skips the inbox shows on the board and in Flow. Every read also covers the last 30 days
  outside the inbox, so mail your filters archive is counted, and a column set to skip the inbox no
  longer empties itself after Apply.
- A made-up mailbox for the demo and the README screenshots (`dev/demo.mjs`).

## v0.0.7 · 16 Oct 2026
- Priorities gains 30-day read and reply numbers: answered share, answer times, threads waiting on you,
  sent and received totals.

## v0.0.6 · 16 Oct 2026
- Four views next to the board: Flow, Overview, All threads, Priorities.
- A README for people who don't know the project, and `docs/INSTALL.md` with every Google screen.

## v0.0.5 · 16 Oct 2026
- Fixed shell, foldable columns, a Settings panel, a first-run screen, theme and density, keyboard moves.

## v0.0.4 · 16 Oct 2026
- Design system: cards drawn as label tags, tokens in `docs/DESIGN.md`.

## v0.0.3 · 16 Oct 2026
- Re-reads fetch only threads that changed (Gmail's change log, or new mail since the last read when
  there's no log). The last read shows in the header.
- Your own Gmail filters show in their own lane. Adopt one to let Labelboard manage it; a Labelboard
  filter you changed in Gmail is flagged and left out of Apply.
- Moving a card takes off the labels Labelboard put on. Review in plain words, with a warning when the
  read is old.
- Renamed from mailboard to Labelboard.

## v0.0.2 · 15 Oct 2026
- An optional AI read of each thread can claim topics and move single emails.
- Apply resumes where it stopped.

## v0.0.1 · 15 Oct 2026
- First version: a drag-and-drop board of cards that becomes Gmail labels and filters, running as your
  own Apps Script. Basic and investor presets.
- Reads paced under Gmail's per-minute limit, with a progress bar. Apply creates the labels and filters
  and labels the mail already in the inbox.
