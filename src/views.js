'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
 :root{--bg:#f6f7f9;--card:#fff;--text:#1d2129;--muted:#667085;--line:#e4e7ec;--ok:#067647;--bad:#b42318;--warn:#b54708}
 @media (prefers-color-scheme: dark){:root{--bg:#0f1115;--card:#171a21;--text:#e6e8ec;--muted:#98a2b3;--line:#2a2f3a;--ok:#47cd89;--bad:#f97066;--warn:#fdb022}}
 body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:24px}
 h1{font-size:20px} table{border-collapse:collapse;width:100%;background:var(--card);font-size:13px}
 th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
 th{color:var(--muted);font-weight:600} .wrap{overflow-x:auto}
 .success,.reconciled,.resolved{color:var(--ok);font-weight:600} .failed,.refused{color:var(--bad);font-weight:600}
 .ambiguous,.uncertain,.duplicate_skipped{color:var(--warn);font-weight:600}
 .post{max-width:560px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 16px}
 .who{font-weight:700} .meta{color:var(--muted);font-size:12px} .text{white-space:pre-wrap;margin-top:10px;line-height:1.45}
 a{color:inherit}
</style></head><body>${body}</body></html>`;

function historyPage(rows) {
  const tr = rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.created_at)}</td><td>${r.slot_id}</td><td>${r.variant_id}</td>
    <td>${esc(r.platform)}</td><td>${esc(r.adapter)}</td><td class="${esc(r.outcome)}">${esc(r.outcome)}</td>
    <td>${esc(r.detail)}</td><td>${r.external_url ? `<a href="${esc(r.external_url)}">open</a>` : ''}</td><td>${esc(r.worker)}</td></tr>`).join('');
  return page('Publish history', `<h1>Publish history</h1><div class="wrap"><table>
    <tr><th>#</th><th>When</th><th>Slot</th><th>Variant</th><th>Platform</th><th>Adapter</th><th>Outcome</th><th>Detail</th><th>Link</th><th>Worker</th></tr>
    ${tr || '<tr><td colspan="10">No attempts yet.</td></tr>'}</table></div>`);
}

function mockPostPage(adapter, posts) {
  const who = adapter === 'mock_linkedin' ? 'Studio Company Page · LinkedIn (mock)' : '@studio · X (mock)';
  const cards = posts.map((p) => `<div class="post"><div class="who">${esc(who)}</div>
    <div class="meta">mock post #${p.id} · ${esc(p.created_at)} · key ${esc(p.idempotency_key)}</div>
    <div class="text">${esc(p.text)}</div></div>`).join('');
  return page(`${adapter} preview`, `<h1>${esc(adapter)} — what would have been posted</h1>${cards || '<p>Nothing posted yet.</p>'}`);
}

module.exports = { historyPage, mockPostPage };
