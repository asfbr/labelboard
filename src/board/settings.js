/* Settings panel, first run, import and export, columns that are gone. app.js hands the board in (B). */
window.LabelboardSettings = function (B) {
  'use strict';
  var S = B.S, R = B.R, $ = B.$, h = B.h, fmt = B.fmt, plural = B.plural;
  // The engine sorts into these itself (ARCHITECTURE.md, Settings and presets): rename them, never delete.
  var BUILTIN = ['unsorted', 'keep', 'calendar', 'tools', 'newsletters'];
  var SETUP = ['preset', 'patterns', 'processes', 'newsletterDomains', 'buckets']; // what a preset decides
  var GROUPS = [['Sorting', [['columns', 'Columns'], ['topics', 'Topics'], ['processes', 'Processes'], ['subjects', 'Subject rules'], ['groups', 'Group addresses']]],
    ['You', [['you', 'Your addresses'], ['labels', 'Your labels']]],
    ['More', [['auto', 'Runs on its own'], ['look', 'Look'], ['tuning', 'Fine-tuning'], ['ai', 'Ask an AI'], ['files', 'Import and export'], ['orphans', 'Columns that are gone']]]];
  var SECTIONS = [].concat.apply([], GROUPS.map(function (g) { return g[1]; }));
  var COUNT = { topics: 'topics', processes: 'processes', subjects: 'patterns', groups: 'aliases' }; // nav counts, from these config lists
  var ONE = { topics: 'topic', processes: 'process', subjects: 'subject rule' };
  // openIt: the one open row of a list ('topics:2'); find: the list's search text
  var cur = 'columns', openCol = null, openIt = null, find = '', delAsk = null, opener = null;
  var ICON = {
    chev: '<svg class="st-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    xs: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  var parse = function (s, loose) { return s.split(loose ? /[\n,;\s]+/ : /\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
  var lower = function (a) { return a.map(function (x) { return x.toLowerCase(); }); };
  var opt = function (v, label, sel) { return '<option value="' + h(v) + '"' + (v === sel ? ' selected' : '') + '>' + h(label) + '</option>'; };
  var at = function (sec, i, f) { return 'data-sec="' + sec + '"' + (i == null ? '' : ' data-i="' + i + '"') + ' data-f="' + f + '"'; };
  function columnSelect(attrs, sel, blank) {
    return '<select ' + attrs + '>' + (blank ? opt('', blank, sel || '') : '') + S.config.buckets.map(function (b) { return opt(b.id, b.name, sel); }).join('') + '</select>';
  }
  function input(sec, i, f, label, val, hint, ph) {
    return '<label class="field">' + label + '<input ' + at(sec, i, f) + ' value="' + h(val || '') + '"' + (ph ? ' placeholder="' + h(ph) + '"' : '') + '>' + (hint ? '<span class="hint-s">' + hint + '</span>' : '') + '</label>';
  }
  // A list as chips: Enter (or a comma or space where loose) adds, × or Backspace in the empty box removes, a pasted list splits.
  function chips(sec, i, f, label, list, hint, ph, loose) {
    return '<div class="field">' + label + '<div class="chips">' + (list || []).map(function (v) {
      return '<span class="chip-v" data-v="' + h(v) + '">' + h(v) + '<button type="button" data-act="chip-x" aria-label="Remove ' + h(v) + '">' + ICON.xs + '</button></span>';
    }).join('') + '<input class="chip-in" ' + at(sec, i, f) + (loose ? ' data-loose="1"' : '') + ' aria-label="' + h(label) + '" placeholder="' + h(ph || 'Add…') + '"></div>' +
      (hint ? '<span class="hint-s">' + hint + '</span>' : '') + '</div>';
  }
  function removeBtn(sec, i, what) { return '<button class="btn ghost icon" type="button" data-act="remove" data-sec="' + sec + '" data-i="' + i + '" aria-label="Remove ' + h(what) + '">' + ICON.x + '</button>'; }
  function addBtn(sec, label) { return '<button class="btn" type="button" data-act="add" data-sec="' + sec + '">' + label + '</button>'; }
  // One folded row (a column, a topic): name, the Gmail label it makes, a summary; it opens in place. body() runs only when open.
  function row(attrs, act, open, dot, name, label, summary, tools, body) {
    return '<li class="st-row' + (open ? ' open' : '') + '" ' + attrs + ' data-name="' + h(String(name).toLowerCase()) + '"><div class="st-row-head">' +
      '<button type="button" class="st-row-open" data-act="' + act + '" aria-expanded="' + open + '"><span class="dot" style="background:' + dot + '"></span>' +
      '<span class="st-row-name">' + h(name) + '</span>' + (label ? '<code class="st-row-label">' + h(label) + '</code>' : '') + '<span class="note">' + h(summary) + '</span>' + ICON.chev + '</button>' +
      (tools || '') + '</div>' + (open ? '<div class="st-edit">' + body() + '</div>' : '') + '</li>';
  }
  // A row of a settings list (topics, processes, subject rules), with Remove at the foot of its open form.
  function item(sec, i, b, name, label, bits, body) {
    var id = sec + ':' + i;
    return row('data-it="' + id + '"', 'it-open', openIt === id, (b && B.bandOf(b)) || 'var(--hatch)', name, label, bits.filter(Boolean).join(' · '), '', function () {
      return body() + '<div class="st-del"><button class="btn danger" type="button" data-act="remove" data-sec="' + sec + '" data-i="' + i + '">Remove this ' + ONE[sec] + '</button></div>';
    });
  }
  function list(sec, n, rows, add) {
    return (n > 6 ? '<input type="search" class="st-find" data-f="find" value="' + h(find) + '" placeholder="Find a ' + ONE[sec] + '" aria-label="Find a ' + ONE[sec] + '">' : '') +
      '<ol class="st-list">' + rows + '</ol>' + addBtn(sec, add);
  }
  var count = function (a, one, many) { return a && a.length ? plural(a.length, one, many) : null; };
  function labelOf(b, sub) { return b && b.label ? b.label + (sub ? '/' + sub : '') : 'No label'; }

  // ---------- sections ----------
  function columnsHtml() {
    return '<p class="note">Each column with a label becomes a Gmail label and its filters. Reorder here, or drag a column by its heading on the board.</p><ol class="st-list">' +
      S.config.buckets.map(function (b, i, all) {
        var flags = [b.label ? B.leavesWords(R.leavesOf(b)) : 'No label, no filter', b.label && b.read && 'marks read', b.subLabels && 'sub-labels', b.topics && 'topics', b.automated && 'machine mail'].filter(Boolean).join(' · ');
        var tools = '<button type="button" class="btn ghost icon" data-act="col-up" aria-label="Move ' + h(b.name) + ' left"' + (i ? '' : ' disabled') + '>' + ICON.up + '</button>' +
          '<button type="button" class="btn ghost icon" data-act="col-down" aria-label="Move ' + h(b.name) + ' right"' + (i < all.length - 1 ? '' : ' disabled') + '>' + ICON.down + '</button>';
        return row('data-col="' + h(b.id) + '"', 'col-open', openCol === b.id, B.bandOf(b) || 'var(--hatch)', b.name, b.label, flags, tools, function () { return colEdit(b); });
      }).join('') + '</ol>' + '<button class="btn" type="button" data-act="col-add">Add a column</button>';
  }
  function colEdit(b) {
    var sw = function (k, label) { return '<label class="st-check"><input type="checkbox" ' + at('col', null, k) + (b[k] ? ' checked' : '') + '><span>' + label + '</span></label>'; };
    var html = input('col', null, 'name', 'Name', b.name) + input('col', null, 'description', 'What goes here', b.description);
    if (b.label) {
      html += input('col', null, 'label', 'Gmail label', b.label, 'A new name makes a new label on the next Apply. The old one stays in Gmail.') +
        '<div class="field">Label color<div class="palette" role="group" aria-label="Label color">' + B.PALETTE.map(function (c) {
          return '<button type="button" data-act="color" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '" aria-pressed="' + (c === B.bandOf(b)) + '"></button>';
        }).join('') + '</div></div>' +
        '<label class="field">When mail here leaves the inbox' + B.leavesSelect(at('col', null, 'leaves'), R.leavesOf(b)) + '</label>' +
        '<p class="note">Right away is Gmail\'s own skip-inbox filter. A later time is Labelboard\'s hourly check, which archives only mail its filter labelled, and leaves a thread alone while it has a newer or unread message.</p>' +
        sw('read', 'Mark as read: mail here arrives read') +
        '<p class="note">A card can do otherwise, and star, flag or delete its mail too: open the card.</p>' + sw('subLabels', 'A sub-label per card (a client, a project)') +
        sw('topics', 'Contacts filed here are what mail is about (a client, a project), not someone helping with it') +
        sw('newTopics', 'An AI read may start new topics here') +
        sw('automated', 'Machine mail: notifications and receipts filed here stay here even when a contact is copied');
    }
    if (BUILTIN.indexOf(b.id) >= 0) return html + '<p class="note">Labelboard sorts mail into this column itself, so it can\'t be deleted. Rename it or change its label instead.</p>';
    if (delAsk !== b.id) return html + '<div class="st-del"><button class="btn danger" type="button" data-act="col-del">Delete this column</button></div>';
    return html + '<div class="st-del warn"><p>Its cards and everything that names it go to</p>' + columnSelect('id="st-del-to" aria-label="Where its cards go"', 'unsorted') +
      '<div class="plan-actions"><button class="btn danger" type="button" data-act="col-del-ok">Delete ' + h(b.name) + '</button><button class="btn" type="button" data-act="col-del-no">Keep it</button></div></div>';
  }
  function youHtml() {
    return chips('you', null, 'me', 'Your addresses', S.config.me, 'Mail from these is yours.', 'you@example.com', true) +
      chips('you', null, 'firmDomains', 'Your colleagues\' domains', S.config.firmDomains, 'Mail from these domains is from colleagues: it stays in the inbox unless something else claims it. Leave it empty for a gmail.com address.', 'yourcompany.com', true);
  }
  function groupsHtml() {
    var ab = S.config.aliasBuckets || {};
    return '<p class="note">Addresses that reach several people, like team@ or deals@. Mail sent to one becomes a card of its own.</p><div class="st-rows">' +
      (S.config.aliases || []).map(function (a, i) {
        return '<div class="st-line"><input ' + at('groups', i, 'address') + ' value="' + h(a) + '" placeholder="team@yourcompany.com" aria-label="Group address">' +
          columnSelect(at('groups', i, 'bucket') + ' aria-label="Column for ' + h(a || 'this address') + '"', ab[a] || '', 'Let the board suggest') + removeBtn('groups', i, a) + '</div>';
      }).join('') + '</div>' + addBtn('groups', 'Add a group address');
  }
  function subjectsHtml() {
    var ps = S.config.patterns || [];
    return '<p class="note">Mail whose subject has one of these words or phrases becomes one card, like calendar replies or "[Invoice]".</p>' +
      list('subjects', ps.length, ps.map(function (p, i) {
        var b = p.bucket && B.bucket(p.bucket);
        return item('subjects', i, b, p.title, b ? labelOf(b) : 'The board suggests', [count(p.subjects, 'phrase'), threadsOf('pattern:' + p.key)], function () {
          return input('subjects', i, 'title', 'Card name', p.title) +
            '<label class="field">Column' + columnSelect(at('subjects', i, 'bucket'), p.bucket || '', 'Let the board suggest') + '</label>' +
            chips('subjects', i, 'subjects', 'Subject words or phrases', p.subjects, 'Whole words, any case. Enter adds one.', 'Accepted:');
        });
      }).join(''), 'Add a subject rule');
  }
  function topicsHtml() {
    var ts = S.config.topics || [];
    return '<p class="note">What mail is about: a client, a project, a deal. Mail that names a topic or comes from its people gets the topic\'s card, ahead of who sent it. A contacts file adds more.</p>' +
      list('topics', ts.length, ts.map(function (t, i) {
        var b = B.bucket(t.bucket);
        return item('topics', i, b, t.name, labelOf(b, b && b.subLabels ? t.sublabel : null), [count(t.subjects, 'subject name'), count(t.domains, 'domain'), count(t.emails, 'address', 'addresses'), threadsOf('entity:' + t.bucket + ':' + t.name)], function () {
          return input('topics', i, 'name', 'Name', t.name) +
            '<div class="st-pair"><label class="field">Column' + columnSelect(at('topics', i, 'bucket'), t.bucket) + '</label>' + input('topics', i, 'sublabel', 'Sub-label', t.sublabel, 'Inside a folder: Deals/Acme', 'Acme') + '</div>' +
            chips('topics', i, 'subjects', 'Named in subjects as', t.subjects, null, 'Project Falcon') +
            '<div class="st-pair">' + chips('topics', i, 'domains', 'Their domains', t.domains, null, 'acme.com', true) + chips('topics', i, 'emails', 'Their addresses', t.emails, null, 'ceo@gmail.com', true) + '</div>';
        });
      }).join(''), 'Add a topic');
  }
  function processesHtml() {
    var topical = S.config.buckets.filter(function (b) { return b.topics; }), ps = S.config.processes || [];
    return '<p class="note">Something a topic goes through, like a sale. Once a signal word shows up in a subject, that topic\'s mail goes to the process column.</p>' +
      list('processes', ps.length, ps.map(function (p, i) {
        var b = B.bucket(p.bucket), from = (p.from || []).map(function (id) { var x = B.bucket(id); return x ? x.name : null; }).filter(Boolean);
        return item('processes', i, b, p.title, labelOf(b, (p.folder ? p.folder + '/' : '') + '‹topic›'), [count(p.words, 'signal word'), from.length && 'from ' + from.join(', ')], function () {
          return input('processes', i, 'title', 'Name', p.title, null, 'sale process') +
            '<div class="st-pair"><label class="field">Its column' + columnSelect(at('processes', i, 'bucket'), p.bucket) + '</label>' +
            input('processes', i, 'folder', 'Folder', p.folder, 'Each topic gets its label inside it. Leave empty to put them straight under the column.', 'Deals') + '</div>' +
            chips('processes', i, 'words', 'Signal words', p.words, 'As they appear in subjects. Enter adds one.', 'NBO') +
            '<fieldset class="field st-from"><legend>Topics it can start from</legend>' + (topical.length ? topical.map(function (x) {
              return '<label class="st-check"><input type="checkbox" ' + at('processes', i, 'from') + ' value="' + h(x.id) + '"' + ((p.from || []).indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + h(x.name) + '</span></label>';
            }).join('') : '<span class="hint-s">No column holds topics yet: tick "Contacts filed here are what mail is about" on one under Columns.</span>') + '</fieldset>';
        });
      }).join(''), 'Add a process');
  }
  // threads on the board for a card key, as a summary bit
  function threadsOf(key) { var c = S.built && S.built.cards.filter(function (x) { return x.key === key; })[0]; return c && c.threads.length ? plural(c.threads.length, 'thread') : null; }
  function tuningHtml() {
    return chips('tuning', null, 'newsletterDomains', 'Newsletter domains', S.config.newsletterDomains, 'Mail from these goes to Newsletters.', 'news.example.com', true) +
      chips('tuning', null, 'sharedDomains', 'Domains many unrelated people share', S.config.sharedDomains, 'Cards go per sender there, not per domain (a mail service, a big platform).', 'gmail.com', true) +
      chips('tuning', null, 'subjectStopNames', 'Words that look like a topic in subjects but aren\'t', S.config.subjectStopNames, 'A topic named like a common word gets mail it shouldn\'t: add the word here.', 'Board');
  }
  function lookHtml() {
    var u = B.ui(), FIRST = { theme: 'system', density: 'roomy', home: 'now', open: 'home' }, pick = function (k, v, label) {
      return '<button type="button" class="st-pick" data-act="look" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + ((u[k] || FIRST[k]) === v) + '">' + label + '</button>';
    };
    return '<div class="field">Theme<div class="st-picks" role="group" aria-label="Theme">' + pick('theme', 'system', 'Like my system') + pick('theme', 'light', 'Light') + pick('theme', 'dark', 'Dark') + '</div></div>' +
      '<div class="field">Cards<div class="st-picks" role="group" aria-label="Cards">' + pick('density', 'roomy', 'Roomy') + pick('density', 'compact', 'Compact') + '</div>' +
      '<span class="hint-s">Compact cards keep the title, count and sub-label.</span></div>' +
      '<div class="field">Home<div class="st-picks" role="group" aria-label="Home">' + pick('home', 'now', 'What now') + pick('home', 'gallery', 'Gallery') + pick('home', 'tags', 'Labels') + '</div>' +
      '<span class="hint-s">What now puts the next step first. Gallery shows a tile per view, Labels a tag per column.</span></div>' +
      '<div class="field">Labelboard opens on<div class="st-picks" role="group" aria-label="Labelboard opens on">' + pick('open', 'home', 'Home') + pick('open', 'board', 'The board') + pick('open', 'last', 'Where I left off') + '</div></div>';
  }
  // Labels you already use vote for a column. A column's own label always counts; map the rest here
  // (config.labelMap, by top-level label; null switches a column's own label off).
  function labelsHtml() {
    var sys = /^(INBOX|UNREAD|IMPORTANT|STARRED|SENT|DRAFT|TRASH|SPAM|CHAT|CATEGORY_)/, counts = {}, map = R.labelMapOf(S.config), own = ownLabels();
    S.snapshot.threads.forEach(function (t) {
      var seen = {};
      t.labels.forEach(function (l) { var top = l.split('/')[0]; if (!sys.test(l) && !seen[top]) { seen[top] = 1; counts[top] = (counts[top] || 0) + 1; } });
    });
    Object.keys(map).forEach(function (k) { if (!(k in counts)) counts[k] = 0; });
    var rows = Object.keys(counts).sort(function (x, z) { return counts[z] - counts[x] || x.localeCompare(z); });
    return '<p class="note">Mail you already labelled helps place cards: a card whose threads mostly carry a label goes to that label\'s column. Each column\'s own label counts by itself; pick a column for the others. ' +
      'To fold one of these labels into a column, or hand it to the board, open the Gmail tab.</p>' +
      (rows.length ? '<table class="plan-table"><thead><tr><th>Label</th><th>Inbox threads</th><th>Counts toward</th></tr></thead><tbody>' + rows.map(function (l) {
        return '<tr><td>' + h(l) + (own[l] ? ' <span class="note">(a column\'s label)</span>' : '') + '</td><td class="n">' + fmt(counts[l]) + '</td><td>' +
          columnSelect('data-labelmap="' + h(l) + '" aria-label="Column for ' + h(l) + '"', map[l] || '', 'Nothing') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty">No labels on your inbox threads yet.</p>');
  }
  function ownLabels() { var own = {}; S.config.buckets.forEach(function (b) { if (b.label) own[b.label] = b.id; }); return own; }
  function filesHtml() {
    var votes = Object.keys(S.config.threadVotes || {}).length, P = window.LabelboardPresets || {}, cl = claudeKeys().length;
    return '<h3 class="rv-h">Start from a preset</h3><p class="note">A preset sets the columns, subject rules and processes. Who you are, your topics and the cards you placed stay.</p>' +
      '<div class="presets">' + Object.keys(P).map(function (k) { return presetHtml(k, P[k], S.config.preset === k); }).join('') + '</div>' +
      '<h3 class="rv-h">Import a file</h3><p class="note">One button for four kinds of file:</p><ul class="rv-list">' +
      '<li><b>A review from Claude</b>: cards Claude placed, marked <i>Claude</i> on the board until you keep or move them. Cards you placed stay as they are (' + plural(cl, 'card') + ' from Claude now)' + (cl ? ' <button type="button" class="linkish" data-act="claude-clear">Send them back to the suggestions</button>' : '') + '.</li>' +
      '<li><b>Contacts</b>: a list of who is who (' + plural(S.seeds.length, 'contact') + ' now)' + (B.API.saveSeeds ? '' : '. In the preview, put contacts files in the data folder\'s seed folder instead') + '.</li>' +
      '<li><b>An AI read</b>: where an AI would file each thread (' + plural(votes, 'thread') + ' read now)' + (votes ? ' <button type="button" class="linkish" data-act="votes-clear">Clear it</button>' : '') + '.</li>' +
      '<li><b>Settings</b>: a preset or a file exported here. It replaces what it names and keeps the rest.</li></ul>' +
      '<div class="plan-actions"><button class="btn" type="button" data-act="import">Import a file…</button></div>' +
      '<h3 class="rv-h">Export</h3><p class="note">Everything on this page plus where you placed each card, as one file you can import on another account, keep as a backup, or hand to Claude so its review starts from your choices.</p>' +
      '<div class="plan-actions"><button class="btn" type="button" data-act="export">Export settings</button></div>' +
      (S.canUndo && S.snapshot.threads.length ? '<h3 class="rv-h">Start over</h3><p class="note">Takes every label and filter Labelboard made out of Gmail and hands back filters you adopted. You see what goes back before anything changes.</p>' +
        '<div class="plan-actions"><button class="btn danger" type="button" data-act="remove-all">Remove everything Labelboard made…</button></div>' : '');
  }
  // The AI brief: one file for whichever AI you pick, and its answer pasted back (a review, as importFile takes it).
  function aiBrief() { return R.reviewBrief(S.mail, S.built, S.config, false); }
  // What runs while you're away: Gmail's filters, archiving later, and, if you switch them on, reading and applying.
  function autoHtml() {
    var a = S.config.auto || {}, g = S.gmail || {}, later = (g.later && g.later.rules || []).length, log = g.auto, ago = function (t) { var m = Math.round((Date.now() - t) / 60000); return m < 90 ? plural(Math.max(1, m), 'minute') + ' ago' : m < 2880 ? plural(Math.round(m / 60), 'hour') + ' ago' : plural(Math.round(m / 1440), 'day') + ' ago'; };
    var sw = function (k, label, off) { return '<label class="st-check"><input type="checkbox" ' + at('auto', null, k) + (a[k] ? ' checked' : '') + (off ? ' disabled' : '') + '><span>' + label + '</span></label>'; };
    var last = !log ? '' : log.error ? 'The last run ' + ago(log.at) + ' stopped: ' + log.error : 'Last run ' + ago(log.at) + ': ' + (log.read === 'unfinished' ? 'the read didn\'t finish in time; the next one starts over' : 'read ' + plural(log.read && log.read.fetched || 0, 'new or changed thread')) +
      (!log.apply ? '' : log.apply.applied ? '; applied ' + log.apply.applied : log.apply.nothing ? '; nothing new to apply' : log.apply.waits === 'settings' ? '; nothing applied: you have changes to review first' : log.apply.waits === 'time' ? '; nothing applied: no time left in that hour, the next read tries again' : '; nothing applied: the last Apply stopped, finish it in Review') + '.';
    return '<p class="note">Always, board open or not: Gmail runs your filters on new mail' + (later ? ', and Labelboard checks your inbox every hour for mail that leaves it later (' + plural(later, 'column or card', 'columns and cards') + ')' : '') + '.</p>' +
      sw('read', 'Read what changed every 6 hours: the same metadata as <i>Read mail again</i>, never bodies, and nothing changes in Gmail. Never a first read.') +
      sw('apply', 'Then apply what the rules placed on their own: filters for new senders a rule put in a column, and labels on new inbox mail. Only when nothing of yours waits for Review (your settings are the ones you last applied). It never moves or takes off a label and never touches yours; each run is an Apply you can undo in Review.', !a.read) +
      (last ? '<p class="note">' + h(last) + '</p>' : '') +
      (S.mode === 'apps-script' ? '' : '<p class="note">This runs only in your Apps Script, not in this preview.</p>');
  }
  function aiHtml() {
    var b = aiBrief(), n = b.cards.reduce(function (m, c) { return m + c.threads; }, 0);
    return '<h3 class="rv-h">1. Download the brief</h3><p class="note">Labelboard never sends your mail anywhere. This makes one file you paste into ' +
      'Claude, ChatGPT or any AI you trust. Its answer comes back here and places cards, ringed with the <i>Claude</i> pill until you keep or move them. Cards you placed stay as they are.</p>' +
      (b.cards.length ? '<p>The file holds the <b>' + plural(b.cards.length, 'card') + '</b> you haven\'t placed, covering ' + plural(n, 'thread') + ': for each, up to 3 senders, ' +
        '3 subjects and the first line of its newest email, plus your column names. Not your own addresses, not message bodies.</p>' +
        '<div class="plan-actions"><button class="btn" type="button" data-act="ai-brief">Download the brief</button></div>'
        : '<p class="empty">You placed every card yourself, so there is nothing to ask.</p>') +
      '<h3 class="rv-h">2. Paste the answer</h3><p class="note">The AI replies with a block of JSON. Paste all of it, or import it as a file under <i>Import and export</i>.</p>' +
      '<textarea id="st-ai-answer" class="st-paste" rows="6" spellcheck="false" aria-label="The AI\'s answer" placeholder="{ &quot;labelboard&quot;: &quot;claude-review&quot;, &quot;cards&quot;: { … } }"></textarea>' +
      '<div class="plan-actions"><button class="btn primary" type="button" data-act="ai-use">Use this answer</button></div>' +
      '<p class="note">With Claude Code, the Labelboard skill (<code>skills/labelboard</code> in the repo) reads your mail through Claude\'s Gmail connector and writes the same answer.</p>';
  }
  function downloadBrief() {
    var b = aiBrief(), blob = new Blob([R.briefText(b)], { type: 'text/markdown' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'labelboard-ai-brief.md'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    B.toast('Brief downloaded: labelboard-ai-brief.md, ' + plural(b.cards.length, 'card') + '. Paste it into the AI you trust, then paste its answer here.', 8000);
  }
  function presetHtml(k, p, on) {
    var cols = p.buckets.filter(function (b) { return b.label; });
    return '<button type="button" class="preset" data-act="preset" aria-pressed="' + on + '" data-preset="' + h(k) + '"><span class="preset-name">' + h(k.charAt(0).toUpperCase() + k.slice(1)) + '</span>' +
      '<span class="preset-cols">' + cols.map(function (b) { return B.labelChip({ label: b.name, color: b.color }); }).join(' ') + '</span></button>';
  }
  function orphansHtml() {
    var lost = R.orphans(S.config, S.built, S.seeds);
    if (!lost.length) return '<p class="note">Every card and setting names a column this board has.</p>';
    var WHAT = { cards: 'placed card', threadOverrides: 'moved thread', threadVotes: 'AI read', aliasBuckets: 'group address', labelMap: 'label', topics: 'topic', patterns: 'subject rule', processes: 'process', 'processes.from': 'process start' };
    return '<p class="note">These column ids are named by your cards, settings or contacts, but the board has no such column, so their cards wait in Unsorted. Pick where each one goes.</p>' +
      '<table class="plan-table"><thead><tr><th>Gone</th><th>Named by</th><th>Goes to</th></tr></thead><tbody>' + lost.map(function (o) {
        var by = (o.cards ? [plural(o.cards, 'card') + ' waiting'] : []).concat(Object.keys(o.refs).map(function (k) { return plural(o.refs[k], WHAT[k], /s$/.test(WHAT[k]) ? WHAT[k] + 'es' : null); }), o.seeds ? [plural(o.seeds, 'contact')] : []);
        return '<tr><td><b>' + h(o.id) + '</b></td><td>' + h(by.join(', ')) + '</td><td>' + columnSelect('data-orphan="' + h(o.id) + '" aria-label="Where ' + h(o.id) + ' goes"', guess(o.id)) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (!B.API.saveSeeds && lost.some(function (o) { return o.seeds; }) ? '<p class="note">Contacts files in the preview\'s seed folder keep their old column: edit them there.</p>' : '') +
      '<div class="plan-actions"><button class="btn primary" type="button" data-act="orphans-ok">Move them</button></div>';
  }
  // a gone id that reads like a column here (portfolio → Portfolio, a label without its underscore), else Unsorted
  function guess(id) {
    var n = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    var b = S.config.buckets.filter(function (x) { return [x.name, x.label || ''].some(function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') === n; }); })[0];
    return b ? b.id : 'unsorted';
  }
  var DRAW = { columns: columnsHtml, you: youHtml, groups: groupsHtml, subjects: subjectsHtml, topics: topicsHtml, processes: processesHtml, tuning: tuningHtml, look: lookHtml, auto: autoHtml, labels: labelsHtml, ai: aiHtml, files: filesHtml, orphans: orphansHtml };

  // ---------- drawing: keeps focus and scroll across a redraw, so Tab still lands on the next field ----------
  function keyOf(el) {
    if (!el || !$('st-body').contains(el)) return null;
    var row = el.closest('[data-col]');
    return [row && row.dataset.col, el.dataset.sec, el.dataset.i, el.dataset.f, el.dataset.act, el.dataset.v, el.dataset.labelmap, el.dataset.orphan, el.value && el.type === 'checkbox' ? el.value : ''].join('|');
  }
  function draw() {
    var lost = R.orphans(S.config, S.built, S.seeds).length;
    if (cur === 'orphans' && !lost && !$('st-body').querySelector('[data-act="orphans-ok"]')) cur = 'columns';
    $('st-nav').innerHTML = GROUPS.map(function (g) {
      return '<div class="st-nav-g"><span class="st-nav-h">' + g[0] + '</span>' + g[1].filter(function (s) { return s[0] !== 'orphans' || lost || cur === 'orphans'; }).map(function (s) {
        var n = COUNT[s[0]] && (S.config[COUNT[s[0]]] || []).length;
        return '<button type="button" data-nav="' + s[0] + '"' + (s[0] === cur ? ' aria-current="page"' : '') + (s[0] === 'orphans' ? ' class="st-warn"' : '') + '>' + s[1] + (n ? '<span class="st-nav-n">' + n + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('');
    var body = $('st-body'), top = body.scrollTop, key = keyOf(document.activeElement);
    body.innerHTML = '<h3 class="st-h">' + SECTIONS.filter(function (s) { return s[0] === cur; })[0][1] + '</h3>' + DRAW[cur]();
    body.scrollTop = top; filter();
    if (key) Array.prototype.some.call(body.querySelectorAll('input,select,textarea,button'), function (el) { if (keyOf(el) === key) { el.focus(); return true; } });
  }
  // the list's search: hides rows whose name doesn't have it; an open row always shows
  function filter() {
    var q = find.trim().toLowerCase();
    $('st-body').querySelectorAll('.st-list [data-it]').forEach(function (r) { r.hidden = !!q && r.dataset.name.indexOf(q) < 0 && !r.classList.contains('open'); });
  }
  // A chip list goes through its section's own setter, as one item per line, so it's cleaned up the same way.
  function chipList(inp) { return Array.prototype.map.call(inp.parentNode.querySelectorAll('.chip-v'), function (c) { return c.dataset.v; }); }
  function putChips(inp, vals) { var d = inp.dataset; SET[d.sec]({ value: vals.join('\n') }, d.f, d.i == null ? null : +d.i); }
  function addChips(inp, text) {
    var loose = !!inp.dataset.loose, have = chipList(inp), seen = have.map(function (v) { return loose ? v.toLowerCase() : v; });
    var add = parse(text, loose).filter(function (v) { var k = loose ? v.toLowerCase() : v; if (seen.indexOf(k) >= 0) return false; seen.push(k); return true; });
    inp.value = ''; if (add.length) putChips(inp, have.concat(add));
  }
  // A settings change re-sorts the board at once; the panel redraws after the browser has moved focus.
  function changed(msg) { B.rebuild(); B.render(); B.save(); setTimeout(draw, 0); if (msg) B.toast(msg); }

  function open(section, colId) {
    if (!S.config) return;
    if ($('settings').hidden) opener = document.activeElement;
    var to = DRAW[section] ? section : section ? 'columns' : cur; // no section: where you left off
    if (to !== cur) { openIt = null; find = ''; }
    cur = to;
    if (colId) openCol = colId;
    $('drawer').classList.remove('open');
    $('settings').hidden = false; draw();
    var target = colId && $('st-body').querySelector('[data-col="' + CSS.escape(colId) + '"] .st-col-open');
    (target || $('st-nav').querySelector('[aria-current]')).focus();
    if (target) target.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    if ($('settings').hidden) return;
    $('settings').hidden = true; delAsk = null;
    var a = S.config.aliases; // a group address row left empty is dropped
    if (a && a.some(function (x) { return !x; })) { S.config.aliases = a.filter(Boolean); changed(); }
    if (opener && document.body.contains(opener)) opener.focus();
  }

  // ---------- edits ----------
  function bucketOf(el) { var row = el.closest('[data-col]'); return row && B.bucket(row.dataset.col); }
  function topicKeys(t) { return ['entity:' + t.bucket + ':' + t.name, 'process:' + t.name]; }
  var SET = {
    col: function (el, f) {
      var b = bucketOf(el), v = el.value.trim();
      if (el.type === 'checkbox') { b[f] = el.checked; return changed(); }
      if (f === 'leaves') { R.setLeaves(b, el.value); return changed(); }
      if (f === 'label') {
        if (!v) return draw();
        var other = S.config.buckets.filter(function (x) { return x !== b && x.label === v; })[0];
        if (other) { B.toast(other.name + ' already uses the label ' + v + '. Pick another.'); return draw(); }
      }
      if (f === 'description') b.description = v; else if (v) b[f] = v;
      changed();
    },
    auto: function (el, f) {
      var a = S.config.auto = S.config.auto || {}; a[f] = el.checked; if (!a.read) a.apply = false;
      changed(f === 'read' ? (el.checked ? 'Labelboard reads what changed every 6 hours.' : 'Reading on its own is off.') : el.checked ? 'After a read on its own, Labelboard applies what the rules placed.' : 'Applying on its own is off.');
    },
    you: function (el, f) { S.config[f] = lower(parse(el.value, true)); changed(); },
    tuning: function (el, f) { S.config[f] = f === 'subjectStopNames' ? parse(el.value) : lower(parse(el.value, true)); changed(); },
    groups: function (el, f, i) {
      var list = S.config.aliases, ab = S.config.aliasBuckets = S.config.aliasBuckets || {}, old = list[i];
      if (f === 'bucket') { if (el.value) ab[old] = el.value; else delete ab[old]; return changed(); }
      var v = el.value.trim().toLowerCase();
      if (v && list.some(function (x, j) { return j !== i && x === v; })) { B.toast(v + ' is already on the list'); return draw(); }
      list[i] = v; if (ab[old]) { if (v) ab[v] = ab[old]; delete ab[old]; }
      changed();
    },
    subjects: function (el, f, i) {
      var p = S.config.patterns[i];
      if (f === 'subjects') p.subjects = parse(el.value); else if (f === 'bucket') p.bucket = el.value || null; else p.title = el.value.trim() || p.title;
      changed();
    },
    topics: function (el, f, i) {
      var t = S.config.topics[i], was = topicKeys(t);
      if (f === 'subjects') t.subjects = parse(el.value);
      else if (f === 'domains' || f === 'emails') t[f] = lower(parse(el.value, true));
      else if (f === 'sublabel') t.sublabel = el.value.trim() || null;
      else if (el.value.trim()) t[f] = el.value.trim();
      // a renamed or moved topic keeps where you placed its card
      topicKeys(t).forEach(function (k, j) { if (k !== was[j] && S.config.cards[was[j]]) { S.config.cards[k] = S.config.cards[was[j]]; delete S.config.cards[was[j]]; } });
      changed();
    },
    processes: function (el, f, i) {
      var p = S.config.processes[i];
      if (f === 'words') p.words = parse(el.value);
      else if (f === 'from') p.from = Array.prototype.filter.call($('st-body').querySelectorAll('[data-sec="processes"][data-i="' + i + '"][data-f="from"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
      else if (f === 'folder') { var fo = el.value.replace(/^[\s\/]+|[\s\/]+$/g, ''); if (fo) p.folder = fo; else delete p.folder; }
      else if (el.value.trim()) p[f] = el.value.trim();
      changed();
    },
  };
  function firstOf(flag) { var b = S.config.buckets.filter(function (x) { return x[flag]; })[0] || S.config.buckets.filter(function (x) { return x.label; })[0]; return b ? b.id : 'unsorted'; }
  var ADD = {
    groups: function () { (S.config.aliases = S.config.aliases || []).push(''); },
    subjects: function () { (S.config.patterns = S.config.patterns || []).push({ key: 'p' + Date.now().toString(36), title: 'New subject rule', bucket: null, subjects: [] }); },
    topics: function () { (S.config.topics = S.config.topics || []).push({ name: 'New topic', bucket: firstOf('topics'), sublabel: null, subjects: [], domains: [], emails: [] }); },
    processes: function () { (S.config.processes = S.config.processes || []).push({ bucket: firstOf('subLabels'), title: 'New process', words: [], from: [] }); },
  };
  function remove(sec, i) {
    var key = { groups: 'aliases', subjects: 'patterns', topics: 'topics', processes: 'processes' }[sec], gone = S.config[key].splice(i, 1)[0];
    if (sec === 'groups' && S.config.aliasBuckets) delete S.config.aliasBuckets[gone];
    openIt = null; changed();
    setTimeout(function () { var adds = $('st-body').querySelector('[data-act="add"]'); if (adds) adds.focus(); }, 0); // its row is gone: land on Add
  }
  function focusLast() { // the new row: a group address line, or the open form of a new topic, process or rule
    var lines = $('st-body').querySelectorAll('.st-line'), f = $('st-body').querySelector('.st-row.open .st-edit input') || (lines.length && lines[lines.length - 1].querySelector('input'));
    if (f) { f.focus(); if (f.select) f.select(); f.scrollIntoView({ block: 'nearest' }); }
  }
  function addColumn() {
    var id = 'c' + Date.now().toString(36), n = S.config.buckets.length, at = S.config.buckets[n - 1] && S.config.buckets[n - 1].id === 'keep' ? n - 1 : n;
    var k = 1, taken = function (l) { return S.config.buckets.some(function (b) { return b.label === l; }); };
    while (taken('_New column' + (k > 1 ? ' ' + k : ''))) k++; // two columns with one label would merge in Gmail
    S.config.buckets.splice(at, 0, { id: id, name: 'New column', label: '_New column' + (k > 1 ? ' ' + k : ''), archive: false, color: { backgroundColor: '#a479e2', textColor: '#ffffff' } });
    openCol = id; B.rebuild(); B.render(); B.save();
    return id;
  }
  function moveColumn(id, dir) {
    var list = S.config.buckets, i = list.map(function (b) { return b.id; }).indexOf(id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    list.splice(j, 0, list.splice(i, 1)[0]); changed();
  }
  // One remap for a deleted column, a preset swap and anything else that left ids behind.
  function remap(map, msg) {
    var next = R.remapBuckets(S.config, map);
    Object.keys(S.config).forEach(function (k) { delete S.config[k]; }); Object.assign(S.config, next);
    var seeds = R.remapSeeds(S.seeds, map), seedsMoved = seeds.some(function (s, i) { return s !== S.seeds[i]; });
    if (seedsMoved && B.API.saveSeeds) { S.seeds = seeds; B.API.saveSeeds(JSON.stringify(seeds)).catch(function () { B.toast('Contacts not saved. Your settings are; try Move them again.'); }); }
    changed(msg);
  }
  function deleteColumn(id, to) {
    var b = B.bucket(id), map = {}; map[id] = to;
    S.config.buckets = S.config.buckets.filter(function (x) { return x.id !== id; });
    if (S.config.ui && S.config.ui.collapsed) S.config.ui.collapsed = S.config.ui.collapsed.filter(function (x) { return x !== id; });
    delAsk = null; openCol = null;
    remap(map, b.name + ' deleted; its cards went to ' + B.bucket(to).name);
  }

  // ---------- presets, import, export ----------
  // A preset decides the setup (SETUP keys) and leaves who you are, your topics and your placements.
  function applySettings(data, msg) {
    B.unsave(); // a pending save of the old settings must not land after these
    var next = Object.assign({}, S.config);
    if (data.preset) SETUP.forEach(function (k) { delete next[k]; });
    Object.assign(next, JSON.parse(JSON.stringify(data)));
    return B.API.saveConfig(next).then(B.load).then(function () {
      B.toast(msg);
      if (R.orphans(S.config, S.built, S.seeds).length) open('orphans');
      else if (!$('settings').hidden) draw();
    });
  }
  function usePreset(k) {
    var p = window.LabelboardPresets[k]; if (!p) return Promise.resolve();
    return applySettings(p, 'Columns from the ' + k + ' preset').catch(fail('The preset'));
  }
  function fail(what) { return function (e) { console.error(e); B.toast(what + ' was not saved. Nothing changed. Try again.', 8000); }; }
  function plainErr(msg) { var e = new Error(msg); e.plain = true; return e; }
  function claudeKeys() { return Object.keys(S.config.cards || {}).filter(function (k) { return S.config.cards[k].by === 'claude'; }); }
  // Four kinds of file: contacts (a list), Claude's review (labelboard: 'claude-review'), an AI read (thread id → { b, t, c }), settings (has columns).
  function importFile(file) { return file.text().then(function (txt) { return importText(txt, file.name); }); }
  // name says where it came from in messages; a pasted answer may carry the AI's words or ``` around its JSON.
  function importText(txt, name) {
    return Promise.resolve().then(function () {
      var data;
      try { data = JSON.parse(txt); } catch (e) {
        var i = txt.indexOf('{'), j = txt.lastIndexOf('}');
        try { data = JSON.parse(txt.slice(i, j + 1)); } catch (e2) { throw plainErr(name + ' is not JSON'); }
      }
      if (Array.isArray(data)) {
        if (!B.API.saveSeeds) throw plainErr('the preview reads contacts from the seed folder; put the file there');
        return B.API.saveSeeds(JSON.stringify(data)).then(function (n) { return B.load().then(function () { B.toast(plural(n, 'contact') + ' imported from ' + name); }); });
      }
      if (data && data.labelboard === 'claude-review') {
        var m = R.mergeReview(S.config, data, S.built), n = m.n, read = Object.keys(data.threadVotes || {}).length;
        if (!n.placed && !read) throw plainErr('the review places no card here' + (n.yours ? ' (' + plural(n.yours, 'card') + ' you placed stay as they are)' : ''));
        S.config.cards = m.config.cards; S.config.threadVotes = m.config.threadVotes;
        if ($('st-ai-answer')) $('st-ai-answer').value = '';
        changed([n.placed && 'Placed ' + plural(n.placed, 'card'), read && 'AI read of ' + plural(read, 'thread') + ' imported'].filter(Boolean).join(', ') + [n.yours && plural(n.yours, 'card') + ' you placed kept as they are',
          n.columns && plural(n.columns, 'card') + ' for a column the board doesn\'t have left out', n.cards && plural(n.cards, 'card') + ' not on the board left out'].filter(Boolean).map(function (x) { return '; ' + x; }).join(''));
        return;
      }
      if (data && Array.isArray(data.buckets)) return applySettings(data, 'Settings imported from ' + name);
      var votes = data && (data.threadVotes || data), ids = votes && typeof votes === 'object' ? Object.keys(votes) : [];
      if (ids.length && ids.every(function (k) { return votes[k] && typeof votes[k].b === 'string'; })) {
        S.config.threadVotes = Object.assign({}, S.config.threadVotes || {}, votes);
        if ($('st-ai-answer')) $('st-ai-answer').value = '';
        changed('AI read imported: ' + plural(ids.length, 'thread'));
        return;
      }
      throw plainErr(name + ' is not contacts, a review, an AI read or Labelboard settings');
    }).catch(function (e) {
      var m = B.said(e);
      if (!m) console.error(e);
      B.toast('Nothing imported: ' + (m || name + ' could not be read or saved') + '. Nothing changed; try again.', 8000);
    });
  }
  function exportSettings() {
    var blob = new Blob([JSON.stringify(S.config, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'labelboard-settings.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    B.toast('Settings exported: labelboard-settings.json');
  }

  // ---------- first run: pick a preset, then the first read ----------
  function firstRun(el, read) {
    var P = window.LabelboardPresets || {}, on = S.config.preset || 'basic', canRead = !!B.API.refresh;
    el.innerHTML = '<div class="first-run"><p class="step">1 · Your columns</p><h2>Pick a starting board</h2>' +
      '<p>Each column becomes a Gmail label. You can rename, add or remove columns any time in Settings.</p>' +
      '<div class="presets" role="group" aria-label="Starting board">' + Object.keys(P).map(function (k) { return presetHtml(k, P[k], k === on); }).join('') + '</div>' +
      '<p class="step">2 · Your mail</p><h2>Read your inbox</h2>' +
      '<p>Labelboard reads who wrote, who was copied, the subject and the labels of each thread in your inbox, and of the last 30 days of mail that left it (archived by you or by a filter), so what skips your inbox shows too. It never opens message bodies, and nothing changes in Gmail until you review and apply.</p>' +
      '<button class="btn primary" type="button" id="first-scan"' + (canRead ? '' : ' disabled') + '>Read my mail</button>' +
      (canRead ? '' : '<p class="note">The preview reads a snapshot from this computer: ask Claude to refresh it.</p>') + '</div>';
    el.querySelectorAll('.preset').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.preset; if (k === S.config.preset) return;
        el.querySelectorAll('.preset').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        usePreset(k);
      };
    });
    $('first-scan').onclick = function () { read(); };
  }

  // ---------- wiring ----------
  $('st-close').onclick = close;
  $('settings').addEventListener('click', function (e) { if (e.target === this) close(); });
  $('st-nav').addEventListener('click', function (e) { var b = e.target.closest('[data-nav]'); if (b) { cur = b.dataset.nav; delAsk = null; openIt = null; find = ''; draw(); $('st-body').scrollTop = 0; } });
  $('st-body').addEventListener('input', function (e) { if (e.target.classList.contains('st-find')) { find = e.target.value; filter(); } });
  $('st-body').addEventListener('keydown', function (e) {
    var inp = e.target; if (!inp.classList.contains('chip-in')) return;
    if (e.key === 'Enter' || (inp.dataset.loose && (e.key === ',' || e.key === ' ' || e.key === ';'))) { e.preventDefault(); if (inp.value.trim()) addChips(inp, inp.value); }
    else if (e.key === 'Backspace' && !inp.value) { var have = chipList(inp); if (have.length) { e.preventDefault(); putChips(inp, have.slice(0, -1)); } }
  });
  $('st-body').addEventListener('paste', function (e) {
    var inp = e.target, t = e.clipboardData && e.clipboardData.getData('text');
    if (!inp.classList.contains('chip-in') || !t || !(inp.dataset.loose ? /[\s,;]/ : /\n/).test(t.trim())) return;
    e.preventDefault(); addChips(inp, inp.value + '\n' + t);
  });
  $('st-body').addEventListener('focusout', function (e) { var inp = e.target; if (inp.classList.contains('chip-in') && inp.value.trim()) addChips(inp, inp.value); });
  $('st-body').addEventListener('change', function (e) {
    var el = e.target, d = el.dataset;
    if (el.classList.contains('chip-in')) return; // chips commit on Enter and on leaving the box
    if (d.labelmap) {
      var l = d.labelmap, v = el.value || null, own = ownLabels()[l] || null;
      S.config.labelMap = S.config.labelMap || {};
      if (v === own) delete S.config.labelMap[l]; else S.config.labelMap[l] = v;
      return changed(v ? l + ' counts toward ' + B.bucket(v).name : l + ' no longer counts');
    }
    if (d.sec && SET[d.sec]) SET[d.sec](el, d.f, d.i == null ? null : +d.i);
  });
  $('st-body').addEventListener('click', function (e) {
    if (e.target.classList.contains('chips')) return e.target.querySelector('.chip-in').focus();
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, row = el.closest('[data-col]'), id = row && row.dataset.col;
    if (a === 'col-open') { openCol = openCol === id ? null : id; delAsk = null; return draw(); }
    if (a === 'it-open') { var it = el.closest('[data-it]').dataset.it; openIt = openIt === it ? null : it; return draw(); }
    if (a === 'chip-x') { var inp = el.closest('.chips').querySelector('.chip-in'), v = el.parentNode.dataset.v; inp.focus(); return putChips(inp, chipList(inp).filter(function (x) { return x !== v; })); }
    if (a === 'look') { B.ui()[el.dataset.k] = el.dataset.v; B.applyUi(); B.save(); if (el.dataset.k === 'home') B.render(); return draw(); }
    if (a === 'remove-all') { close(); return B.openUndo('all'); }
    if (a === 'col-up' || a === 'col-down') return moveColumn(id, a === 'col-up' ? -1 : 1);
    if (a === 'col-add') { addColumn(); return draw(); }
    if (a === 'color') { var b = B.bucket(id), c = el.dataset.color; b.color = { backgroundColor: c, textColor: B.textOn(c) }; return changed(); }
    if (a === 'col-del') { delAsk = id; draw(); return $('st-del-to').focus(); }
    if (a === 'col-del-no') { delAsk = null; return draw(); }
    if (a === 'col-del-ok') return deleteColumn(id, $('st-del-to').value);
    if (a === 'add') { // opens the new row; after the redraw, its first field
      var sec = el.dataset.sec; ADD[sec](); if (ONE[sec]) { openIt = sec + ':' + (S.config[COUNT[sec]].length - 1); find = ''; }
      changed(); return setTimeout(focusLast, 0);
    }
    if (a === 'remove') return remove(el.dataset.sec, +el.dataset.i);
    if (a === 'preset') return usePreset(el.dataset.preset);
    if (a === 'import') return $('import-file').click();
    if (a === 'export') return exportSettings();
    if (a === 'ai-brief') return downloadBrief();
    if (a === 'ai-use') { var txt = $('st-ai-answer').value.trim(); return txt ? importText(txt, 'The answer') : B.toast('Paste the AI\'s answer in the box first.'); }
    if (a === 'claude-clear') { var ks = claudeKeys(); ks.forEach(function (k) { delete S.config.cards[k]; }); return changed(plural(ks.length, 'card') + ' from Claude back to the suggestions'); }
    if (a === 'votes-clear') { var n = Object.keys(S.config.threadVotes || {}).length; delete S.config.threadVotes; return changed('AI read cleared: ' + plural(n, 'thread')); }
    if (a === 'orphans-ok') {
      var map = {}; $('st-body').querySelectorAll('[data-orphan]').forEach(function (s) { map[s.dataset.orphan] = s.value; });
      return remap(map, 'Moved: ' + Object.keys(map).map(function (k) { return k + ' → ' + B.bucket(map[k]).name; }).join(', '));
    }
  });

  return { open: open, close: close, addColumn: addColumn, firstRun: firstRun, importFile: importFile, exportSettings: exportSettings };
};
