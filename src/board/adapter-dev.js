// Local preview: dev/serve.mjs serves files from the data folder; nothing reaches Gmail.
window.LabelboardAPI = {
  load: function () {
    return fetch('/api/state').then(function (r) { if (!r.ok) throw new Error(r.statusText); return r.json(); });
  },
  saveConfig: function (config) {
    return fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config, null, 1) })
      .then(function (r) { if (!r.ok) throw new Error(r.statusText); });
  },
  // Undo on the data folder's files (record.json), in one go: the server's plan, without Gmail.
  undo: function (kind, keep, onProgress) {
    if (onProgress) onProgress({ done: 0, total: 1, text: kind === 'all' ? 'Removing what Labelboard made…' : 'Undoing the Apply…' });
    return fetch('/api/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind, keep: keep || [] }) })
      .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || r.statusText); }); });
  },
};
