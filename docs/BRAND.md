# Brand

## Name: Labelboard
Says both halves of the product: a board that makes Gmail labels.
- Full form: **Labelboard for Gmail™**, with "Gmail is a trademark of Google LLC." in the README footer.
- Google's rules: no Google mark inside the product name, no combinations or hyphenations, no Google
  marks in domain names; "for Gmail" as a descriptor is the accepted form. Sources: [trademark guidelines](https://partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/),
  [Workspace branding terms](https://developers.google.com/workspace/marketplace/terms/branding).

## Mark
`brand/labelboard-mark.svg`: a tall stem plus a label tag reads "b" (board); the tag's hole is the
label. `brand/labelboard-mark-animated.svg`: an "L" picks up the tag and becomes "b", then lets go
(4.8 s loop, still under reduced motion).
- 32-unit grid with gaps of 2+ units, so it still resolves at 16 px.
- Colors: ink `#1d2230` / dark `#f1efe9`, accent violet `#6247d6` / dark `#a896ff`, the `--ink` and
  `--accent` tokens in `DESIGN.md`. In the board the mark is inline SVG filled from those tokens.
- Never: Google's "G", the Gmail envelope, or Google's red/blue/yellow/green set.

## Voice
1. **Say what happens to the mail, not how the machine does it.** "Label and skip inbox", not
   "Filter criteria: from:(@acme.com) → action: archive".
2. **One word per thing, and Gmail's word when Gmail has one.** "Skip inbox". Pick "conversations" or
   "threads" and use it everywhere (today the inbox bar and the toast disagree). A column is not a "Bucket".
3. **No engine words on screen.** "Everyone at a domain", "One sender", not "Topic in a process".
4. **State the promise where it matters, once, plainly. "You", never "we".** "It never opens message
   bodies." "Filters you made yourself are never touched."
5. **Confirmations say what happened, to what, how many.** "Inbox read: 1,204 threads", not "Applied".
6. **Errors say what stopped, what's safe, what to do.** "Reading stopped at 600 of 1,204 threads.
   Nothing in Gmail changed. Read again to continue." Never raw `e.message`.

## Tagline: "Drag your inbox into shape."
A tagline may say "for Gmail™", never "your Gmail" or a play on the word. Lines for subtitles and copy:
- A board of cards that becomes your labels and filters.
- Move a card, get a filter.
- Sort mail by what it's about, not who sent it.
- Labels and filters on a board, for Gmail™. Runs in your own account.
