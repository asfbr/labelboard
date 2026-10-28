// Labelboard rule engine — pure JS, no DOM, no Apps Script APIs.
// Runs in three places: Node tests, the board (live before/after), the Apps Script server (apply).
// Everything Gmail-specific is emulated here; docs/ARCHITECTURE.md says where the emulation is approximate.
var LabelboardRules = (function () {
  'use strict';

  var GENERIC_DOMAINS = ['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
    'yahoo.com.br', 'icloud.com', 'me.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'proton.me',
    'protonmail.com', 'aol.com', 'msn.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'yandex.ru', 'mail.ru',
    'qq.com', '163.com', 'zoho.com', 'fastmail.com', 'hey.com'];
  // Domains many unrelated senders share: cards go per sender, not per domain.
  var SHARED_DOMAINS = ['substack.com', 'beehiiv.com', 'mail.beehiiv.com', 'google.com', 'docs.google.com',
    'luma-mail.com', 'user.luma-mail.com', 'calendar.luma-mail.com', 'docusign.net', 'mailchimpapp.com',
    'sendgrid.net', 'hubspotemail.net', 'zoom.us', 'linkedin.com', 'medium.com', 'eventbrite.com'];
  // More per user or preset: config.newsletterDomains.
  var NEWSLETTER_DOMAINS = ['substack.com', 'beehiiv.com', 'mail.beehiiv.com', 'morningbrew.com', 'axios.com'];
  var NEWSLETTER_LOCAL = /^(newsletter|newsletters|news|digest|editor|editorial|weekly|daily|briefing|insights|marketing|mkt|boletim|comunicacao|eventos|mailing)([._+-]|$)/;
  var AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer-daemon|postmaster|calendar-notification|drive-shares[\w-]*|comments-noreply|dse[\w-]*|account[\w-]*|security[\w-]*|billing|invoices?|receipts?|support|hello|team|updates?|info)([._+-]|@|$)/;
  // Tokens Gmail sees in automated addresses; people-buckets exclude them so a contact at google.com
  // does not swallow calendar and Drive notifications.
  // Mass mail from an organisation you otherwise work with (a law firm's newsletter) is not a conversation.
  var AUTOMATED_TOKENS = ['noreply', 'no-reply', 'notifications', 'notification', 'calendar-notification', 'mailer-daemon',
    'marketing', 'newsletter', 'news', 'comunicacao', 'eventos', 'mailing', 'boletim'];
  // Sending subdomains (mail.attio.com, em1.cloudflare.com): no person writes from these.
  var BULK_SUBDOMAIN = /^(mail|e|emd*|email|emails|news|notice|notices|notifications?|emailnotifications|updates?|info|mkt|marketing|send|mailer|go|engage|comms|welcome|events?|marketplace)./;
  function isBulkDomain(d) { return BULK_SUBDOMAIN.test(d || ''); }
  // Mirrors exactly what the Gmail exclusion matches, so the board's numbers stay honest.
  var autoMemo = Object.create(null), autoN = 0, autoPadded = null; // memoized: asked per thread per filter group
  function isAutomated(email) {
    var hit = autoMemo[email]; if (hit !== undefined) return hit;
    var local = ' ' + tokens(localOf(email)) + ' ';
    autoPadded = autoPadded || AUTOMATED_TOKENS.map(function (t) { return ' ' + tokens(t) + ' '; });
    if (++autoN > 50000) { autoMemo = Object.create(null); autoN = 1; }
    return autoMemo[email] = autoPadded.some(function (t) { return local.indexOf(t) >= 0; });
  }

  // ---------- addresses ----------
  function addr(s) {
    if (!s) return '';
    var m = String(s).match(/<([^>]+)>/);
    return (m ? m[1] : String(s)).trim().toLowerCase();
  }
  function domainOf(email) {
    var i = email.lastIndexOf('@');
    return i < 0 ? '' : email.slice(i + 1);
  }
  function localOf(email) {
    var i = email.lastIndexOf('@');
    return i < 0 ? email : email.slice(0, i);
  }
  function inList(domain, list) {
    for (var i = 0; i < list.length; i++) {
      if (domain === list[i] || endsWith(domain, '.' + list[i])) return true;
    }
    return false;
  }
  function endsWith(s, suffix) { return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix; }

  // Gmail-ish address match: a value with '@' is an exact address, otherwise a domain (subdomains included).
  function addrMatches(email, value) {
    if (!email) return false;
    if (value.indexOf('@') >= 0) return email === value;
    var d = domainOf(email);
    return d === value || endsWith(d, '.' + value);
  }
  // The domain values addrMatches would accept for a domain, longest first: "a.b.com" → a.b.com, b.com, com.
  function suffixes(d) {
    var out = [d];
    for (var i = d.indexOf('.'); i >= 0; i = d.indexOf('.', i + 1)) out.push(d.slice(i + 1));
    return out;
  }

  // Gmail phrase search ignores punctuation and case: compare token sequences.
  // memoized: the Unicode regex is most of the cost of matching filters against every thread
  var tokMemo = Object.create(null), tokN = 0; // no prototype: a subject like "constructor" is just a key
  function tokens(s) {
    s = String(s || '');
    var hit = tokMemo[s]; if (hit !== undefined) return hit;
    if (++tokN > 50000) { tokMemo = Object.create(null); tokN = 1; }
    return tokMemo[s] = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function phraseIn(text, phrase) { var p = tokens(phrase); return p.length > 0 && hasPhrase(tokens(text), p); }
  // p as whole words of tok (both already tokens()), without building padded copies
  function hasPhrase(tok, p) {
    for (var i = tok.indexOf(p); i >= 0; i = tok.indexOf(p, i + 1)) if ((!i || tok[i - 1] === ' ') && (i + p.length === tok.length || tok[i + p.length] === ' ')) return true;
    return false;
  }

  // ---------- terms: one matchable unit, emulated locally and rendered to a Gmail query ----------
  // field: from | participant (from/to/cc) | recipient (to/cc) | subject
  function termMatches(term, t) {
    switch (term.field) {
      case 'from': return addrMatches(t.from, term.value);
      case 'recipient': return anyAddr(t.to, term.value) || anyAddr(t.cc, term.value);
      case 'participant': return addrMatches(t.from, term.value) || anyAddr(t.to, term.value) || anyAddr(t.cc, term.value);
      case 'subject': return phraseIn(t.subject, term.value);
    }
    return false;
  }
  function anyAddr(list, value) {
    for (var i = 0; i < (list || []).length; i++) if (addrMatches(list[i], value)) return true;
    return false;
  }
  // Who is on a thread: 'only' (a colleague or you wrote it, and everyone on it is one of you), 'outside' (one of you
  // wrote it, someone outside is on it), '' (someone outside wrote it). Colleagues: config.firmDomains; you: config.me.
  // From the read's From (first sender not you), To and Cc: Bcc is never seen.
  function whoIsOn(t, config) {
    var me = (config.me || []).map(addr), firm = config.firmDomains || [];
    var ours = function (a) { return me.indexOf(a) >= 0 || inList(domainOf(a), firm); };
    if (!t.from || !ours(t.from)) return '';
    return (t.to || []).every(ours) && (t.cc || []).every(ours) ? 'only' : 'outside';
  }
  function quoteIfNeeded(v) { return /[\s()":{}]/.test(v) ? '"' + v.replace(/"/g, '') + '"' : v; }
  function termQuery(term) {
    var v = quoteIfNeeded(term.value);
    switch (term.field) {
      case 'from': return 'from:' + v;
      // Gmail's to: also matches Cc (checked live: "cc:x -to:x" finds nothing), so no cc: term.
      case 'recipient': return 'to:' + v;
      case 'participant': return 'from:' + v + ' OR to:' + v;
      case 'subject': return 'subject:"' + term.value.replace(/"/g, '') + '"';
    }
    return '';
  }
  // Terms OR-joined, split so no single filter query exceeds maxLen.
  function chunkQueries(terms, maxLen) {
    maxLen = maxLen || 800; // + the automated-sender exclusion stays under ~900

    var out = [], cur = '';
    terms.forEach(function (term) {
      var q = termQuery(term);
      if (cur && cur.length + 4 + q.length > maxLen) { out.push(cur); cur = ''; }
      cur = cur ? cur + ' OR ' + q : q;
    });
    if (cur) out.push(cur);
    return out;
  }

  // ---------- cards ----------
  // A card is one draggable rule: an entity, a group alias, a subject pattern, a domain or a sender.
  function buildCards(snapshot, config, seeds) {
    config = config || {};
    var me = (config.me || []).map(addr);
    var firm = config.firmDomains || [];
    var aliases = (config.aliases || []).map(addr);
    var patterns = config.patterns || [];
    var shared = SHARED_DOMAINS.concat(config.sharedDomains || []);
    var generic = GENERIC_DOMAINS.concat(config.genericDomains || []);

    // What a thread is ABOUT is a topic (a client, a project): contacts in a bucket marked `topics`.
    // Who else is on it is context (accountant, agency, lawyer): context never claims a thread that has a topic.
    // A seed's own `role` wins: 'counterparty' is a party whose mail is about one thing even without a topic named.
    var bucketList = config.buckets || [];
    var flagged = function (f) { return bucketList.filter(function (b) { return b[f]; }).map(function (b) { return b.id; }); };
    var topicBuckets = flagged('topics'), machineBuckets = flagged('automated'), newTopicBuckets = flagged('newTopics');
    var stopNames = (config.subjectStopNames || []).map(tokens);
    function roleOf(s) {
      if (s.role) return s.role;
      return topicBuckets.indexOf(s.bucket) >= 0 ? 'topic' : 'context';
    }
    var seedByEmail = {}, seedDomains = [], subjectNames = [], entities = {};
    function entity(s) {
      var key = 'entity:' + s.bucket + ':' + s.name;
      if (!entities[key]) entities[key] = { key: key, kind: 'entity', title: s.name, role: roleOf(s), seed: { bucket: s.bucket, sublabel: s.sublabel || null, source: s.source || 'seed', role: roleOf(s) }, terms: [] };
      return entities[key];
    }
    function addSubject(e, phrase) {
      var t = tokens(phrase);
      if (t.length < 4 || stopNames.indexOf(t) >= 0 || e.terms.some(function (x) { return x.field === 'subject' && tokens(x.value) === t; })) return;
      e.terms.push({ field: 'subject', value: phrase }); subjectNames.push([phrase, e]);
    }
    // config.processes: a topic in a process (a sale, a dispute) whose mail, once a signal shows up, goes to
    // the process bucket. { bucket, title, words[], from[]: topic buckets an AI read may send in }
    var processBy = {}, processes = {}, processCards = {};
    (config.processes || []).forEach(function (p) { processBy[p.bucket] = p; });
    (seeds || []).concat(topicSeeds(config.topics)).forEach(function (s) {
      if (s.match === 'process') { if (processBy[s.bucket]) processes[s.name] = processBy[s.bucket]; return; }
      var e = entity(s);
      if (s.match === 'subject') return addSubject(e, s.value);
      // A shared or generic domain (google.com, gmail.com) can't stand for one company.
      if (s.match !== 'email' && (inList(s.value, shared) || inList(s.value, generic) || inList(s.value, firm))) return;
      if (s.match === 'email') seedByEmail[s.value] = e; else seedDomains.push([s.value, e]);
      e.terms.push({ field: 'participant', value: s.value });
      if (e.role === 'topic') addSubject(e, s.name); // topics are named in subjects: "Acme - monthly update"
    });
    seedDomains.sort(function (a, b) { return b[0].length - a[0].length; }); // most specific domain wins
    subjectNames.sort(function (a, b) { return b[0].length - a[0].length; }); // "Acme Health" before "Acme"
    var nameFirst = subjectNames.map(function (n) { return firstWord(tokens(n[0])); });
    // domain → its entities in seed order. Walking an address's domain then its parents visits them in the
    // sorted list's order: suffixes of one domain never tie in length.
    var seedByDomain = Object.create(null), seedAt = seedDomains.some(function (x) { return x[0].indexOf('@') >= 0; });
    seedDomains.forEach(function (x) { (seedByDomain[x[0]] = seedByDomain[x[0]] || []).push(x[1]); });
    var seedMemo = Object.create(null);
    function seedFor(email) {
      if (!email) return null;
      var hit = seedMemo[email];
      return hit !== undefined ? hit : seedMemo[email] = findSeed(email);
    }
    function findSeed(email) {
      if (inList(domainOf(email), firm) || me.indexOf(email) >= 0 || isAutomated(email)) return null;
      if (seedByEmail[email]) return seedByEmail[email];
      // Non-topic contacts count only from their own domain: notice.microsoft.com is not Microsoft's people writing.
      if (seedAt) for (var i = 0; i < seedDomains.length; i++) { // a domain seed holding an address: the plain scan
        var d = seedDomains[i][0], e = seedDomains[i][1];
        if (addrMatches(email, d) && (e.role === 'topic' || domainOf(email) === d)) return e;
      }
      else for (var s = suffixes(domainOf(email)), k = 0; k < s.length; k++) {
        for (var l = seedByDomain[s[k]] || [], j = 0; j < l.length; j++) if (l[j].role === 'topic' || !k) return l[j];
      }
      return null;
    }
    function processCard(e, proc, source) {
      if (!processCards[e.key]) processCards[e.key] = { key: 'process:' + e.title, kind: 'process', title: e.title + ' ' + (proc.title || 'process'), role: 'topic',
        seed: { bucket: proc.bucket, sublabel: (proc.folder ? proc.folder + '/' : '') + e.title, source: source || 'your contacts file', role: 'topic' }, terms: clone(e.terms), parent: { bucket: e.seed.bucket, sublabel: e.seed.sublabel },
        must: (proc.words || []).map(function (w) { return { field: 'subject', value: w }; }) };
      return processCards[e.key];
    }

    var cards = {}, order = [];
    function card(key, make) {
      if (!cards[key]) { cards[key] = make(); cards[key].key = key; cards[key].threads = []; cards[key].also = 0; order.push(key); }
      return cards[key];
    }

    // config.threadVotes: what an AI read of each thread said, { id: { b: bucket, t: topic|null, c: confidence } }
    var votes = config.threadVotes || {}, topicByName = {};
    Object.keys(entities).forEach(function (k) { // by name, and by label leaf ("Acme (Proj. Kite)" → "Acme")
      var e = entities[k], leaf = tokens(String(e.seed.sublabel || '').split('/').pop());
      if (e.role !== 'topic') return;
      topicByName[tokens(e.title)] = e;
      if (leaf && !topicByName[leaf]) topicByName[leaf] = e;
    });
    function voteTopic(v) {
      if (!v || !v.t || v.c === 'low') return null;
      var e = topicByName[tokens(v.t)], pv = processBy[v.b];
      // a process the AI read, listed or not
      if (e && pv && (processes[e.title] === pv || (pv.from || []).indexOf(e.seed.bucket) >= 0)) return processCard(e, pv, processes[e.title] ? null : 'AI read');
      if (e) return e;
      if (newTopicBuckets.indexOf(v.b) < 0) return null; // a topic no contacts file knows: its own card, rule-less until you add terms
      var key = 'entity:' + v.b + ':' + v.t;
      if (!entities[key]) entities[key] = { key: key, kind: 'entity', title: v.t, role: 'topic', seed: { bucket: v.b, sublabel: v.t, source: 'AI read', role: 'topic' }, terms: [] };
      return topicByName[tokens(v.t)] = entities[key];
    }

    var threadCards = {};
    snapshot.threads.forEach(function (t) {
      var matched = [];
      function claim(e) { if (matched.indexOf(e.key) < 0) { card(e.key, function () { return clone(e); }); matched.push(e.key); } }
      var people = isAutomated(t.from) ? [] : [t.from].concat(t.to || [], t.cc || []);
      var v = votes[t.id];
      // read as machine mail (a vendor's promo, a law firm's webinar): no counterparty/context claim
      if (v && v.c !== 'low' && machineBuckets.indexOf(v.b) >= 0) people = people.filter(function (p) { var e = seedFor(p); return !e || e.role === 'topic'; });
      var known = people.map(seedFor).filter(Boolean);
      // 0. the topic the AI read in the thread (a project behind a lawyer's "Opinion"), then
      // 1. topics: one named in the subject, then one taking part in the thread
      var vt = voteTopic(v);
      if (vt) claim(vt);
      var sv = subjectView(t.subject);
      subjectNames.forEach(function (n, i) { if (sv.has[nameFirst[i]] && phraseIn(t.subject, n[0])) claim(n[1]); });
      known.forEach(function (e) { if (e.role === 'topic') claim(e); });
      // 2. a topic in a process + a signal (a contact from the process bucket on it, or a signal word)
      //    → that process, ahead of the topic itself
      matched.slice().forEach(function (k) {
        var e = entities[k], proc = e && e.role === 'topic' && processes[e.title];
        if (!proc) return;
        var signal = known.filter(function (x) { return x.role !== 'topic' && x.seed.bucket === proc.bucket; });
        if (!signal.length && !(proc.words || []).some(function (w) { return phraseIn(t.subject, w); })) return;
        var pc = processCard(e, proc), live = card(pc.key, function () { return clone(pc); });
        signal.forEach(function (m) { // the contacts actually seen on it become part of its rule
          m.terms.forEach(function (term) {
            if (live.must.length < 24 && !live.must.some(function (x) { return x.value === term.value; })) live.must.push(term);
          });
        });
        if (matched.indexOf(pc.key) < 0) matched.unshift(pc.key);
      });
      // 2. subject patterns (calendar replies, tagged subjects)
      patterns.forEach(function (p) {
        var hit = p.subjects.some(function (s) { return phraseIn(t.subject, s); });
        if (hit) {
          var k = 'pattern:' + p.key;
          card(k, function () { return { kind: 'pattern', title: p.title, terms: p.subjects.map(function (s) { return { field: 'subject', value: s }; }), hint: p.bucket || null }; });
          matched.push(k);
        }
      });
      // 3. group aliases among recipients
      aliases.forEach(function (a) {
        if (anyAddr(t.to, a) || anyAddr(t.cc, a)) {
          var k = 'alias:' + a;
          card(k, function () { return { kind: 'alias', title: 'Sent to ' + a, terms: [{ field: 'recipient', value: a }] }; });
          matched.push(k);
        }
      });
      // 4b. counterparties: their mail is about one thing even without a topic named. After the
      //     subject patterns so "[Intro] …" from a counterparty stays with its tag.
      known.forEach(function (e) { if (e.role === 'counterparty') claim(e); });
      // 5. context (accountant, agency, lawyer) only when nothing above says what the thread is about
      if (!matched.length) known.forEach(function (e) { if (e.role === 'context') claim(e); });
      // 6. the sender — only when nothing above claimed the thread, so no sender card exists just
      // as a shadow of an entity (it would still write a filter and change the union).
      threadCards[t.id] = matched;
      if (matched.length) {
        cards[matched[0]].threads.push(t.id);
        for (var j0 = 1; j0 < matched.length; j0++) cards[matched[j0]].also++;
        return;
      }
      var d = domainOf(t.from), k2;
      if (inList(d, firm) || me.indexOf(t.from) >= 0) {
        k2 = whoIsOn(t, config) === 'only' ? 'firm:colleagues' : 'firm:outside';
        card(k2, function () { return firmCard(k2, firm); });
      } else if (inList(d, generic) || inList(d, shared) || suffixes(d).some(function (x) { return !!seedByDomain[x]; })) {
        // a known organisation's mass mail (marketing@lexfirm.com): a rule for that sender, never for
        // the whole domain, which would also catch its people writing about your topics
        k2 = 'sender:' + t.from;
        card(k2, function () { return { kind: 'sender', title: t.fromName || t.from, subtitle: t.from, terms: [{ field: 'from', value: t.from }] }; });
      } else {
        k2 = 'domain:' + d;
        card(k2, function () { return { kind: 'domain', title: d, terms: [{ field: 'from', value: d }] }; });
      }
      matched.push(k2);
      threadCards[t.id] = matched;
      cards[matched[0]].threads.push(t.id);
      for (var j = 1; j < matched.length; j++) cards[matched[j]].also++;
    });
    // Only cards that own at least one thread show up; secondary-only cards still filter (union semantics).
    var list = order.map(function (k) { return cards[k]; });
    var byId = {};
    snapshot.threads.forEach(function (t) { byId[t.id] = t; });
    list.forEach(function (c) { c.suggestion = suggest(c, byId, config); });
    return { cards: list, threadCards: threadCards, entities: entities };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // The two colleague cards (whoIsOn). Gmail search can't say "nobody else is on it", so they make no Gmail filter:
  // Labelboard's hourly run labels their new mail (peopleRules). Their terms only narrow archiving later.
  var FIRM = { 'firm:colleagues': { side: 'only', title: 'Only colleagues (no other match)' }, 'firm:outside': { side: 'outside', title: 'Colleagues with people outside (no other match)' } };
  function firmCard(key, firm) { return { kind: 'firm', side: FIRM[key].side, title: FIRM[key].title, terms: firm.map(function (f) { return { field: 'from', value: f }; }) }; }
  // A colleague card you placed keeps its rule while the read has no mail for it, as a contact with no mail keeps its filter.
  function firmCards(built, config) {
    var out = built.cards.filter(function (c) { return c.kind === 'firm'; });
    Object.keys(FIRM).forEach(function (k) {
      if (!(config.cards || {})[k] || out.some(function (c) { return c.key === k; })) return;
      var c = firmCard(k, config.firmDomains || []); c.key = k; c.threads = []; c.also = 0; c.suggestion = suggest(c, {}, config); out.push(c);
    });
    return out;
  }
  // config.topics: topics that aren't in any contacts file, e.g. { name, bucket, sublabel, subjects[], domains[], emails[] }
  function topicSeeds(topics) {
    var out = [];
    (topics || []).forEach(function (tp) {
      var base = { bucket: tp.bucket, name: tp.name, sublabel: tp.sublabel || null, source: 'your settings', role: 'topic' };
      (tp.subjects || []).forEach(function (v) { out.push(Object.assign({ match: 'subject', value: v }, base)); });
      (tp.domains || []).forEach(function (v) { out.push(Object.assign({ match: 'domain', value: v.toLowerCase() }, base)); });
      (tp.emails || []).forEach(function (v) { out.push(Object.assign({ match: 'email', value: v.toLowerCase() }, base)); });
    });
    return out;
  }
  // Context (accountant, agency, lawyer) also appears on topic threads, so its rule would label those
  // too: it only becomes a Gmail filter once you place the card yourself.
  function writesFilter(c, p, b) {
    return !!(b && b.label) && c.kind !== 'firm' && !(c.role === 'context' && !p.decided);
  }

  // ---------- suggestions ----------
  // reason: a sentence shown on the card and in its drawer (docs/BRAND.md voice: no engine words)
  function suggest(c, byId, config) {
    var fromLabels = labelVote(c, byId, labelMapOf(config)), all = c.threads.length;
    var ai = aiVote(c, config.threadVotes || {});
    var aiSays = ai && ai.share >= 0.6 && { bucket: ai.bucket, reason: 'Claude read ' + ofThese(ai.n, all) + ' as ' + bucketName(ai.bucket, config), confidence: ai.share >= 0.85 ? 'high' : 'medium', who: 'claude' };
    var labelled = fromLabels && 'you already labelled ' + (fromLabels.share === 1 ? (all === 1 ? 'it' : 'all of these') : Math.round(fromLabels.share * 100) + '% of these') + ' ' + fromLabels.label;
    if (c.seed && c.role === 'context') {
      // Only threads where no topic was found end up here: say so instead of guessing.
      if (aiSays) return aiSays;
      if (fromLabels && fromLabels.share >= 0.5) return { bucket: fromLabels.bucket, reason: 'Nothing names a topic, but ' + labelled, confidence: 'medium', who: 'gmail' };
      // filed under a sub-label of its own (M&A/Advisors): that is its home when no topic is named
      if (c.seed.sublabel) return { bucket: c.seed.bucket, sublabel: c.seed.sublabel, reason: 'One of your contacts (' + c.seed.sublabel + '), and nothing here names a topic', confidence: 'medium', who: 'rule' };
      return { bucket: 'unsorted', reason: 'One of your contacts (' + (c.seed.sublabel || bucketName(c.seed.bucket, config)) + '), but nothing here says which topic it is about', confidence: 'low', who: 'rule' };
    }
    if (c.seed) return { bucket: c.seed.bucket, sublabel: c.seed.sublabel, reason: seedReason(c.seed), confidence: 'high', who: c.seed.source === 'AI read' ? 'claude' : 'rule' };
    if (c.hint) return { bucket: c.hint, reason: 'The subject matches one of your subject rules', confidence: 'high', who: 'rule' };
    if (aiSays && c.kind !== 'firm') return aiSays;
    if (fromLabels && fromLabels.share >= 0.5) return { bucket: fromLabels.bucket, reason: 'Y' + labelled.slice(1), confidence: fromLabels.share >= 0.8 ? 'high' : 'medium', who: 'gmail' };
    if (c.kind === 'alias' && config.aliasBuckets && config.aliasBuckets[c.terms[0].value]) return { bucket: config.aliasBuckets[c.terms[0].value], reason: 'Sent to a group address you set up', confidence: 'high', who: 'rule' };
    if (c.kind === 'firm') return { bucket: 'keep', reason: 'Your colleagues stay in the inbox', confidence: 'medium', who: 'rule' };
    var email = c.kind === 'sender' ? c.terms[0].value : '';
    var dom = c.kind === 'domain' ? c.terms[0].value : domainOf(email);
    var senders = c.threads.map(function (id) { return byId[id].from; });
    if (inList(dom, NEWSLETTER_DOMAINS.concat(config.newsletterDomains || [])) || senders.some(function (s) { return NEWSLETTER_LOCAL.test(localOf(s)); })) return { bucket: 'newsletters', reason: 'Looks like a newsletter', confidence: 'medium', who: 'rule' };
    var machine = senders.filter(isMachine).length;
    if (senders.length && machine / senders.length >= 0.6) return { bucket: 'tools', reason: 'Sent by a machine, not a person', confidence: 'medium', who: 'rule' };
    if (isBulkDomain(dom)) return { bucket: 'tools', reason: 'Sent through a bulk-mail service (' + dom + ')', confidence: 'medium', who: 'rule' };
    if (fromLabels) return { bucket: fromLabels.bucket, reason: 'You labelled some of these ' + fromLabels.label, confidence: 'low', who: 'gmail' };
    return { bucket: 'unsorted', reason: 'Nothing in this mail points to a column yet', confidence: 'none', who: 'none' };
  }
  function ofThese(n, all) { return all === 1 ? 'it' : n === all ? 'all ' + all : n + ' of these ' + all; }
  // seed.source: a contacts file's name, 'your settings' (a topic), 'AI read' (a name the AI read found)
  function seedReason(seed) {
    var src = seed.source || '';
    if (src === 'your settings') return 'Matches a topic in your settings';
    if (src === 'AI read') return 'Matches a name Claude found';
    var list = 'your contacts' + (src && src !== 'seed' && src !== 'your contacts file' ? ' (' + src + ')' : '');
    return seed.role === 'counterparty' ? 'Sent by or to someone in ' + list : 'Mentions someone in ' + list;
  }
  function aiVote(c, votes) {
    var n = {}, best = null;
    c.threads.forEach(function (id) { var v = votes[id]; if (v && v.c !== 'low') n[v.b] = (n[v.b] || 0) + 1; });
    Object.keys(n).forEach(function (b) { if (!best || n[b] > n[best]) best = b; });
    return best && c.threads.length ? { bucket: best, n: n[best], share: n[best] / c.threads.length } : null;
  }
  function bucketName(id, config) {
    var b = (config.buckets || []).filter(function (x) { return x.id === id; })[0];
    return b ? b.name : id;
  }
  function labelVote(c, byId, labelMap) {
    var votes = {}, n = c.threads.length;
    c.threads.forEach(function (id) {
      var seen = {};
      (byId[id].labels || []).forEach(function (l) {
        var b = bucketForLabel(l, labelMap);
        if (b && !seen[b]) { seen[b] = 1; votes[b] = votes[b] || { bucket: b, label: l, n: 0 }; votes[b].n++; }
      });
    });
    var best = null;
    Object.keys(votes).forEach(function (k) { if (!best || votes[k].n > best.n) best = votes[k]; });
    return best && n ? { bucket: best.bucket, label: best.label, share: best.n / n } : null;
  }
  // Each column's own Gmail label (sub-labels included) counts toward it; config.labelMap maps the rest and wins.
  function labelMapOf(config) {
    var m = {};
    (config.buckets || []).forEach(function (b) { if (b.label) m[b.label] = b.id; });
    return Object.assign(m, config.labelMap || {});
  }
  // Longest matching prefix wins: "Clients/Retail/Acme" → the "Clients" entry.
  function bucketForLabel(label, labelMap) {
    var best = null, len = -1;
    Object.keys(labelMap).forEach(function (p) {
      if ((label === p || label.indexOf(p + '/') === 0) && p.length > len) { best = labelMap[p]; len = p.length; }
    });
    return best;
  }

  // ---------- placement & stats ----------
  // A card whose column is gone (a preset swap, a deleted column) waits in Unsorted; `lost` names the old id.
  // who put it there: 'you' or 'claude' (a placement), else the suggestion's 'rule', 'gmail', 'claude' or 'none'.
  function placement(c, config) {
    var p = (config.cards || {})[c.key], id = p && p.bucket || c.suggestion.bucket;
    if (!hasBucket(config, id)) return { bucket: 'unsorted', sublabel: null, decided: false, lost: id, who: 'none' };
    var decided = !!(p && p.bucket);
    return {
      bucket: id,
      sublabel: p && p.sublabel !== undefined ? p.sublabel : (c.suggestion.sublabel || null),
      decided: decided,
      who: decided ? (p.by === 'claude' ? 'claude' : 'you') : c.suggestion.who || 'none',
      why: decided && p.why || null,
    };
  }
  // A review file from Claude: { labelboard: 'claude-review', cards: { key: { bucket, sublabel?, why? } }, threadVotes? }.
  // Lands in place as by: 'claude'; never over a card you placed, a column the board doesn't have, or a card it doesn't know.
  function mergeReview(config, review, built) {
    var c = clone(config), known = {}, n = { placed: 0, yours: 0, columns: 0, cards: 0 };
    (built ? built.cards : []).forEach(function (x) { known[x.key] = 1; });
    c.cards = c.cards || {};
    Object.keys(review.cards || {}).forEach(function (k) {
      var r = review.cards[k] || {}, cur = c.cards[k];
      if (built && !known[k]) return n.cards++;
      if (!hasBucket(c, r.bucket) || r.bucket === 'unsorted') return n.columns++;
      if (cur && cur.bucket && cur.by !== 'claude') return n.yours++;
      var p = { bucket: r.bucket, by: 'claude' };
      if (r.sublabel !== undefined) p.sublabel = r.sublabel;
      if (r.why) p.why = String(r.why).slice(0, 200);
      c.cards[k] = p; n.placed++;
    });
    if (review.threadVotes) c.threadVotes = Object.assign({}, c.threadVotes || {}, review.threadVotes);
    return { config: c, n: n };
  }
  // What an AI needs to place cards: the columns, and each card not placed by you (all: every card) with a few of its
  // threads, newest first. dev/review.mjs prints it; Settings → Ask an AI downloads it as briefText(). Never your own addresses.
  function reviewBrief(mail, built, config, all) {
    var byId = {}, me = (config.me || []).map(function (a) { return String(a).toLowerCase(); }), cols = (config.buckets || []).map(function (b) { return { id: b.id, name: b.name, label: b.label || null, subLabels: !!b.subLabels, about: b.description || null }; });
    (mail.threads || []).forEach(function (t) { byId[t.id] = t; });
    var cards = built.cards.filter(function (c) { return c.threads.length; }).map(function (c) {
      var p = placement(c, config); if (!all && p.who === 'you') return null;
      var ts = c.threads.map(function (id) { return byId[id]; }).filter(Boolean).sort(function (a, z) { return String(z.date).localeCompare(String(a.date)); }), from = [];
      ts.forEach(function (t) { if (t.from && from.indexOf(t.from) < 0 && me.indexOf(String(t.from).toLowerCase()) < 0) from.push(t.from); });
      return { key: c.key, title: c.title, kind: c.kind, column: p.bucket, sublabel: p.sublabel, who: p.who, why: p.why || c.suggestion.reason, threads: ts.length,
        inbox: ts.filter(function (t) { return (t.labels || []).indexOf('INBOX') >= 0; }).length, ids: ts.slice(0, 5).map(function (t) { return t.id; }),
        subjects: ts.slice(0, 5).map(function (t) { return t.subject; }), from: from.slice(0, 3), newest: ts[0] ? String(ts[0].snippet || '').slice(0, 140) : '' };
    }).filter(Boolean);
    return { columns: cols, cards: cards };
  }
  // The brief as one file to paste into any AI: what to do, the columns, the cards, and the answer it imports (a review).
  function briefText(brief) {
    var cols = brief.columns.filter(function (b) { return b.id !== 'unsorted'; }).map(function (b) {
      return '- `' + b.id + '`: ' + b.name + (b.about ? ', ' + b.about : '') + (b.subLabels ? ' (takes a sub-label per company or topic)' : '');
    });
    var cards = brief.cards.map(function (c) {
      return JSON.stringify({ key: c.key, card: c.title, now: c.column, because: c.why, threads: c.threads, from: c.from, subjects: c.subjects.slice(0, 3), newest: c.newest, ids: c.ids.slice(0, 3) });
    });
    return ['# Labelboard: place these cards', '',
      'You are helping sort a Gmail inbox with Labelboard. Each card is a rule (a sender, a domain, a company, a subject rule) that groups email threads.',
      'Each column becomes a Gmail label. Put each card in the column its mail is about: what the mail is about beats who sent it (a lawyer writing about a client goes with that client).',
      'Leave a card out when you are unsure; it stays where it is. Below are senders, subjects and the first line of each card\'s newest email.',
      'If you can read this Gmail account (a Gmail connector), `ids` are Gmail thread ids to open when a card is unclear.', '',
      '## Columns', cols.join('\n'), '',
      '## Your answer',
      'Reply with one JSON block and nothing else. Use the card keys and column ids exactly as written here; `unsorted` is not a column to place into.',
      '`sublabel` is optional, only for a column that takes one. `why` is one short plain sentence the person will read on the card.', '',
      '```json', '{ "labelboard": "claude-review", "cards": { "<card key>": { "bucket": "<column id>", "sublabel": "<optional>", "why": "<one sentence>" } } }', '```', '',
      '## Cards (' + brief.cards.length + ', one per line)', '', '```json', cards.join('\n'), '```', ''].join('\n');
  }
  function hasBucket(config, id) {
    for (var i = 0, l = config.buckets || []; i < l.length; i++) if (l[i].id === id) return true;
    return false;
  }

  // ---------- columns that are gone ----------
  // Every place a column id lives in the settings, as { where, key, id }. remapBuckets rewrites all of them.
  function bucketRefs(config) {
    var out = [];
    Object.keys(config.cards || {}).forEach(function (k) { out.push({ where: 'cards', key: k, id: config.cards[k].bucket }); });
    Object.keys(config.threadOverrides || {}).forEach(function (k) { out.push({ where: 'threadOverrides', key: k, id: config.threadOverrides[k].bucket }); });
    Object.keys(config.threadVotes || {}).forEach(function (k) { out.push({ where: 'threadVotes', key: k, id: config.threadVotes[k].b }); });
    Object.keys(config.aliasBuckets || {}).forEach(function (k) { out.push({ where: 'aliasBuckets', key: k, id: config.aliasBuckets[k] }); });
    Object.keys(config.labelMap || {}).forEach(function (k) { if (config.labelMap[k]) out.push({ where: 'labelMap', key: k, id: config.labelMap[k] }); });
    ['topics', 'patterns', 'processes'].forEach(function (w) { (config[w] || []).forEach(function (x, i) { if (x.bucket) out.push({ where: w, key: i, id: x.bucket }); }); });
    (config.processes || []).forEach(function (p, i) { (p.from || []).forEach(function (f) { out.push({ where: 'processes.from', key: i, id: f }); }); });
    return out;
  }
  // Column ids the settings, contacts or cards still name but the board has no column for, with what names them:
  // [{ id, cards, refs: { cards: 3, threadVotes: 40, … }, seeds }]. Cards counts cards waiting in Unsorted for it.
  function orphans(config, built, seeds) {
    var by = {}, get = function (id) { return by[id] = by[id] || { id: id, cards: 0, refs: {}, seeds: 0 }; };
    bucketRefs(config).forEach(function (r) { if (!hasBucket(config, r.id)) { var o = get(r.id); o.refs[r.where] = (o.refs[r.where] || 0) + 1; } });
    (seeds || []).forEach(function (s) { if (s.bucket && !hasBucket(config, s.bucket)) get(s.bucket).seeds++; });
    ((built && built.cards) || []).forEach(function (c) { var p = placement(c, config); if (p.lost && c.threads.length) get(p.lost).cards++; });
    return Object.keys(by).map(function (id) { return by[id]; });
  }
  // map: { oldId: newId }. A copy of config with every reference moved. A placement sent to Unsorted is
  // dropped (the card's own suggestion takes over); a sub-label only survives into a column that has them.
  function remapBuckets(config, map) {
    var c = clone(config), to = function (id) { return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : id; };
    var subs = {}; (c.buckets || []).forEach(function (b) { subs[b.id] = !!b.subLabels; });
    ['cards', 'threadOverrides'].forEach(function (w) {
      Object.keys(c[w] || {}).forEach(function (k) {
        var p = c[w][k], n = to(p.bucket); if (n === p.bucket) return;
        if (w === 'cards' && n === 'unsorted') { delete c[w][k]; return; }
        p.bucket = n; if (!subs[n]) delete p.sublabel;
      });
    });
    Object.keys(c.threadVotes || {}).forEach(function (k) { c.threadVotes[k].b = to(c.threadVotes[k].b); });
    ['aliasBuckets', 'labelMap'].forEach(function (w) { Object.keys(c[w] || {}).forEach(function (k) { if (c[w][k]) c[w][k] = to(c[w][k]); }); });
    ['topics', 'patterns', 'processes'].forEach(function (w) { (c[w] || []).forEach(function (x) { if (x.bucket) x.bucket = to(x.bucket); }); });
    (c.processes || []).forEach(function (p) { if (p.from) p.from = p.from.map(to).filter(function (f, i, all) { return all.indexOf(f) === i; }); });
    return c;
  }
  function remapSeeds(seeds, map) {
    return (seeds || []).map(function (s) { return Object.prototype.hasOwnProperty.call(map, s.bucket) ? Object.assign({}, s, { bucket: map[s.bucket] }) : s; });
  }
  function bucketById(config) {
    var m = {};
    (config.buckets || []).forEach(function (b) { m[b.id] = b; });
    return m;
  }
  // Where one email already in the inbox goes instead of its card's bucket: your own move first,
  // then a confident AI read that disagrees with the card. Future mail only ever follows the rules.
  // buckets (optional): bucketById(config), when a loop has it already.
  function threadMove(id, built, config, cardByKey, buckets) {
    var o = (config.threadOverrides || {})[id];
    if (o) return { bucket: o.bucket, sublabel: o.sublabel || null, by: 'you' };
    var v = (config.threadVotes || {})[id], k = (built.threadCards[id] || [])[0];
    // never into Calendar: an invitation still needs an answer, only bare accept/decline notices go there
    if (!v || v.c !== 'high' || v.b === 'calendar' || !k || !(buckets || bucketById(config))[v.b]) return null;
    var c = cardByKey ? cardByKey[k] : built.cards.filter(function (x) { return x.key === k; })[0];
    if (!c || placement(c, config).bucket === v.b) return null;
    // between a topic's own bucket and its process bucket, it keeps the topic: Clients/Retail/Acme ⇄ Legal/Acme
    var sub = c.parent && c.parent.bucket === v.b ? c.parent.sublabel
      : c.kind === 'entity' && c.seed && (config.processes || []).some(function (p) { return p.bucket === v.b && (p.from || []).indexOf(c.seed.bucket) >= 0; }) ? c.title : null;
    return { bucket: v.b, sublabel: sub || null, by: 'ai' };
  }
  // Gmail applies every matching filter: a thread gets the union of its cards' labels and
  // leaves the inbox if any of its buckets archives. Counts per card use the primary card only.
  // gmail: the ownedLabels (optional). apply: what Apply changes, thread by thread (threadChange), and how many
  // inbox threads Gmail already has sorted the way the board says (a label and nothing to change).
  function stats(snapshot, built, config, gmail) {
    var ctx = placeCtx(built, config), owned = resortable(gmail);
    var inbox = snapshot.threads.filter(function (t) { return t.labels.indexOf('INBOX') >= 0; });
    var after = { inbox: 0, byBucket: {}, archivedByBucket: {}, unsortedInInbox: 0 }, apply = { byThread: {}, threads: 0, add: 0, leave: 0, off: 0, sorted: 0 };
    inbox.forEach(function (t) {
      var pl = threadPlace(t, built, config, ctx), pb = pl.bucket, ch = threadChange(t, pl, owned);
      after.byBucket[pb] = (after.byBucket[pb] || 0) + 1;
      if (pl.leaves) after.archivedByBucket[pb] = (after.archivedByBucket[pb] || 0) + 1;
      else after.inbox++;
      if (!pl.labelled && pb === 'unsorted') after.unsortedInInbox++;
      if (ch) { apply.byThread[t.id] = ch; apply.threads++; if (ch.add.length) apply.add++; if (ch.leaves) apply.leave++; if (ch.off.length) apply.off++; if (ch.read) apply.read = (apply.read || 0) + 1; }
      else if (pl.labelled) apply.sorted++;
    });
    return { before: { inbox: inbox.length, threads: snapshot.threads.length }, after: after, apply: apply };
  }
  // Labels re-sorting may take off inbox threads: Labelboard's own, not labels of yours it took as they are (adoptedLabels):
  // those carry mail no card gives, and would all come off.
  function resortable(gmail) {
    var adopted = (gmail && gmail.adoptedLabels) || [];
    return ((gmail && gmail.ownedLabels) || []).filter(function (l) { return adopted.indexOf(l) < 0; });
  }
  // pf (optional): planFilters(built, config), when the caller has it already
  function placeCtx(built, config, pf) {
    pf = pf || planFilters(built, config);
    var cardByKey = {}, groups = pf.groups, gl = Object.keys(groups).map(function (k) { return groups[k]; });
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    return { buckets: bucketById(config), cardByKey: cardByKey, groups: gl, matches: groupMatcher(gl), people: pf.people, does: Object.create(null) };
  }
  // Where one inbox thread ends up after sorting: its column (primary card's, or its own move), the labels
  // it gets, whether it leaves the inbox. Stats and the plan's backfill both read this, so what the board
  // counts is what Apply does. ctx (optional) is placeCtx(), so a loop builds it once. of: label → its column.
  // Mail already here gets skip inbox and mark as read (delete skips the inbox); star, important and delete are
  // for new mail only. acts: label → 'a' / 'r' / 'ar', the label whose filter does it.
  function threadPlace(t, built, config, ctx) {
    ctx = ctx || placeCtx(built, config);
    var buckets = ctx.buckets, keys = built.threadCards[t.id] || [], archived = false, read = false, primaryBucket = null, labels = [], of = {}, acts = {};
    var give = function (b, name, a) {
      if (labels.indexOf(name) < 0) { labels.push(name); of[name] = b; }
      if (!a) return;
      var cur = acts[name] || '';
      if ((a.archive || a.trash) && cur.indexOf('a') < 0) { cur = 'a' + cur; archived = true; }
      if (a.read && cur.indexOf('r') < 0) { cur += 'r'; read = true; }
      if (cur) acts[name] = cur;
    };
    var done = function (moved) { return { card: keys[0] || null, bucket: primaryBucket || 'unsorted', labelled: labels.length > 0, labels: labels, of: of, leaves: archived, reads: read, acts: acts, moved: moved }; };
    var o = threadMove(t.id, built, config, ctx.cardByKey, buckets);
    if (o) { // a per-thread decision replaces the rules for mail already in the inbox
      var ob = buckets[o.bucket];
      primaryBucket = ob ? ob.id : null;
      if (ob && ob.label) { give(ob, ob.label, colActs(ob)); if (o.sublabel) give(ob, labelName(ob, o.sublabel)); }
      return done(o.by);
    }
    // the primary card always sorts mail already here, even with no rule for new mail (context)
    var c = keys.length && ctx.cardByKey[keys[0]], p = c && placement(c, config), b = p && buckets[p.bucket];
    if (c) primaryBucket = b ? b.id : null;
    if (b && b.label) {
      var d = ctx.does[c.key] = ctx.does[c.key] || cardDoes(c, config, b);
      give(b, b.label, d.extra && whenMatches(d.when, t) ? d.extra : d.base);
      if (p.sublabel) give(b, labelName(b, p.sublabel));
    }
    // then every Gmail filter that matches it, as Gmail runs them all: a secondary card only through its filter
    ctx.matches(t).forEach(function (hit, i) { var g = ctx.groups[i]; if (hit) give(buckets[g.bucket], g.label, g); });
    // and every colleague card's hourly rule it fits, as that run would label it
    var who = ctx.people.length ? whoIsOn(t, config) : '';
    ctx.people.forEach(function (r) {
      if (r.side !== who) return;
      give(buckets[r.bucket], r.labels[0], r.extra && whenMatches(r.when, t) ? r.extra : r.base);
      if (r.labels[1]) give(buckets[r.bucket], r.labels[1]);
    });
    return done(null);
  }
  // What Apply changes on one inbox thread, against the labels Gmail has on it now: null when nothing.
  // owned: names of the labels Labelboard created (gmail.ownedLabels); only those ever come off.
  function threadChange(t, pl, owned) {
    if (t.labels.indexOf('INBOX') < 0) return null; // Apply sorts the inbox only
    var add = pl.labels.filter(function (l) { return t.labels.indexOf(l) < 0; });
    var off = (owned || []).filter(function (l) { return t.labels.indexOf(l) >= 0 && pl.labels.indexOf(l) < 0; });
    var read = pl.reads && t.labels.indexOf('UNREAD') >= 0;
    if (!(add.length || off.length || pl.leaves || read)) return null;
    var ch = { add: add, off: off, leaves: pl.leaves };
    if (read) ch.read = true;
    return ch;
  }
  // A machine sender (no-reply, notifications, newsletters): the same test the suggestions use.
  function isMachine(email) { return AUTOMATED_LOCAL.test(localOf(email) + '@') || isAutomated(email); }

  // ---------- what a card does to its mail: Gmail's filter actions, a condition, archiving later ----------
  // A column sets skip inbox (archive) and mark as read for its cards; a card (config.cards[key].act) sets either
  // way, plus star, important ('always' | 'never') and delete (trash). With a condition (`when`) a card's yeses only
  // run on mail that matches it; its noes always run. Why this shape: docs/CLAUDE-PROSE.md → Card actions.
  var ACTS = ['archive', 'read', 'star', 'important', 'trash'];
  function colActs(b) { return { archive: !!(b && b.archive), read: !!(b && b.read), star: false, important: '', trash: false }; }
  function isOn(v) { return v === true || v === 'always' || v === 'never'; }
  // { base, extra, when, later }: base runs on all its mail, extra (base plus the card's own yeses) where `when` matches
  function cardDoes(c, config, b) {
    var own = (config.cards || {})[c.key] || {}, act = own.act || {}, when = whenOf(own.when), base = colActs(b), add = null;
    ACTS.forEach(function (k) {
      var v = act[k]; if (v === undefined || v === null) return;
      if (when && isOn(v)) (add = add || {})[k] = v; else base[k] = v;
    });
    var later = ownsLeave(own) ? laterOf(own.later) : b && b.label && !b.archive ? laterOf(b.later) : null; // the column's, unless the card says when it leaves
    return { base: base, extra: add ? Object.assign({}, base, add) : null, when: add ? when : null, later: later };
  }
  // ---------- when mail leaves the inbox: one answer per column (b.archive, b.later), a card can give its own ----------
  // Keys: 'never', 'now' (Gmail skips the inbox), 'd<N>' (N days after it arrives), 'read' (once read). A card's ''
  // follows its column; its own answer is act.archive plus later ({off: true} when it doesn't archive later).
  function ownsLeave(own) { return !!own && (own.later != null || (own.act && own.act.archive != null)); }
  function laterKey(l) { return !l ? '' : l.read ? 'read' : 'd' + l.days; }
  function laterFromKey(v) { return v === 'read' ? { read: true } : /^d\d+$/.test(v || '') ? laterOf({ days: Number(v.slice(1)) }) : null; }
  function leavesOf(b) { return !b || !b.label ? '' : b.archive ? 'now' : laterKey(laterOf(b.later)) || 'never'; }
  function setLeaves(b, v) { b.archive = v === 'now'; var l = v === 'now' ? null : laterFromKey(v); if (l) b.later = l; else delete b.later; }
  function cardLeaves(own) { return !ownsLeave(own) ? '' : own.act && own.act.archive ? 'now' : laterKey(laterOf(own.later)) || 'never'; }
  function setCardLeaves(own, v) {
    own.act = own.act || {};
    if (!v) { delete own.act.archive; delete own.later; } else { own.act.archive = v === 'now'; own.later = (v !== 'now' && laterFromKey(v)) || { off: true }; }
    if (!Object.keys(own.act).length) delete own.act;
  }
  function actsSig(a, b) {
    var col = colActs(b);
    return !a || ACTS.every(function (k) { return (a[k] || false) === (col[k] || false); }) ? '' : '|' + ACTS.map(function (k) { return k[0] + (a[k] === true ? 1 : a[k] || 0); }).join('');
  }
  // A condition: { via: a group address it came through, notMe: not sent to you by name, att: has an attachment,
  // subject: [any of these phrases], except: [addresses, domains or subject words] }. null when it asks nothing.
  function whenOf(w) {
    if (!w) return null;
    var list = function (l) { return (l || []).map(function (x) { return String(x).trim(); }).filter(Boolean); };
    var o = { via: w.via ? addr(w.via) : '', notMe: !!w.notMe, att: !!w.att, subject: list(w.subject), except: list(w.except).map(function (x) { return addrish(x) ? x.toLowerCase() : x; }) };
    return o.via || o.notMe || o.att || o.subject.length || o.except.length ? o : null;
  }
  function addrish(x) { return /^[^\s@]*@?[^\s@]+\.[a-z]{2,}$/i.test(x) && !/\s/.test(x); }
  // On the board: t.dir (you were in To or Cc) and t.att (an attachment) come from the read; a thread read
  // before they existed doesn't meet a condition that needs them.
  function whenMatches(w, t) {
    if (!w) return true;
    if (w.via && !(anyAddr(t.to, w.via) || anyAddr(t.cc, w.via))) return false;
    if (w.notMe && t.dir !== 0) return false;
    if (w.att && t.att !== 1) return false;
    if (w.subject.length && !w.subject.some(function (s) { return phraseIn(t.subject, s); })) return false;
    return !w.except.some(function (x) { return addrish(x) ? termMatches({ field: 'participant', value: x }, t) : phraseIn(t.subject, x); });
  }
  // The same condition as Gmail search words, ANDed onto the card's query. me: your addresses (config.me).
  function whenQuery(w, me) {
    if (!w) return '';
    return [w.via && 'to:' + quoteIfNeeded(w.via), w.notMe && (me || []).map(function (a) { return '-to:' + quoteIfNeeded(addr(a)); }).join(' '), w.att && 'has:attachment',
      w.subject.length && '(' + w.subject.map(function (s) { return termQuery({ field: 'subject', value: s }); }).join(' OR ') + ')']
      .concat(w.except.map(function (x) { return addrish(x) ? '-from:' + quoteIfNeeded(x) + ' -to:' + quoteIfNeeded(x) : '-' + termQuery({ field: 'subject', value: x }); }))
      .filter(Boolean).join(' ');
  }
  // Archiving later, which Gmail filters can't: { days: N after it arrives } or { read: once read }. Labelboard's
  // hourly run does it (Code.js runLater), on the inbox only.
  function laterOf(l) {
    if (!l) return null;
    var d = Math.round(Number(l.days) || 0);
    return d > 0 ? { days: Math.min(d, 365) } : l.read ? { read: true } : null;
  }
  // The timed rules for Apply to hand the server, with the cards' own Gmail searches (their filter's terms: a contact
  // not placed yet has none, so it never archives mail it doesn't label). A card with its own timing, a condition or
  // process signals gets its own rule (id: card key); cards that follow their column share one (id: 'col:<id>').
  // A colleague card (no filter) archives only mail with its column's label (`label`, searched by id on the server).
  // The colleague cards' hourly labelling (peopleRules) rides in the same list. pf (optional): planFilters(), when the caller has it.
  function laterRules(built, config, pf) {
    var buckets = bucketById(config), out = [], cols = {}, order = [];
    built.cards.filter(function (c) { return c.kind !== 'firm'; }).concat(firmCards(built, config)).forEach(function (c) {
      var p = placement(c, config), b = buckets[p.bucket], d = cardDoes(c, config, b), firm = c.kind === 'firm', terms = !b ? [] : firm ? (b.label ? c.terms : []) : ruleTerms(c, p, b);
      if (!d.later || !(terms.length || firm && b.label) || b.id === 'unsorted') return;
      var own = (config.cards || {})[c.key] || {}, w = whenOf(own.when), must = c.must && c.must.length;
      if (firm) {
        var wq = w ? whenQuery(w, config.me) : '';
        out.push(Object.assign({ id: c.key, title: c.title, label: b.label, queries: terms.length ? chunkQueries(terms, 500).map(function (q) { return '(' + q + ')' + (wq ? ' ' + wq : ''); }) : [wq] }, d.later));
        return;
      }
      if (!ownsLeave(own) && !w && !must) {
        var g = cols[b.id]; if (!g) { g = cols[b.id] = { b: b, terms: [], seen: Object.create(null) }; order.push(b.id); }
        terms.forEach(function (t) { var k = t.field + ':' + t.value; if (!g.seen[k]) { g.seen[k] = true; g.terms.push(t); } });
        return;
      }
      var tail = (must ? ' (' + c.must.map(termQuery).join(' OR ') + ')' : '') + (w ? ' ' + whenQuery(w, config.me) : '');
      out.push(Object.assign({ id: c.key, title: c.title, queries: chunkQueries(terms, 500).map(function (q) { return '(' + q + ')' + tail; }) }, d.later));
    });
    order.forEach(function (id) {
      var g = cols[id];
      out.push(Object.assign({ id: 'col:' + id, title: g.b.name, queries: chunkQueries(g.terms, 500).map(function (q) { return '(' + q + ')'; }) }, laterOf(g.b.later)));
    });
    return out.concat(pf ? pf.people : peopleRules(built, config));
  }
  // ---------- the colleague cards' hourly labelling (Code.js runPeople_) ----------
  // One rule per colleague card in a labelled column: { id: 'who:<card key>', kind: 'people', side, title, bucket, labels
  // (column, sub-label), base / extra / when (cardDoes), firm, me, solo: its labels no Gmail filter gives, the only ones it takes off }.
  function peopleRules(built, config, filters) {
    var buckets = bucketById(config), gives = Object.create(null);
    (filters || planFilters(built, config).filters).forEach(function (f) { gives[f.label] = true; });
    return firmCards(built, config).map(function (c) {
      var p = placement(c, config), b = buckets[p.bucket];
      if (!b || !b.label) return null;
      var d = cardDoes(c, config, b), labels = [b.label].concat(p.sublabel ? [labelName(b, p.sublabel)] : []);
      return { id: 'who:' + c.key, kind: 'people', side: c.side, title: c.title, bucket: b.id, labels: labels, base: d.base, extra: d.extra, when: d.when,
        firm: (config.firmDomains || []).slice(), me: (config.me || []).map(addr), solo: labels.filter(function (l) { return !gives[l]; }) };
    }).filter(Boolean);
  }
  // What the hourly run does to one thread for one rule: labels and the card's actions when it fits and lacks a label
  // (labelled before, its actions ran then), its solo labels off when it no longer fits. owned: labels Labelboard may take
  // off (made by it, not handed over). → { add, remove } by label name ('INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'), or null.
  function peopleChange(r, t, owned) {
    if (whoIsOn(t, { me: r.me, firmDomains: r.firm }) !== r.side) {
      var off = r.solo.filter(function (l) { return t.labels.indexOf(l) >= 0 && owned.indexOf(l) >= 0; });
      return off.length ? { add: [], remove: off } : null;
    }
    var add = r.labels.filter(function (l) { return t.labels.indexOf(l) < 0; });
    if (!add.length) return null;
    var a = r.extra && whenMatches(r.when, t) ? r.extra : r.base, ch = { add: add, remove: [] };
    if (a.archive || a.trash) ch.remove.push('INBOX'); // never deleted: a colleague card has no Delete it
    if (a.read) ch.remove.push('UNREAD');
    if (a.star) ch.add.push('STARRED');
    if (a.important === 'always') ch.add.push('IMPORTANT'); else if (a.important === 'never') ch.remove.push('IMPORTANT');
    return ch;
  }
  // Every rule's change on one thread as one modify: a label a rule it fits gives stays on, whatever another takes off.
  function peopleChanges(rules, t, owned) {
    var add = [], remove = [], keep = [], put = function (list, l) { if (list.indexOf(l) < 0) list.push(l); };
    rules.forEach(function (r) {
      if (whoIsOn(t, { me: r.me, firmDomains: r.firm }) === r.side) r.labels.forEach(function (l) { put(keep, l); });
      var ch = peopleChange(r, t, owned); if (ch) { ch.add.forEach(function (l) { put(add, l); }); ch.remove.forEach(function (l) { put(remove, l); }); }
    });
    remove = remove.filter(function (l) { return keep.indexOf(l) < 0; });
    return add.length || remove.length ? { add: add, remove: remove } : null;
  }
  // A one-line idea for what a card could do, from its mail: none once the card does something of its own.
  // { text, act?, when?, later? }. Answered = a message of yours in it (the read's timeline).
  function actionHint(c, byId, config) {
    var own = (config.cards || {})[c.key];
    if (c.kind === 'firm' || own && (own.act || own.later || own.when)) return null;
    var ts = c.threads.map(function (id) { return byId[id]; }).filter(Boolean), n = ts.length;
    if (n < 3) return null;
    var answered = ts.some(function (t) { return (t.msgs || []).some(function (m) { return m[1]; }); });
    if (answered) return null;
    var best = null, most = 0;
    if (c.kind !== 'alias') (config.aliases || []).map(addr).forEach(function (a) {
      var k = ts.filter(function (t) { return anyAddr(t.to, a) || anyAddr(t.cc, a); }).length;
      if (k > most) { most = k; best = a; }
    });
    if (best && most / n >= 0.6) return { text: ofThese(most, n) + ' came through ' + best + ' and you answered none. Skip the inbox when it comes that way?', act: { archive: true }, when: { via: best } };
    var machine = ts.filter(function (t) { return isMachine(t.from); }).length, unread = ts.filter(function (t) { return t.labels.indexOf('UNREAD') >= 0; }).length;
    var col = bucketById(config)[placement(c, config).bucket];
    if (col && (col.archive || laterOf(col.later))) return null; // its column already takes it out of the inbox
    if (machine / n >= 0.8 && unread / n >= 0.6) return { text: 'Sent by a machine, and you left ' + ofThese(unread, n) + ' unread. Archive it 3 days after it arrives?', later: { days: 3 } };
    return null;
  }

  // ---------- plan: labels, filters, backfill ----------
  function labelName(b, sublabel) { return sublabel ? b.label + '/' + sublabel : b.label; }

  // gmail (optional): { ownedLabels } from the server, so mail already labelled can be re-sorted.
  function buildPlan(snapshot, built, config, seeds, gmail) {
    var pf = planFilters(built, config), labels = pf.labels, filters = pf.filters, ctx = placeCtx(built, config, pf);
    // Backfill = the threads already in the inbox, each with threadPlace's labels (a per-thread decision wins,
    // then the primary card and every matching filter). The server labels these exact thread ids.
    var inbox = snapshot.threads.filter(function (t) { return t.labels.indexOf('INBOX') >= 0; });
    // One entry per label and what it does (skip inbox, mark as read): "\u0000" keeps entries in label order.
    var byLabel = {}, has = Object.create(null), named = Object.create(null); // has[label][thread id]: put() already sent it
    labels.forEach(function (l) { named[l.name] = true; });
    function put(name, b, acts, id) {
      var k = acts ? name + '\u0000' + acts : name;
      if (!byLabel[k]) {
        byLabel[k] = { label: name, archive: acts.indexOf('a') >= 0, threadIds: [] };
        if (acts.indexOf('r') >= 0) byLabel[k].read = true;
        if (!named[name]) { named[name] = true; labels.push({ name: name, color: labelColor(name, config) }); }
      }
      byLabel[k].threadIds.push(id); (has[name] = has[name] || Object.create(null))[id] = true;
    }
    function got(name, id) { return !!(has[name] && has[name][id]); }
    inbox.forEach(function (t) {
      var pl = threadPlace(t, built, config, ctx);
      pl.labels.forEach(function (name) { put(name, pl.of[name], pl.acts[name] || '', t.id); });
    });
    var backfill = Object.keys(byLabel).sort().map(function (n) { return byLabel[n]; });
    // Re-sort: a label Labelboard created that a thread carries but the board no longer gives it comes off
    // (a card moved, a column renamed). Labels you made are never taken off.
    var owned = resortable(gmail), off = {}, isOwned = Object.create(null);
    owned.forEach(function (l) { isOwned[l] = true; });
    if (owned.length) inbox.forEach(function (t) {
      t.labels.forEach(function (l) {
        if (isOwned[l] === true && !got(l, t.id)) (off[l] = off[l] || { label: l, threadIds: [] }).threadIds.push(t.id);
      });
    });
    withParents(labels, config).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { labels: labels, filters: filters, backfill: backfill, unlabel: Object.keys(off).sort().map(function (l) { return off[l]; }), later: laterRules(built, config, pf) };
  }
  // The mail cards are built from: the inbox, plus the window's threads someone else wrote in (recent: the window blob).
  function mailOf(snapshot, recent) {
    var out = recent ? recent.threads.filter(function (t) { return !t.msgs || t.msgs.some(function (m) { return !m[1]; }); }) : [];
    return { threads: snapshot.threads.concat(out) };
  }
  // The backfill as Apply sends it: only what Gmail doesn't have yet. A thread that has the label and stays in the inbox is
  // left alone; a mark-as-read entry keeps the unread ones (`unread`); `had`: threads of a skip-inbox or mark-read label that
  // carry it already, so an undo leaves their label on. byId: thread id → record.
  function trimBackfill(backfill, byId) {
    return backfill.map(function (e) {
      var has = function (id) { return byId[id].labels.indexOf(e.label) >= 0; };
      var unread = e.read ? e.threadIds.filter(function (id) { return byId[id].labels.indexOf('UNREAD') >= 0; }) : [];
      var o = Object.assign({}, e, { threadIds: e.threadIds.filter(function (id) { return e.archive || !has(id) || unread.indexOf(id) >= 0; }), had: e.archive || e.read ? e.threadIds.filter(has) : [] });
      if (e.read) o.unread = unread;
      return o;
    }).filter(function (e) { return e.threadIds.length; });
  }
  // A short fingerprint of the settings an Apply sent: view picks (ui) and one-shot hand-backs and restores left out.
  function settingsKey(config) {
    var s = JSON.stringify(config, function (k, v) { return this === config && (k === 'ui' || k === 'release' || k === 'restoreFilters') ? undefined : v; }), x = 5381;
    for (var i = 0; i < s.length; i++) x = (x * 33 + s.charCodeAt(i)) >>> 0;
    return x.toString(36) + '.' + s.length;
  }
  // What Labelboard applies on its own after a read on its own (config.auto.apply), when the settings are the ones last
  // applied: the plan Review would send, so the only news is what the rules placed (new senders' filters, labels on new
  // inbox mail). Nothing that only you start: no label taken off a thread, moved, handed over or adopted.
  function autoPlan(snapshot, recent, config, seeds, gmail) {
    var mail = mailOf(snapshot, recent), byId = {}, plan = buildPlan(snapshot, buildCards(mail, config, seeds), config, seeds, gmail);
    mail.threads.forEach(function (t) { byId[t.id] = t; });
    return Object.assign(plan, { backfill: trimBackfill(plan.backfill, byId), unlabel: [], moves: [], handover: [], adoptLabels: [], recolor: [], adopt: [], release: [], restore: [],
      settings: settingsKey(config), auto: true });
  }
  // What a card puts in its column's filter: nothing for unsorted / keep-in-inbox / unplaced context.
  // A counterparty's domain also sends its product mail (Microsoft 365): until you place the card,
  // only its known people (exact addresses) become a rule.
  function ruleTerms(c, p, b) {
    if (!writesFilter(c, p, b)) return [];
    return c.role === 'counterparty' && !p.decided ? c.terms.filter(function (t) { return t.value.indexOf('@') >= 0; }) : c.terms;
  }
  // Why a card writes no filter for new mail: 'column' (no label), 'hourly' (a colleague card: labelled every hour),
  // 'context' (a contact not placed yet), 'people' (a company not placed yet, with no known person to match); null when it writes one.
  function noFilterWhy(c, config) {
    var p = placement(c, config), b = bucketById(config)[p.bucket];
    if (!(b && b.label)) return 'column';
    if (c.kind === 'firm') return 'hourly';
    if (!writesFilter(c, p, b)) return 'context';
    return ruleTerms(c, p, b).length ? null : 'people';
  }
  // The labels and filters for new mail alone, without the inbox backfill: cheap enough to run on every move.
  function planFilters(built, config) {
    var buckets = bucketById(config);
    // group key -> { label, bucket, terms, must?, archive, cards }. A card with `must` (topic AND a
    // process signal) can't share an OR-list with other cards, so it gets its own group under the same label.
    var groups = {}, seen = Object.create(null); // seen[group key][field][value]: a term the group has
    // the group's terms gain the card's (each once), the card joins it. acts: what the filter does besides the
    // label (null: label only); cards that do something else than their column, or ask a condition, get their own.
    function group(name, b, acts, own, c, terms, when) {
      var wq = when ? whenQuery(when, config.me) : '', gk = name + actsSig(acts, b) + (wq ? '?' + wq : '') + (own ? '#' + own.key : '');
      if (!groups[gk]) {
        groups[gk] = { label: name, bucket: b.id, color: b.color, archive: !!(acts && acts.archive), skipAutomated: skipsAutomated(b), terms: [], must: own ? own.must : null, cards: [] };
        if (acts) ['read', 'star', 'important', 'trash'].forEach(function (k) { if (acts[k]) groups[gk][k] = acts[k]; });
        if (when) { groups[gk].when = when; groups[gk].whenQuery = wq; }
        seen[gk] = Object.create(null);
      }
      terms.forEach(function (t) {
        var f = seen[gk][t.field] = seen[gk][t.field] || Object.create(null);
        if (!f[t.value]) { f[t.value] = true; groups[gk].terms.push(t); }
      });
      groups[gk].cards.push(c.key);
    }
    allCards(built, config).forEach(function (c) {
      var p = placement(c, config), b = buckets[p.bucket], terms = ruleTerms(c, p, b);
      if (!terms.length) return;
      var own = c.must && c.must.length ? c : null, d = cardDoes(c, config, b);
      group(b.label, b, d.base, own, c, terms);
      if (d.extra) group(b.label, b, d.extra, own, c, terms, d.when); // the card's yeses, on mail matching its condition
      // A topic sub-label only once it has mail: 120 empty labels are clutter, the parent rule still covers them.
      if (p.sublabel && c.threads.length + c.also > 0) group(labelName(b, p.sublabel), b, null, own, c, terms);
    });
    var labels = [], filters = [];
    Object.keys(groups).sort().forEach(function (gk) {
      var g = groups[gk];
      if (!labels.some(function (l) { return l.name === g.label; })) labels.push({ name: g.label, color: labelColor(g.label, config) });
      groupQueries(g).forEach(function (q, i) {
        var f = { id: 'mb:' + gk + ':' + i, label: g.label, bucket: g.bucket, query: q, archive: g.archive };
        ['read', 'star', 'important', 'trash'].forEach(function (k) { if (g[k]) f[k] = g[k]; });
        filters.push(f);
      });
    });
    // Filters you handed over (config.adopted): written exactly as kept, so an unchanged one stays put in Gmail.
    // They label new mail only; what they match in the inbox shows on their card, not in the backfill.
    Object.keys(config.adopted || {}).forEach(function (id) {
      var a = config.adopted[id], b = bucketOfLabel(a.label, config);
      if (a.off || !a.query || !a.label) return;
      filters.push({ id: 'adopted:' + id, label: a.label, bucket: b ? b.id : null, query: a.query, archive: !!a.archive });
      if (!labels.some(function (l) { return l.name === a.label; })) labels.push({ name: a.label, color: labelColor(a.label, config) });
    });
    // the colleague cards' labels, which no filter makes
    var people = peopleRules(built, config, filters);
    people.forEach(function (r) { r.labels.forEach(function (n) { if (!labels.some(function (l) { return l.name === n; })) labels.push({ name: n, color: labelColor(n, config) }); }); });
    return { labels: withParents(labels, config), filters: filters, groups: groups, people: people };
  }
  // Seeded entities that have no mail yet count too: future mail is the point.
  function allCards(built, config) {
    var all = built.cards.slice(), isCard = Object.create(null);
    all.forEach(function (c) { isCard[c.key] = true; });
    Object.keys(built.entities || {}).forEach(function (k) {
      if (!isCard[k]) {
        var e = clone(built.entities[k]); e.threads = []; e.also = 0; e.suggestion = suggest(e, {}, config); all.push(e);
      }
    });
    return all;
  }
  // Folders in between (`_Portfolio/Fund I` for `_Portfolio/Fund I/Acme`) are labels Gmail makes too: they get their colour here.
  function withParents(labels, config) {
    var named = Object.create(null);
    labels.forEach(function (l) { named[l.name] = true; });
    labels.slice().forEach(function (l) {
      var p = l.name.split('/');
      for (var i = p.length - 1; i > 0; i--) {
        var n = p.slice(0, i).join('/');
        if (!named[n] && bucketOfLabel(n, config)) { named[n] = true; labels.push({ name: n, color: labelColor(n, config) }); }
      }
    });
    return labels;
  }

  // ---------- label colours ----------
  // Gmail takes label colours from its palette only, 8 × 8: row 0 greys; in rows 1–7 each column is one hue,
  // row 2 its lightest and row 7 its darkest.
  var PALETTE = ['#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#f3f3f3', '#ffffff',
    '#fb4c2f', '#ffad47', '#fad165', '#16a766', '#43d692', '#4a86e8', '#a479e2', '#f691b3',
    '#f6c5be', '#ffe6c7', '#fef1d1', '#b9e4d0', '#c6f3de', '#c9daf8', '#e4d7f5', '#fcdee8',
    '#efa093', '#ffd6a2', '#fce8b3', '#89d3b2', '#a0eac9', '#a4c2f4', '#d0bcf1', '#fbc8d9',
    '#e66550', '#ffbc6b', '#fcda83', '#44b984', '#68dfa9', '#6d9eeb', '#b694e8', '#f7a7c0',
    '#cc3a21', '#eaa041', '#f2c960', '#149e60', '#3dc789', '#3c78d8', '#8e63ce', '#e07798',
    '#ac2b16', '#cf8933', '#d5ae49', '#0b804b', '#2a9c68', '#285bac', '#653e9b', '#b65775',
    '#822111', '#a46a21', '#aa8831', '#076239', '#1a764d', '#1c4587', '#41236d', '#83334c'];
  function rgbOf(hex) { var c = String(hex || '').replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(c.substr(i, 2), 16) || 0; }); }
  // The palette entry closest to a colour (Gmail also keeps a few older colours outside the palette, such as #c2c2c2).
  function paletteIndex(hex) {
    var i = PALETTE.indexOf(String(hex || '').toLowerCase()); if (i >= 0) return i;
    var c = rgbOf(hex), best = 0, d = Infinity;
    PALETTE.forEach(function (p, j) { var q = rgbOf(p), e = Math.pow(q[0] - c[0], 2) + Math.pow(q[1] - c[1], 2) + Math.pow(q[2] - c[2], 2); if (e < d) { d = e; best = j; } });
    return best;
  }
  // A sub-label's colour: its column's hue at its lightest, with the darkest as text (a grey column: light grey).
  function shadeOf(color) {
    if (!color || !color.backgroundColor) return null;
    var i = paletteIndex(color.backgroundColor), col = i % 8;
    return i < 8 ? { backgroundColor: '#efefef', textColor: '#434343' } : { backgroundColor: PALETTE[16 + col], textColor: PALETTE[56 + col] };
  }
  // The colour a label gets in Gmail: the column's own label its colour, everything under it the light shade.
  function labelColor(name, config) {
    var b = bucketOfLabel(name, config);
    return !b || !b.color ? null : name === b.label ? b.color : shadeOf(b.color);
  }
  // The column a Gmail label belongs to: its own label or one under it.
  function bucketOfLabel(name, config) {
    return (config.buckets || []).filter(function (b) { return b.label && (name === b.label || String(name).indexOf(b.label + '/') === 0); })[0] || null;
  }
  function skipsAutomated(b) { return b.skipAutomated !== undefined ? !!b.skipAutomated : !b.archive; }
  var EXCLUDE_AUTOMATED = '-from:(' + AUTOMATED_TOKENS.map(quoteIfNeeded).join(' OR ') + ')';
  // Terms in a fixed order, not card order: cards sort by size, and Apply itself changes sizes (mail leaves the
  // inbox), so a query in card order would read as changed after every Apply and be made again.
  function groupQueries(g) {
    var must = (g.must && g.must.length ? ' (' + g.must.map(termQuery).join(' OR ') + ')' : '') + (g.whenQuery ? ' ' + g.whenQuery : '');
    var terms = g.terms.map(function (t) { return [termQuery(t), t]; })
      .sort(function (a, z) { return a[0] < z[0] ? -1 : a[0] > z[0] ? 1 : 0; }).map(function (x) { return x[1]; });
    return chunkQueries(terms, must ? 500 : 800).map(function (q) {
      var base = must || g.skipAutomated ? '(' + q + ')' + must : q;
      return g.skipAutomated ? base + ' ' + EXCLUDE_AUTOMATED : base;
    });
  }
  // Which groups a thread matches (Gmail: every filter whose terms OR must, unless it skips automated mail).
  // For the backfill's threads × groups: every group's terms in one index, term → group numbers (termIndex),
  // and per thread only its own addresses, domain suffixes and subject words are looked up (termHits).
  function groupMatcher(groups) {
    var terms = termIndex(), must = termIndex();
    groups.forEach(function (g, i) { indexTerms(terms, g.terms, i); if (g.must && g.must.length) indexTerms(must, g.must, i); });
    return function (t) {
      var v = threadView(t), hits = termHits(terms, v), musts = termHits(must, v), auto = null;
      return groups.map(function (g, i) {
        if (!hits[i] || (g.must && g.must.length && !musts[i]) || (g.when && !whenMatches(g.when, t))) return false;
        return !(g.skipAutomated && (auto === null ? auto = isAutomated(t.from) : auto));
      });
    };
  }
  function termIndex() {
    var m = function () { return { at: Object.create(null), dom: Object.create(null) }; };
    return { from: m(), participant: m(), recipient: m(), subject: Object.create(null) };
  }
  function indexTerms(ix, terms, i) {
    var push = function (m, k, x) { (m[k] = m[k] || []).push(x); };
    terms.forEach(function (t) {
      var p = t.field === 'subject' && tokens(t.value); // an empty phrase never matches
      if (p) push(ix.subject, firstWord(p), [i, p]);
      else if (t.field === 'from' || t.field === 'participant' || t.field === 'recipient') push(ix[t.field][t.value.indexOf('@') >= 0 ? 'at' : 'dom'], t.value, i);
    });
  }
  function firstWord(p) { var i = p.indexOf(' '); return i < 0 ? p : p.slice(0, i); }
  // A thread's subject tokens and its distinct words: a phrase can only match where its first word is a word.
  function subjectView(subject) {
    var tok = tokens(subject), seen = Object.create(null);
    return { tok: tok, words: tok.split(' ').filter(function (w) { return !seen[w] && (seen[w] = true); }), has: seen };
  }
  function threadView(t) {
    var view = function (e) { return e ? { e: e, s: suffixes(domainOf(e)) } : null; }, rc = [];
    [t.to, t.cc].forEach(function (l) { for (var i = 0; i < (l || []).length; i++) if (l[i]) rc.push(view(l[i])); });
    return { from: view(t.from), rc: rc, subject: subjectView(t.subject) };
  }
  // hits[group number] = true for every group with a term matching thread view v
  function termHits(ix, v) {
    var hits = [], mark = function (l) { for (var i = 0; l && i < l.length; i++) hits[l[i]] = true; };
    var addr = function (a, m) { if (!a) return; mark(m.at[a.e]); for (var i = 0; i < a.s.length; i++) mark(m.dom[a.s[i]]); };
    addr(v.from, ix.from); addr(v.from, ix.participant);
    v.rc.forEach(function (a) { addr(a, ix.recipient); addr(a, ix.participant); });
    v.subject.words.forEach(function (w) {
      (ix.subject[w] || []).forEach(function (x) { if (!hits[x[0]] && hasPhrase(v.subject.tok, x[1])) hits[x[0]] = true; });
    });
    return hits;
  }

  // gmailctl-style diff: only filters this tool owns are ever deleted.
  function diffFilters(planFilters, existing) {
    var key = function (f) { return f.query + '|' + (f.label || '') + '|' + (f.archive ? 1 : 0); };
    var have = {}, want = {};
    (existing || []).forEach(function (f) { have[key(f)] = f; });
    planFilters.forEach(function (f) { want[key(f)] = f; });
    return {
      create: planFilters.filter(function (f) { return !have[key(f)]; }),
      keep: planFilters.filter(function (f) { return have[key(f)]; }),
      remove: (existing || []).filter(function (f) { return f.owned && !want[key(f)]; }),
    };
  }

  // Fallback when Apps Script is unavailable: Gmail Settings → Filters → Import filters.
  function toGmailXml(plan, author) {
    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); };
    var now = new Date().toISOString();
    var entries = plan.filters.map(function (f, i) {
      return '<entry><category term="filter"></category><title>Mail Filter</title><id>tag:mail.google.com,2008:filter:mb' + i + '</id><updated>' + now + '</updated><content></content>' +
        "<apps:property name='hasTheWord' value='" + esc(f.query) + "'/>" +
        "<apps:property name='label' value='" + esc(f.label) + "'/>" +
        (f.archive ? "<apps:property name='shouldArchive' value='true'/>" : '') + (f.read ? "<apps:property name='shouldMarkAsRead' value='true'/>" : '') +
        (f.star ? "<apps:property name='shouldStar' value='true'/>" : '') + (f.trash ? "<apps:property name='shouldTrash' value='true'/>" : '') +
        (f.important === 'always' ? "<apps:property name='shouldAlwaysMarkAsImportant' value='true'/>" : f.important === 'never' ? "<apps:property name='shouldNeverMarkAsImportant' value='true'/>" : '') + '</entry>';
    });
    return "<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'><title>Mail Filters</title><author><name>" + esc(author || 'Labelboard') + '</name></author>' + entries.join('') + '</feed>';
  }

  // ---------- your Gmail filters on the board ----------
  // Preview of a Gmail search on the snapshot, for the subset filters mostly use: from/to/cc/subject/label/
  // in:inbox, OR, -, ( ) and { }. Anything metadata can't answer (a body word, list:, has:) gives null.
  function parseQuery(q) {
    var toks = [], re = /\s*(?:("[^"]*")|([(){}])|(-)(?=\S)|([A-Za-z]+):|([^\s(){}"]+))/g, m, i = 0, ok = true;
    while ((m = re.exec(String(q || ''))) && m[0]) toks.push(m[1] ? { t: 'q', v: m[1].slice(1, -1) } : m[2] ? { t: 'p', v: m[2] } : m[3] ? { t: '-' } : m[4] ? { t: 'f', v: m[4].toLowerCase() } : { t: 'w', v: m[5] });
    var no = function () { return false; }, is = function (k, v) { return k && k.t === 'p' && k.v === v; };
    var all = function (ps) { return function (t) { return ps.every(function (p) { return p(t); }); }; };
    var any = function (ps) { return function (t) { return ps.some(function (p) { return p(t); }); }; };
    function seq(field, close) { // implicit AND, the loosest
      var ps = [];
      while (i < toks.length && !is(toks[i], close)) ps.push(or(field));
      i++;
      return all(ps);
    }
    function or(field) { // OR binds tighter than AND in Gmail
      var ps = [unary(field)];
      while (toks[i] && toks[i].t === 'w' && toks[i].v === 'OR') { i++; ps.push(unary(field)); }
      return any(ps);
    }
    function unary(field) {
      var k = toks[i++];
      if (!k) { ok = false; return no; }
      if (k.t === '-') { var x = unary(field); return function (t) { return !x(t); }; }
      if (is(k, '(')) return seq(field, ')');
      if (is(k, '{')) {
        var ps = [];
        while (i < toks.length && !is(toks[i], '}')) { if (toks[i].v === 'OR') i++; else ps.push(unary(field)); }
        i++;
        return any(ps);
      }
      if (k.t === 'p') { ok = false; return no; }
      if (k.t === 'f') return unary(k.v);
      if (k.t === 'w' && k.v === 'AND') return unary(field);
      return leaf(field, k.v);
    }
    // An address matcher, worked out once per search term: it runs for every thread (addrMatches and phraseIn, inlined)
    function who(v) {
      v = v.toLowerCase().replace(/^@/, '');
      if (v.indexOf('@') >= 0) return function (email) { return email === v; };
      var at = '@' + v, dot = '.' + v, p = tokens(v);
      if (v.indexOf('.') >= 0) return function (email) { return !!email && (endsWith(email, at) || endsWith(email, dot) && email.indexOf('@') >= 0); };
      return function (email, name) { return p.length > 0 && hasPhrase(tokens(email + ' ' + (name || '')), p); };
    }
    function anyOf(lists, m) { for (var i = 0; i < lists.length; i++) for (var j = 0; j < (lists[i] || []).length; j++) if (m(lists[i][j])) return true; return false; }
    function leaf(f, v) {
      switch (f) {
        case 'from': var m = who(v); return function (t) { return m(t.from, t.fromName); };
        case 'to': var mt = who(v); return function (t) { return anyOf([t.to, t.cc], mt); }; // to: covers Cc
        case 'cc': var mc = who(v); return function (t) { return anyOf([t.cc], mc); };
        case 'subject': return function (t) { return phraseIn(t.subject, v); };
        case 'label': return function (t) { return t.labels.some(function (l) { return tokens(l) === tokens(v); }); };
        case 'in': if (v.toLowerCase() === 'inbox') return function (t) { return t.labels.indexOf('INBOX') >= 0; };
      }
      ok = false; return no;
    }
    var fn = toks.length ? seq(null, null) : null;
    return ok ? fn : null;
  }
  // The board's view of Gmail filters it doesn't run: yours (read-only) and the ones you handed over
  // (config.adopted). For each: the threads it matches, inbox and archived alike, since your filters are what
  // archived much of that mail (null: can't preview), the board label those threads get from their own card
  // (overlap, by label), and why it can't be adopted, if it can't.
  function gmailFilters(gmail, snapshot, built, config) {
    var adopted = config.adopted || {}, buckets = bucketById(config), cardByKey = {};
    built.cards.forEach(function (c) { cardByKey[c.key] = c; });
    var boardLabel = function (id) { // the primary card's label, or the email's own move
      var o = threadMove(id, built, config, cardByKey), k = (built.threadCards[id] || [])[0], p = o || (k && cardByKey[k] ? placement(cardByKey[k], config) : null), b = p && buckets[p.bucket];
      return b && b.label ? labelName(b, p.sublabel) : null;
    };
    var live = (gmail && gmail.filters) || [];
    function view(f, a) {
      var m = parseQuery(f.query), threads = m ? snapshot.threads.filter(m).map(function (t) { return t.id; }) : null, over = {};
      (threads || []).forEach(function (t) { var l = boardLabel(t); if (l) over[l] = (over[l] || 0) + 1; });
      var label = a ? a.label : f.labels.join(', ');
      var inGmail = !a || live.some(function (g) { return g.query === a.query && g.labels.join(',') === a.label && g.archive === !!a.archive && !g.extras.length; });
      var pending = !!a && live.some(function (g) { return g.id === f.id && !g.owned; }); // adopted on the board, handed over on Apply
      return { id: f.id, query: f.query, label: label, archive: a ? !!a.archive : f.archive, extras: f.extras || [], adopted: a || null, inGmail: inGmail, pending: pending,
        threads: threads, overlap: over,
        why: a ? null : f.extras.length ? 'It also ' + f.extras.join(', ') + '. The board can only label and skip the inbox.'
          : f.labels.length !== 1 ? (f.labels.length ? 'It adds ' + f.labels.length + ' labels; the board writes one per filter.' : 'It adds no label.') : null };
    }
    return live.filter(function (f) { return !f.owned && !adopted[f.id]; }).map(function (f) { return view(f, null); })
      .concat(Object.keys(adopted).map(function (id) { var a = adopted[id]; return view({ id: id, query: a.query, labels: [a.label], archive: a.archive, extras: [] }, a); }));
  }
  // How old the snapshot is, in words. Stale after an hour: Apply sorts only what the read saw, and a
  // re-read takes seconds when little changed.
  function readAge(iso, now) {
    var min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000)), h = Math.round(min / 60), d = Math.round(min / 1440);
    var text = min < 1 ? 'just now' : min < 60 ? min + ' min ago' : min < 1440 ? h + ' hour' + (h > 1 ? 's' : '') + ' ago' : d + ' day' + (d > 1 ? 's' : '') + ' ago';
    return { minutes: min, text: text, stale: min > 60 };
  }

  return {
    addr: addr, domainOf: domainOf, addrMatches: addrMatches, phraseIn: phraseIn,
    labelMapOf: labelMapOf, bucketOfLabel: bucketOfLabel, bucketById: bucketById, labelName: labelName, allCards: allCards,
    PALETTE: PALETTE, rgbOf: rgbOf, paletteIndex: paletteIndex, shadeOf: shadeOf, labelColor: labelColor, parseQuery: parseQuery, gmailFilters: gmailFilters, readAge: readAge,
    termMatches: termMatches, termQuery: termQuery, chunkQueries: chunkQueries,
    buildCards: buildCards, suggest: suggest, bucketForLabel: bucketForLabel,
    cardDoes: cardDoes, colActs: colActs, whenOf: whenOf, whenMatches: whenMatches, whenQuery: whenQuery, laterOf: laterOf, laterRules: laterRules, actionHint: actionHint,
    whoIsOn: whoIsOn, peopleRules: peopleRules, peopleChange: peopleChange, peopleChanges: peopleChanges,
    leavesOf: leavesOf, setLeaves: setLeaves, cardLeaves: cardLeaves, setCardLeaves: setCardLeaves, laterKey: laterKey,
    mailOf: mailOf, trimBackfill: trimBackfill, settingsKey: settingsKey, autoPlan: autoPlan,
    placement: placement, mergeReview: mergeReview, reviewBrief: reviewBrief, briefText: briefText, orphans: orphans, remapBuckets: remapBuckets, remapSeeds: remapSeeds, threadMove: threadMove, threadPlace: threadPlace, threadChange: threadChange, placeCtx: placeCtx, isMachine: isMachine, stats: stats, buildPlan: buildPlan, planFilters: planFilters, noFilterWhy: noFilterWhy, diffFilters: diffFilters, toGmailXml: toGmailXml,
  };
})();
if (typeof module !== 'undefined') module.exports = LabelboardRules;
