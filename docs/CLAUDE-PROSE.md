# Long-form rationale

Things too long for a code comment. Code points here with a one-line pointer.

## Why the first read doesn't use messages.get for single-message threads (Oct 2026)
`messages.get` costs 20 units against `threads.get`'s 40, and 864 of the 1,200 snapshot threads have
one message, so it looked like a 36% saving (~3 min) on a first read. It isn't safe:
- You only learn a thread's message count by fetching it. The cheap proxy is `messages.list` on INBOX
  (messages per thread), but a thread's other messages don't carry INBOX: your sent replies, and older
  messages archived before a new reply brought the thread back.
- Measured on the raw MCP pages behind the snapshot: 957 threads have exactly one INBOX message, and
  93 of those (10%) have more messages (45 with your reply, 48 with an archived earlier message). Their
  records would come out wrong (count, labels such as SENT, recipients of your reply, first sender)
  with no way to tell which ones.
- A message's historyId doesn't help either: the thread's last change can be its newest message even
  when older ones exist.
So the first read stays at threads.get, bound by the per-minute quota (1,200 threads ≈ 9 min). The
incremental re-read is where the time is won.

## Pacing: why a token bucket, and these numbers
The old fixed 150 ms sleep plus ~250 ms per call ran at ~100 units/s, right at Gmail's 6,000/min,
so reads hit "Quota exceeded" and sat in 5–15 s backoffs. The bucket refills 90 units/s (90% of the
limit) and allows a 400-unit burst; any 60 s window then spends at most 400 + 5,400 = 5,800. Its
state travels in the slice cursor, so a new slice doesn't start with a fresh burst, and the 1–2 s
between slices refills it, which is why slice length no longer costs throughput. Faster than ~5,400
units/min isn't possible per user: parallel calls and the HTTP batch endpoint spend the same units.

## Apply: why per label and why 5 threads
`messages.batchModify` costs 50 units for up to 1,000 message ids; `threads.modify` costs 10 per
thread. A batch only pays off from 5 threads up, so labels used by fewer threads go thread by thread
(all of a thread's small labels in one call). Grouping by identical label sets instead of per label
gave 143 groups and 3,890 units on the real snapshot; per label gives 169 calls and 3,510 units.
Archiving is one batch at the end, so a stopped run never leaves mail archived without its label.
Removing a label (re-sort) always goes thread by thread: earlier applies labelled whole threads, your
sent replies included, and those aren't in the INBOX list, so a batch would leave the old label on them.
Message ids come from `messages.list` on INBOX at apply time, so mail that arrived in a thread since
the read is labelled too, as `threads.modify` did. A thread with no inbox message any more (archived
or deleted since the read) goes through `threads.modify`, which labels it or skips it if deleted.

## Re-read: manual, not scheduled (decided Oct 2026)
Recommendation: keep it manual, offered when it matters (Review warns after an hour and offers a
re-read in place). Reasons:
- Gmail itself already sorts new mail with the filters; the snapshot only drives the board's counts
  and the backfill. Nobody needs it fresh while the board is closed.
- A re-read with little changed now takes seconds, so "read before you apply" costs nothing.
- A time-driven trigger runs unattended under the user's account, adds an installable-trigger step
  to setup, and eats a daily budget (triggers total runtime: 90 min/day on consumer accounts, 6 h on
  Workspace, per developers.google.com/apps-script/guides/services/quotas). A first read alone is ~9 min.
- Revisit if the board grows a "what changed since you last looked" view: that would need a stored
  older snapshot, and a nightly incremental read would be cheap (a few list calls + changed threads).

Update 21 Oct 2026: a trigger now exists, but only for *Archive it later* (`runLater`). It never reads
into the snapshot, and it exists only while a card asks for it. The reasons above still keep re-reads manual.

Update 28 Oct 2026: reversed, as an opt-in (Settings → *Runs on its own*), asked for by the user. What changed:
the trigger exists anyway for archiving later, so no new setup or scope; Home's *Since …* is the "what changed"
view this note waited for; and Gmail's change log runs out after about a week unopened, after which a read is
slower. A read every 6 hours is a few list calls plus the changed threads, well inside the trigger's daily time.
Applying on its own goes further only when the settings are the ones last applied, so it never ships an edit
you haven't reviewed; see `ARCHITECTURE.md` → On its own.

## Card actions: why a condition narrows the actions, not the card (Oct 2026)
The request behind it: one company in a column should skip the inbox, but only the mail that came
through the team address, not mail sent to you by name. Making the condition narrow the whole card
would drop the company's label from the rest of its mail, and splitting the card in two is the
"merge and split" item. So a card's label (and any "no") always applies, and its "yes" actions get a
second Gmail filter: the card's terms AND the condition. Gmail runs both; the label twice is harmless.
A "no" with a condition would need a negated condition in the label filter (`-( … )`), which Gmail's
parser handles poorly for compound terms, so noes stay unconditional.
Column defaults cover skip inbox and mark as read only; star, importance and delete are per card,
because a whole column that deletes mail is a footgun nobody asked for.

## GmailApp instead of the Gmail API? (research only, Oct 2026)
Question: could Apps Script's built-in GmailApp read the inbox much faster?
- **Scope: it rules itself out.** Every GmailApp method that reads (search, getThreadById,
  getMessagesForThreads, getUserLabels) requires `https://mail.google.com/` (GmailApp reference,
  developers.google.com/apps-script/reference/gmail/gmail-app). Google's scope list describes it as
  "Read, compose, send, and permanently delete all your email from Gmail"; Labelboard asks for
  gmail.modify ("Read, compose, and send emails from your Gmail account") plus gmail.settings.basic.
  The exact consent-screen wording for an Apps Script project is unverified (the scope list text is
  what the consent screen is built from, as far as known). It would also break "never opens bodies"
  in spirit: GmailMessage objects expose bodies, and whether they are fetched lazily is unverified.
- **Quota: a different meter.** Apps Script's own quota is "Email read/write (excluding send)":
  20,000/day consumer, 50,000/day Workspace (quotas page above). Unverified: what one "read" is
  (a thread, a message, or a call), and whether GmailApp also draws on the Gmail API's 6,000
  units/min. If each message counts, a 2,000-message inbox read is 10% of a consumer day.
- **Bulk calls:** `getMessagesForThreads(threads)` returns all messages of many threads in one call
  (documented). Whether that is one server round-trip or one quota count is unverified; community
  posts report "Service invoked too many times" errors at scale, no numbers.
- **Benchmark the user can run** (a separate throwaway Apps Script project, so Labelboard's scopes
  never widen): `var t0 = Date.now(), th = GmailApp.search('in:inbox', 0, 500);
  var ms = GmailApp.getMessagesForThreads(th); ms.forEach(function (m) { m.forEach(function (x) {
  x.getFrom(); x.getTo(); x.getCc(); x.getSubject(); x.getDate(); }); });
  Logger.log(th.length + ' threads, ' + (Date.now() - t0) + ' ms');` Run it 3 times; compare with
  Labelboard's first read for the same number of threads, and note any "too many times" error.
Conclusion: even if it is faster, it needs the broadest Gmail scope, which Labelboard promises not to
ask for. The incremental read gets the everyday case to seconds within the current scopes.
