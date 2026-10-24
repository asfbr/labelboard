# Contributing

Thanks for helping. Labelboard runs inside people's own Gmail, so a few rules here are promises to
every user, not style.

## Never put real mail anywhere
Not in an issue, a pull request, a test or a screenshot: no addresses, names, subjects, snippets,
snapshots or settings files with real contacts. Use made-up names on `.example` domains, or the demo
mailbox (`node dev/demo.mjs`). A security problem goes to *Security → Report a vulnerability*, never a
public issue (`SECURITY.md`).

## Set up
Node 20 or newer. There is nothing to install: no npm dependencies, no bundler.

```sh
npm test                                   # rule engine, sync, views, demo
node dev/demo.mjs ~/.labelboard-demo        # a made-up mailbox, outside the repo
node dev/serve.mjs ~/.labelboard-demo 8765  # the board on it at localhost:8765, no Gmail involved
```

To try it on your own Gmail, follow `docs/INSTALL.md` with your own Apps Script project.

## The promises a change must keep
- **Metadata only.** The server reads From, To, Cc, Subject, labels and the snippet, never message
  bodies. A change that widens a Gmail scope or what is read needs its own issue first.
- **Mail stays in the account.** Nothing is sent to an outside service. Outside scripts carry an
  integrity hash.
- **Mail text is hostile.** Anyone can email a user, and anyone can hand them a settings file. Every
  such value reaches the page through `h()`; colours only as `#rrggbb`.
- **Hands off filters Labelboard didn't make**, unless the user adopted them.
- **The web app runs as the user, for the user only** (`executeAs: USER_ACCESSING`, `access: MYSELF`).

Why each one exists: `docs/ARCHITECTURE.md` → Security.

## Code
- Rules live only in `src/rules.js`: pure JS with no DOM and no Apps Script calls, tested in Node.
- Match the existing style: `var`, function expressions, short comments. No new dependencies.
- A change to how mail is sorted should keep card keys and filter queries the same unless that is
  the point; say so in the pull request.
- Words on screen follow `docs/BRAND.md` → Voice; looks follow `docs/DESIGN.md`.

## Pull requests
Small and about one thing, with `npm test` passing and a line in `CHANGELOG.md` under
`## Unreleased` (add the heading if it isn't there). A UI change shows a screenshot from the demo mailbox. By contributing you agree your
work is released under the MIT license.
