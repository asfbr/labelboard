---
name: labelboard
description: Place cards on a Labelboard board (a drag-and-drop board that becomes Gmail labels and filters) and read each inbox thread with Claude through the Gmail connector. Use when the person asks to sort, review or place their Labelboard cards, do an "AI read" of their inbox, or hands you a labelboard-ai-brief.md.
---

# Labelboard with Claude

Labelboard runs in the person's own Google account. You never change their Gmail: you write a file,
they import it, and they decide on the board. Cards they placed are never overwritten (the import
enforces it). What you read (senders, subjects, snippets) reaches Claude; say so if they ask.

Needs: Gmail connected in Claude for anything past the brief. For step 2, a checkout of the
Labelboard repo and Node 20 (no install). Data lives in `~/.labelboard/`, never in the repo.

## 1. Place cards (start here)
1. Get the brief: on the board, *Settings → Ask an AI → Download the brief* (`labelboard-ai-brief.md`).
   On a local preview instead: `node dev/review.mjs list [dataDir]`.
2. Decide what senders, subjects and the newest line make clear. For an unclear card, open one or two
   of its `ids` with the Gmail connector's `get_thread`. Read metadata first; open bodies only if the
   person said you may.
3. Over about 60 cards: split the card lines into chunks of about 40 and give each chunk, with the
   brief's instructions and columns, to one agent with `model: haiku`, all spawned in one message. Each
   returns the answer JSON for its cards. Then one agent with `model: sonnet` merges them: one column per
   card, the same sub-label spelling for a company everywhere, weak picks dropped. Under 60 cards, do it
   yourself with no agents.
4. Write `claude-review.json` in the brief's answer format (`why`: one plain sentence the person reads on
   the card). They paste it into *Settings → Ask an AI → Paste the answer* or import the file; locally
   `node dev/review.mjs merge [dataDir] claude-review.json`. Tell them how many cards and the notable ones.

## 2. Read every thread (optional, deeper)
Cards place senders. A read decides each thread by what it is about (a lawyer writing about a client),
claims topics, and moves single emails already in the inbox when a confident read disagrees.
1. Their settings: *Settings → Import and export → Export settings*, saved as `~/.labelboard/config.json`
   (back up an older one first).
2. A snapshot through the Gmail connector: `search_threads` with `query: "in:inbox"`, `pageSize: 50`,
   minimal view. Claude Code saves each full page as a file; after each one run
   `node dev/mcp-page.mjs inbox <tool-results dir>`, which prints `NEXT <token>`, until it prints None.
   Page yourself: a subagent gets pages back inline and retypes them. Then `list_labels` →
   `~/.labelboard/labels.json` (`{ "<id>": "<name>" }`) and
   `node dev/ingest-mcp.mjs ~/.labelboard/raw/inbox ~/.labelboard/labels.json ~/.labelboard/snapshot.json <their address>`.
3. `node dev/ai-read.mjs prep` writes `~/.labelboard/ai-read/part-N.jsonl` (about 300 threads each) and
   `reference.md` (their columns, topics, processes, contacts).
4. One agent per part with `model: haiku`, all in one message, each given `ai-read.md` (next to this
   file), `reference.md` and its part; each writes `part-N.json`.
5. One agent with `model: sonnet` reads the low-confidence votes and the topic names not in the
   reference, writes corrections to `ai-read/fixes.json` (same objects, by id), and lists topics worth
   adding.
6. `node dev/ai-read.mjs merge` → `~/.labelboard/ai-read.json`. They import it (*Settings → Import*),
   or locally `node dev/review.mjs merge ~/.labelboard/ai-read.json`. Suggest the new topics; they add
   them under *Settings → Topics*.
Re-run 2–6 after a new snapshot: votes are per thread.

## Rules
- Never apply, label, archive or filter in Gmail yourself, even when the connector could. Review and
  Apply on the board are the person's.
- Haiku for the many readers, one Sonnet to reconcile. No other models unless the person asks.
- Mail data stays in `~/.labelboard/` and the conversation: never in the repo, an issue or a commit.
- Check a rule's count against Gmail before trusting it: `search_threads` with `in:inbox (<query>)`.
