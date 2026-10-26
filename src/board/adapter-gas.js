// Apps Script: every call goes through google.script.run to the functions in Code.js.
// Scan and apply run in short slices; these loops call again until the server says done,
// reporting { done, total, text } to onProgress after every slice.
window.LabelboardAPI = (function () {
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      r[fn].apply(r, args);
    });
  }
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  return {
    load: function () { return call('getState').then(JSON.parse); },
    saveConfig: function (config) { return call('saveConfig', JSON.stringify(config)); },
    saveSeeds: function (json) { return call('saveSeeds', json); },
    // opts: { window: true } turns the 30-day read back on; it is on by default
    refresh: function (onProgress, opts) {
      var o = JSON.stringify(opts || {});
      if (onProgress) onProgress({ done: 0, total: 0, text: 'Listing your inbox and the last 30 days of mail…' });
      function step(cursor) {
        return call('scanInbox', cursor || null, o).then(function (r) {
          if (onProgress) onProgress({ done: r.count, total: r.total, text: r.text || 'Reading your inbox: ' + fmt(r.count) + ' of ' + fmt(r.total) + ' threads' });
          return r.done ? r : step(r.next);
        });
      }
      return step(null);
    },
    windowOff: function () { return call('windowOff'); },
    // { label name: {threads, messages} } for your labels, for the Labels view
    counts: function () { return call('labelCounts').then(JSON.parse); },
    apply: function (plan, onProgress) {
      var json = JSON.stringify(plan);
      if (onProgress) onProgress({ done: 0, total: 1, text: 'Creating labels…' });
      function step(progress) {
        return call('applyPlan', json, progress || null).then(JSON.parse).then(function (r) {
          if (r.done) return r;
          if (onProgress) onProgress({ done: r.step, total: r.steps, text: r.text });
          return step(r.progress);
        });
      }
      return step(null);
    },
    // kind: 'last' (the last Apply) or 'all' (everything Labelboard made; keep = filter ids to hand back).
    // The server keeps the progress, so each call carries on where the last one stopped.
    undo: function (kind, keep, onProgress) {
      var k = JSON.stringify(keep || []);
      if (onProgress) onProgress({ done: 0, total: 1, text: kind === 'all' ? 'Removing what Labelboard made…' : 'Undoing the Apply…' });
      function step() {
        return call('applyUndo', kind, k).then(JSON.parse).then(function (r) {
          if (r.done) return r;
          if (onProgress) onProgress({ done: r.step, total: r.steps, text: r.text });
          return step();
        });
      }
      return step();
    },
  };
})();
