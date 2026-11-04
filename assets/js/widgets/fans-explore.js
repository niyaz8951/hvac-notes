/* Fans and fan laws: operating point explorer.
   Illustrative fan: Δp = r·(1300·n² − 20·Q²) Pa; duct system Δp = r·k1·Q²; setpoint system Δp = 250 + r·k2·Q².
   r = air density / 1.2 kg/m³ (standard air). Fan efficiency held at 70 %. */
window.HVACWidgets.define('fans-explore', function (root, api) {
  'use strict';
  const C = api.COLORS;
  let n = 0.8, dirty = false, hot = false;
  const ETA = 0.7, PD = 5 * 800 / ETA;

  api.slider({ label: 'Fan speed', min: 50, max: 110, step: 1, value: 80, unit: '%', onInput: v => { n = v / 100; draw(); } });
  const opts = api.row();
  api.toggle({ label: 'Dirty filter (+150 Pa at 5 m³/s)', host: opts, onInput: v => { dirty = v; draw(); } });
  api.toggle({ label: 'Air at 46 °C', host: opts, onInput: v => { hot = v; draw(); } });
  const ro = api.readouts(['Duct only (Δp ∝ Q²)', '250 Pa setpoint held']);
  api.legend([
    { label: 'Fan at set speed', color: C.blue },
    { label: 'Fan at 100 %', color: C.gray, dash: true },
    { label: 'Duct only', color: C.orange },
    { label: 'With setpoint', color: C.green, dash: true }
  ]);
  const ch = api.chart({ x: [0, 7], y: [0, 1400], xticks: [1, 2, 3, 4, 5, 6, 7], yticks: [200, 400, 600, 800, 1000, 1200],
    xlabel: 'Airflow, Q (m³/s)', ylabel: 'Δp (Pa)', label: 'Fan curves and two system curves with their operating points' });
  api.note('Illustrative fan: design 5 m³/s at 800 Pa fan total pressure, standard air, fan efficiency held at 70 %. Power is shaft power as % of the 5.71 kW design value.');

  function draw() {
    const r = hot ? 1.106 / 1.2 : 1, k1 = dirty ? 38 : 32, k2 = dirty ? 28 : 22, rho = 1.2 * r;
    ch.line('f100', q => r * (1300 - 20 * q * q), { color: C.gray, dash: '5 4' });
    ch.line('sys1', q => r * k1 * q * q, { color: C.orange });
    ch.line('sys2', q => 250 + r * k2 * q * q, { color: C.green, dash: '7 5' });
    ch.line('fan', q => r * (1300 * n * n - 20 * q * q), { color: C.blue, width: 2.8 });
    const q1 = n * Math.sqrt(1300 / (20 + k1)), p1 = r * k1 * q1 * q1;
    const v2 = (1300 * n * n - 250 / r) / (20 + k2);
    ch.dot('d1', q1, p1, { color: C.orange });
    const show = (i, q, p) => ro(i,
      `${api.fmt(q, 2)} m³/s · ${api.fmt(p, 0)} Pa<br>${api.fmt(rho * q, 2)} kg/s`,
      `${api.fmt(100 * q * p / ETA / PD, 0)} % power`);
    show(0, q1, p1);
    if (v2 > 0) { const q2 = Math.sqrt(v2), p2 = 250 + r * k2 * q2 * q2; ch.dot('d2', q2, p2, { color: C.green, shape: 'diamond' }); show(1, q2, p2); }
    else { ch.dot('d2', null); ro(1, 'Fan cannot reach the setpoint', '–'); }
  }
  draw();
});
