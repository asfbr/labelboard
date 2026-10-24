# Install and first run

From nothing to a sorted inbox, Google's screens included. About 20 minutes, most of it the first read.
Labelboard runs as your own Apps Script: you are its only user, so nobody else (not even the author)
gets access to your mail.

You need: a Google account with Gmail, a computer with [Node.js](https://nodejs.org) 18 or later
(only to build and upload the script), and a browser.

## 1. Let command-line tools manage your Apps Script

Open <https://script.google.com/home/usersettings> and turn **Google Apps Script API** on.
Without it, uploading the script fails with *"User has not enabled the Apps Script API"*. It can take a
few minutes to take effect after you switch it on.

## 2. Build and upload

```sh
npm install -g @google/clasp      # Google's tool for Apps Script, once per computer
clasp login                       # opens a browser: sign in with the Gmail account you want to sort
git clone <this repo> labelboard && cd labelboard
npm run build                     # writes dist/
cd dist
clasp create --type webapp --title Labelboard --rootDir .
clasp push
clasp deploy -d "first version"   # prints a deployment id
```

`clasp login` is the first of two Google consent screens. It asks for your Apps Script projects, Drive
files and deployments: that is for clasp, the upload tool, not for Labelboard. Google may show each one
as a checkbox (*Select what clasp can access*): tick them all, or the upload fails later. You can remove
clasp's access at <https://myaccount.google.com/permissions> once you're done.

The board's address is `https://script.google.com/macros/s/<deployment id>/exec`. On a Google Workspace
account (your own domain) use `https://script.google.com/a/macros/<your-domain>/s/<deployment id>/exec`.
**Bookmark this `/exec` address**: it's the board, and it stays the same through every update. The
Apps Script editor also offers a `/dev` address; that one is only for testing code before you deploy it.

**No terminal?** Download `labelboard-<version>.zip` from the repo's latest release and unzip it: those
are the `dist/` files, already built. At <https://script.google.com> make a new project, open *Project
Settings* and tick *Show "appsscript.json"*, then create each file with the same name and paste its contents
(`Code.js`, `Sync.js`, `Presets.js`, `Baked.js`, `board.html` as an HTML file, `appsscript.json`).
Add the Gmail API under *Services*, then *Deploy → New deployment → Web app*, run as *User accessing
the web app*, access *Only myself*.

## 3. Open it and say yes to Google

1. Open the address **in a window signed in only to that account**. With several Google accounts in
   one browser, the plain address opens with your first one and says *"Sorry, unable to open the file
   at this time"*. A private window, a separate browser profile or the `/a/macros/<domain>/` address
   fixes it.
2. *Authorization required* → **Review permissions** → pick the account.
3. *"Google hasn't verified this app"*: expected. The app is the script you just uploaded and you are
   its developer; Google only verifies apps published to other people. Click **Advanced → Go to
   Labelboard (unsafe)**.
4. Google lists what it may do. Labelboard asks for exactly four permissions (Google's wording on
   that screen is broader than what the script does):
   - Your mail (`gmail.modify`): read the inbox (sender, recipients, subject, labels, dates, a short
     snippet, whether a message has an attachment; the same for the last 30 days of archived and sent
     mail, unless you turn that off), add labels, mark read and take threads out of the inbox. It never
     opens message bodies or sends mail, and deletes only what a card you set to *Delete it* catches.
     This is the narrowest Gmail permission that can put labels on mail.
   - Your mail settings (`gmail.settings.basic`): create the filters.
   - Run while you're not there (`script.scriptapp`, Google words it as managing triggers): one hourly
     check, only while a card is set to *Archive it later*. It is removed when none is.
   - Your email address: to tell your mail from mail sent to you.

   This is the second consent screen. If Google shows the permissions as checkboxes, **tick all four**
   (or *Select all*). With one left out, the board stops at its first read with a permission error; to
   fix it, remove Labelboard at <https://myaccount.google.com/permissions> and open the address again.
   An update that needs a new permission asks once more.

On a Workspace account, an admin can block Apps Script or unverified apps. Then the board can't run
there; the local preview (`node dev/serve.mjs`) plus *Download filters for Gmail import* still works.

## 4. First run

1. **Pick a preset**: *basic* (Clients, Calendar, Tools, Newsletters) or *investor*. You can switch
   later in *Settings → Import and export*.
2. **Read your mail.** The first read fetches every inbox thread and the last 30 days of mail outside
   the inbox, paced to stay under Gmail's per-minute quota: about 7 minutes per 1,000 threads. Leave
   the tab open. Later reads only fetch what changed and take seconds.

## 5. Sort, look, apply

1. **Board**: drag cards between columns. Each column is a Gmail label; its *Skip inbox* switch decides
   whether that mail leaves the inbox. The numbers at the top say how many threads stay.
2. **Flow, Filters, Overview, All threads, Priorities** (tabs above the board) show the same decisions
   from other angles: which rule sends what where, how the labels already on your mail got there, who
   fills the inbox, every thread at once, and what still waits on you. Clicking anything opens its
   card. The board and Flow also count the last 30 days of archived mail, so what skips your inbox
   shows; the bottom of Priorities has your reply numbers and the switch to stop reading it.
3. **Review changes** says in plain words what will happen. Nothing touches Gmail until **Apply labels
   and filters**. Afterwards the button reads *Gmail is up to date* until you change the board again.
4. Apply creates the labels, then the filters, then labels the threads already in your inbox. If it
   stops (closed tab, quota), run it again: every step is safe to repeat. Changed your mind? The header
   says when you last applied; Review then offers *Undo this Apply…*, which puts Gmail back as it was.
5. Check Gmail: the labels are in the left bar, the filters under *Settings → Filters and blocked
   addresses*. New mail now sorts itself, whether or not Labelboard is open.

## Updating

```sh
git pull && npm run build && cd dist && clasp push
clasp deployments                                  # find the id of your /exec deployment
clasp deploy -i <that id> -d "what changed"        # same address, new version
```

`clasp push` alone only updates the `/dev` test address; the `/exec` address you use moves with
`clasp deploy -i`.

## Removing it

- Gmail first: in Labelboard, the gear, *Import and export*, *Remove everything Labelboard made…*. It says what it will do
  before it does it: deletes Labelboard's filters (filters you adopted go back to you, unchanged), takes
  its labels off the mail it labelled, puts the mail it archived back in your inbox, and deletes its
  labels once they're empty. A label still holding mail you labelled yourself stays.
- By hand instead: Gmail *Settings → Filters and blocked addresses*, delete the ones you don't want.
  Labels stay until you delete them.
- The script: delete the project at <https://script.google.com>.
- Access: remove *Labelboard* (and *clasp*, if you're done with it) at <https://myaccount.google.com/permissions>.
