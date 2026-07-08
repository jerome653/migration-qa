'use strict';
// report-visual.js — renders the visual-match result as a self-contained HTML report.
const fs = require('fs');
const path = require('path');
const { STYLE, esc } = require('./report');

function bar(score) {
  const c = score >= 90 ? 'var(--pass)' : score >= 75 ? 'var(--warn)' : 'var(--fail)';
  return `<span class="vm-bar"><i style="width:${Math.max(2, score)}%;background:${c}"></i></span><b style="color:${c}">${score}%</b>`;
}

function vpBlock(v) {
  const s = v.struct;
  const chips = [];
  if (s.missing.length) chips.push(`<span class="vm-chip miss">${s.missing.length} missing</span>`);
  if (s.extra.length) chips.push(`<span class="vm-chip extra">${s.extra.length} extra</span>`);
  if (s.moved.length) chips.push(`<span class="vm-chip moved">${s.moved.length} moved</span>`);
  if (s.restyled.length) chips.push(`<span class="vm-chip style">${s.restyled.length} restyled</span>`);
  if (!chips.length) chips.push(`<span class="vm-chip ok">structure matches</span>`);
  const list = (title, arr, fn) => arr.length ? `<div class="vm-d"><span class="vm-dl">${title}</span><ul>${arr.slice(0, 40).map(fn).join('')}${arr.length > 40 ? `<li>+${arr.length - 40} more</li>` : ''}</ul></div>` : '';
  const elLbl = e => `${esc(e.tag)}${e.head ? ' · ' + esc(e.head) : ''}${e.text ? ' — "' + esc(e.text) + '"' : (e.src ? ' — ' + esc(e.src) : '')} <span class="vm-sec">[${esc(e.sec)}]</span>`;
  const shot = (label, rel) => rel ? `<figure><figcaption>${label}</figcaption><a href="${esc(rel)}" target="_blank"><img loading="lazy" src="${esc(rel)}"></a></figure>` : '';
  return `<details class="vm-vp"><summary><b>${esc(v.label)}</b> ${bar(v.matchScore || 0)}
    <span class="vm-meta">${v.pixelMismatchPct == null ? 'pixel n/a' : v.pixelMismatchPct + '% pixels differ'} · ${s.matched}/${s.refCount} elements matched</span>
    ${chips.join('')}</summary>
    <div class="vm-body">
      <div class="vm-shots">${shot('Reference (old live)', v.shots.ref)}${shot('Candidate (SGEN)', v.shots.cand)}${shot('Diff', v.shots.diff)}</div>
      ${list('Missing on SGEN (in old, not rebuilt)', s.missing, e => `<li>${elLbl(e)}</li>`)}
      ${list('Extra on SGEN (not in old)', s.extra, e => `<li>${elLbl(e)}</li>`)}
      ${list('Moved (position shifted &gt;60px)', s.moved, m => `<li>${elLbl(m.el)} <span class="vm-sec">(${m.from[0]},${m.from[1]}&rarr;${m.to[0]},${m.to[1]})</span></li>`)}
      ${list('Restyled', s.restyled, m => `<li>${elLbl(m.el)} <span class="vm-sec">${esc(m.diffs.join('; '))}</span></li>`)}
      ${v.errors && v.errors.length ? `<div class="vm-err">render note: ${esc(v.errors.join(' | '))}</div>` : ''}
    </div></details>`;
}

function render(data, outDir) {
  const overallColor = data.overall >= 90 ? 'var(--pass)' : data.overall >= 75 ? 'var(--warn)' : 'var(--fail)';
  const pages = data.pages.map(p => `
    <details class="vm-page"${p.pageScore < 90 ? ' open' : ''}>
      <summary><span class="vm-path mono">${esc(p.path)}</span> ${bar(p.pageScore)}
        <span class="vm-links"><a href="${esc(p.ref)}" target="_blank">old&#8599;</a> <a href="${esc(p.cand)}" target="_blank">sgen&#8599;</a></span></summary>
      <div class="vm-vps">${p.viewports.map(vpBlock).join('')}</div>
    </details>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual Match — ${esc(data.candidate)}</title><style>${STYLE}
    .vm-hero{display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;margin-top:8px}
    .vm-score{font-family:var(--mono);font-size:44px;font-weight:730;color:${overallColor};line-height:1}
    .vm-sub{font-size:13px;color:var(--ink-soft)}
    .vm-bar{display:inline-block;width:90px;height:7px;border-radius:99px;background:var(--surface-2);border:1px solid var(--line);overflow:hidden;vertical-align:middle;margin:0 7px}
    .vm-bar i{display:block;height:100%}
    .vm-page{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-sm);margin-bottom:10px;overflow:hidden}
    .vm-page>summary,.vm-vp>summary{cursor:pointer;list-style:none;padding:13px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .vm-page>summary::-webkit-details-marker,.vm-vp>summary::-webkit-details-marker{display:none}
    .vm-path{font-size:14px;font-weight:600;flex:1;min-width:120px}
    .vm-links a,.vm-meta{font-family:var(--mono);font-size:11px;color:var(--ink-faint);text-decoration:none;margin-left:6px}
    .vm-vps{border-top:1px solid var(--line);padding:6px 10px}
    .vm-vp{border:1px solid var(--line);border-radius:10px;margin:8px 0;background:var(--surface-2)}
    .vm-meta{margin-left:4px}
    .vm-chip{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:99px;padding:2px 8px;margin-left:5px}
    .vm-chip.ok{color:var(--pass);background:var(--pass-bg)}.vm-chip.miss{color:var(--fail);background:var(--fail-bg)}.vm-chip.extra{color:var(--warn);background:var(--warn-bg)}.vm-chip.moved{color:var(--amber-ink,#9A6710);background:var(--warn-bg)}.vm-chip.style{color:var(--ink-soft);background:var(--surface)}
    .vm-body{padding:6px 14px 14px}
    .vm-shots{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}
    .vm-shots figure{margin:0;flex:1;min-width:170px;max-width:320px}
    .vm-shots figcaption{font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-bottom:4px}
    .vm-shots img{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
    .vm-d{margin-top:10px}.vm-dl{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint)}
    .vm-d ul{margin:5px 0 0;padding-left:16px}.vm-d li{font-size:12.5px;color:var(--ink-soft);margin:2px 0}
    .vm-sec{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint)}
    .vm-err{margin-top:8px;font-size:11.5px;color:var(--warn)}
  </style></head><body>
  <div class="wrap">
    <div class="vm-hero">
      <div><p class="eyebrow" style="font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)">Visual Match · old live vs SGEN staging</p>
        <h1 style="font-size:26px;margin:6px 0 0">${esc(data.candidate)}</h1>
        <p class="vm-sub">Reference: ${esc(data.reference)} · ${data.pairs} page(s) paired · ${data.viewports.length} viewports · ${data.sharp ? 'pixel + structural' : 'structural only (sharp missing)'}</p></div>
      <div style="text-align:right"><div class="vm-score">${data.overall}%</div><div class="vm-sub">overall match</div></div>
    </div>
    ${data.unmatchedRef && data.unmatchedRef.length ? `<div class="vm-err" style="margin-top:14px">${data.unmatchedRef.length} reference page(s) had no matching path on SGEN: ${data.unmatchedRef.slice(0, 12).map(esc).join(', ')}${data.unmatchedRef.length > 12 ? ' …' : ''}</div>` : ''}
    <div style="margin-top:22px">${pages || '<p class="vm-sub">No pages paired — check the two URLs share paths, or pass an old→new URL map.</p>'}</div>
  </div></body></html>`;
  const file = path.join(outDir, 'visual-match.html');
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(outDir, 'visual-match.json'), JSON.stringify(data, null, 2));
  return file;
}

module.exports = { render };
