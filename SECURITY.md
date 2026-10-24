# Security

Labelboard runs inside your own Google account with permission to change your mail, so a security bug
here matters. If you find one, report it privately.

## Reporting

Use **Report a vulnerability** on this repo's *Security* tab (GitHub's private reporting). Please don't
open a public issue for it. Say what an attacker needs (for example: only sending you an email), what
they get, and how to reproduce it.

Only the latest version is supported: fixes land on `main` and in the next release.

## What counts

- **Mail reaching the page as HTML or script.** Every field of a message (sender name, subject,
  snippet, label names) is written by whoever sent it. Anything that gets past `h()` into the page is a bug.
  The same goes for a settings, contacts or review file someone hands you to import.
- **Reading or changing more than the README says.** Opening message bodies, sending or deleting mail,
  or touching a filter Labelboard didn't make and wasn't handed with *Adopt*.
- **Anyone but you reaching your board or its data.** The web app runs as you and only for you
  (`executeAs: USER_ACCESSING`, `access: MYSELF`).
- **The local preview** (`dev/serve.mjs`) answering anything but your own browser on your own machine.
- **An outside script** loading without its integrity hash.

## What doesn't

- Deploying it to run as you for other people (`USER_DEPLOYING` with wider access), or sharing the
  script project with an editor. Both hand over your mailbox; that's how Apps Script works.
- Google's own screens, quotas and the "unverified app" warning.
- Files you export yourself (settings, contacts, snapshots) once they leave the board.

How the app is built to stay safe: [`docs/ARCHITECTURE.md` → Security](docs/ARCHITECTURE.md#security-reviewed-oct-2026).
