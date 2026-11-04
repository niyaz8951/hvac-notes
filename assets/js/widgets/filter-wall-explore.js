/* Filters: filter wall explorer. Two filter stages in a wall of 594 × 594 cells.
   The catalogue figures come from the page (spec "data"), not from this file:
     { "rated_m3h": <airflow per cell the resistances are rated at>, "clean1": <stage 1 clean Pa>, "clean2": <stage 2 clean Pa>,
       "max": <catalogue final Pa, both stages>, "note": "<source note>" }
   Clean Δp is taken as proportional to airflow per cell (typical for fibrous media). Change point by the EN 13053 rule,
   min(clean + 100, 3 × clean). Fan and motor efficiency 0.50; 8,760 h a year. */
window.HVACWidgets.define('filter-wall-explore', function (root, api) {
  'use strict';
  const d = api.need(['rated_m3h', 'clean1', 'clean2', 'max']);
  const num = x => { const n = Number(x); if (!isFinite(n)) throw new Error('bad number'); return n; };
  const C = api.COLORS, RATED = num(d.rated_m3h) / 3600, C1 = num(d.clean1), C2 = num(d.clean2), MAX = num(d.max);
  const CELL = 0.594 * 0.594, ETA = 0.5, H = 8760;
  let Q = 5, n = 6, cat = false;
  api.slider({ label: 'Airflow', min: 2, max: 10, step: 0.5, value: 5, unit: 'm³/s', onInput: v => { Q = v; draw(); } });
  api.slider({ label: 'Filter cells (594 × 594)', min: 4, max: 12, step: 1, value: 6, onInput: v => { n = v; draw(); } });
  api.toggle({ label: `Run filters to catalogue maximum (${MAX} Pa each)`, onInput: v => { cat = v; draw(); } });
  const ro = api.readouts(['Per cell', 'Both stages', 'Fan power for filters']);
  api.legend([{ label: 'Design Δp (mean)', color: C.blue }, { label: 'Final Δp', color: C.orange, dash: true }, { label: 'Clean Δp', color: C.green }]);
  const top = Math.max(1000, Math.ceil(2 * MAX * 1.1 / 200) * 200);
  const yt = []; for (let y = 200; y < top; y += 200) yt.push(y);
  const ch = api.chart({ x: [4, 12], y: [0, top], xticks: [4, 6, 8, 10, 12], yticks: yt,
    xlabel: 'Filter cells', ylabel: 'Δp (Pa)', label: 'Clean, design and final pressure drop of two filter stages against the number of cells' });
  if (d.note) api.note(String(d.note));
  function stages(cells) {
    const r = (Q / cells) / RATED, c1 = C1 * r, c2 = C2 * r;
    const f1 = cat ? MAX : Math.min(c1 + 100, 3 * c1), f2 = cat ? MAX : Math.min(c2 + 100, 3 * c2);
    const clean = c1 + c2, fin = f1 + f2;
    return { clean, fin, design: 0.5 * (clean + fin) };
  }
  function draw() {
    const xs = []; for (let k = 4; k <= 12; k++) xs.push(k);
    ch.line('fin', xs.map(k => [k, stages(k).fin]), { color: C.orange, dash: '6 4' });
    ch.line('des', xs.map(k => [k, stages(k).design]), { color: C.blue, width: 2.8 });
    ch.line('cln', xs.map(k => [k, stages(k).clean]), { color: C.green });
    const s = stages(n), v = Q / (n * CELL), P = Q * s.design / ETA;
    ch.dot('d', n, s.design, { color: C.blue });
    ro(0, `${api.fmt(Q / n, 3)} m³/s<br>${api.fmt(v, 2)} m/s face velocity`, `${api.fmt(100 * (Q / n) / RATED, 0)} % of rated`);
    ro(1, `clean ${api.fmt(s.clean, 0)} Pa<br>final ${api.fmt(s.fin, 0)} Pa`, `design ${api.fmt(s.design, 0)} Pa`);
    ro(2, `${api.fmt(P / 1000, 2)} kW at design Δp`, `${api.fmt(P * H / 1000, 0)} kWh/a`);
  }
  draw();
});
