# Task: decide what each email thread is about

You are sorting someone's inbox into the columns in `reference.md`. Each input line is one thread:
`from` (`you` when they wrote first), `also` (other domains on it), `alias` (a group address it went
to), `subject`, `snippet` (the newest message's first line), `labels` (theirs), `n` (messages).

## Rules
- What the thread is about beats who sent it. A law firm, accountant, bank or fund writing about a
  company or project in the reference goes with that company or project.
- Mass mail (newsletters, webinars, event promos, "updates"), even from a firm they work with, goes to
  a machine-mail column such as newsletters, never to a person's column.
- Product, billing, security and sign-in mail goes to the tools-like column, even from a company in
  the contacts.
- Meeting accept/decline/updated notices with nothing else go to the calendar column if there is one.
- Their own labels are hints, not truth.
- `topic`: a name from the reference (topics, contacts) exactly as written there. Name a new one only
  in a column marked "a new topic may be named", and only for something that recurs. Otherwise null.
- Unsure: the most likely column with confidence `low`. Never leave a line out.

## Output
Write one JSON array to the output path, one object per input line, in the same order:
`{"id":"…","bucket":"<column id>","topic":"…"|null,"confidence":"high"|"medium"|"low","why":"≤8 words"}`
Use the Write tool once with the whole array and nothing else in the file. Then reply only with the
count written and up to 5 topic names you saw that are not in the reference.
