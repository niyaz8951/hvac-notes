/* Fine filters: bag depth and pocket count against clean resistance.
   The catalogue figures come from the page (spec "data"), not from this file:
     { "rated_m3h": <airflow per cell the figures are rated at>, "cell": "<cell size label>", "product": "<range name>",
       "pockets": <pockets in the series>, "depths": [<mm>, …],
       "series": [ { "key", "label", "y": [<Pa per depth, or null>], "color": "gray|green|blue|purple|orange|rose|amber" } ],
       "points": [ { "key", "label", "pts": [[<mm>, <Pa>], …], "color" } ],
       "select": "<series key read out first>", "depth": <index of the depth shown first>, "note": "<source note>",
       "x": [<mm from>, <mm to>], "y": [0, <Pa top>] (optional axis ranges) }
   Change point by the EN 13053 rule, min(clean + 100, 3 × clean); energy at the mean of clean and change point,
   fan and motor efficiency 0.50, 8,760 h a year. */
window.HVACWidgets.define('bag-depth-explore', function (root, api) {
  'use strict';
  const d = api.need(['rated_m3h', 'depths', 'series']);
  const num = x => { const n = Number(x); if (!isFinite(n)) throw new Error('bad number'); return n; };
  const D = d.depths.map(num), RATED = num(d.rated_m3h), pockets = d.pockets != null ? num(d.pockets) : null;
  const S = d.series.map(s => ({ key: String(s.key), label: String(s.label), y: s.y.map(v => v == null ? null : num(v)), color: api.color(s.color) }));
  const PTS = (d.points || []).map(p => ({ key: String(p.key), label: String(p.label), pts: p.pts.map(q => [num(q[0]), num(q[1])]), color: api.color(p.color) }));
  const product = d.product ? String(d.product) + ' ' : '';
  let i = Math.max(0, Math.min(D.length - 1, d.depth != null ? num(d.depth) : 0)), sel = d.select && S.some(s => s.key === d.select) ? d.select : S[0].key;

  api.slider({ label: `Bag depth${d.product ? ' (' + d.product + ')' : ''}`, min: 0, max: D.length - 1, step: 1, value: i, format: k => D[k], unit: 'mm', onInput: v => { i = v; draw(); } });
  const opts = api.row();
  S.forEach(s => api.toggle({ label: s.label, value: s.key === sel, host: opts, onInput: on => { if (on) sel = s.key; draw(); } }));
  const ro = api.readouts(['Clean Δp', 'Change point', 'Per cell at 8,760 h']);
  api.legend(S.map(s => ({ label: product + s.label, color: s.color })).concat(PTS.map(p => ({ label: p.label, color: p.color, dash: true }))));
  const maxY = Math.max(...S.flatMap(s => s.y.filter(v => v != null)), ...PTS.flatMap(p => p.pts.map(q => q[1])));
  const top = Array.isArray(d.y) ? num(d.y[1]) : Math.ceil(maxY * 1.15 / 50) * 50;
  const lo = Array.isArray(d.x) ? num(d.x[0]) : Math.floor(Math.min(...D, ...PTS.flatMap(p => p.pts.map(q => q[0]))) / 100) * 100;
  const hi = Array.isArray(d.x) ? num(d.x[1]) : Math.ceil(Math.max(...D, ...PTS.flatMap(p => p.pts.map(q => q[0]))) / 100) * 100 + 20;
  const xt = []; for (let x = Math.ceil(lo / 100) * 100; x <= hi; x += 100) xt.push(x);
  const yt = []; for (let y = 50; y < top; y += 50) yt.push(y);
  const ch = api.chart({ x: [lo, hi], y: [0, top], xticks: xt, yticks: yt,
    xlabel: 'Bag depth (mm)', ylabel: 'Clean Δp (Pa)', label: 'Rated clean resistance of bag filters against bag depth' });
  if (d.note) api.note(String(d.note));
  const q = RATED / 3600;

  function draw() {
    S.forEach(s => ch.line(s.key, D.map((x, k) => [x, s.y[k]]).filter(p => p[1] != null), { color: s.color, width: s.key === sel ? 3 : 1.6 }));
    PTS.forEach(p => { ch.line(p.key, p.pts, { color: p.color, dash: '5 4', width: 1.8 }); p.pts.forEach((pt, k) => ch.dot(p.key + k, pt[0], pt[1], { color: p.color })); });
    const s = S.find(x => x.key === sel), c = s.y[i];
    if (c == null) { ch.dot('cur', null); ro(0, 'Not made in this depth', '–'); ro(1, '–', ''); ro(2, '–', ''); return; }
    const f = Math.min(c + 100, 3 * c), mean = 0.5 * (c + f), E = q * mean * 8760 / (0.5 * 1000);
    ch.dot('cur', D[i], c, { color: s.color, shape: 'diamond' });
    ro(0, `${D[i]} mm${pockets ? ', ' + pockets + ' pockets' : ''}`, `${c} Pa`);
    ro(1, `design ${api.fmt(mean, 0)} Pa`, `${api.fmt(f, 0)} Pa`);
    ro(2, `at ${api.fmt(q, 3)} m³/s`, `${api.fmt(E, 0)} kWh/a`);
  }
  draw();
});
