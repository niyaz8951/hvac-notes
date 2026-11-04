/* Chillers: screw compressor indicator diagram, built-in volume ratio against system pressure ratio.
   Illustrative ideal-gas model with isentropic volume exponent n = 1.02 (R-134a's isentrope over the chiller range is
   close to pv^1.0). Suction state normalised: p = 1, pocket volume V = 1.
   Work per pocket: W = (pi·V2 − 1)/(n − 1) + pd·V2 − 1 ; matched ideal: W0 = n/(n − 1)·(pd^((n−1)/n) − 1). */
window.HVACWidgets.define('vi-explore', function (root, api) {
  'use strict';
  const C = api.COLORS, n = 1.02;
  let Vi = 3.5, pr = 5.3, vvr = false;

  api.slider({ label: 'Built-in Vi', min: 2.0, max: 6.0, step: 0.1, value: Vi, format: v => v.toFixed(1), onInput: v => { Vi = v; draw(); } });
  api.slider({ label: 'System pressure ratio', min: 2.0, max: 7.0, step: 0.1, value: pr, format: v => v.toFixed(1), onInput: v => { pr = v; draw(); } });
  const opts = api.row();
  api.toggle({ label: 'VVR: Vi follows the lift', host: opts, onInput: v => { vvr = v; draw(); } });
  const ro = api.readouts(['Built-in pressure ratio', 'Extra work per pocket']);
  api.legend([
    { label: 'Pocket pressure (actual)', color: C.blue },
    { label: 'Matched compression', color: C.gray, dash: true },
    { label: 'Discharge pressure', color: C.orange }
  ]);
  const ch = api.chart({ x: [0, 1.05], y: [0, 8], xticks: [], yticks: [1, 2, 3, 4, 5, 6, 7],
    xlabel: 'Pocket volume, V (suction = 1)', ylabel: 'Pressure ratio, p/ps', label: 'Indicator diagram of one screw compressor pocket' });
  api.note('Illustrative: ideal gas with n = 1.02, no leakage or friction. Typical chiller pressure ratios on R-134a: about 3 on a cool night, 4.0 at 35 °C ambient, 5.3 at 46 °C.');

  function draw() {
    const vi = vvr ? Math.min(6, Math.max(2, Math.pow(pr, 1 / n))) : Vi;
    const V2 = 1 / vi, pi = Math.pow(vi, n), Vid = Math.pow(pr, -1 / n);
    ch.line('suc', [[0, 1], [1, 1]], { color: C.gray, width: 1.4 });
    const comp = []; for (let k = 0; k <= 60; k++) { const V = 1 - (1 - V2) * k / 60; comp.push([V, Math.pow(V, -n)]); }
    const ideal = []; for (let k = 0; k <= 60; k++) { const V = 1 - (1 - Vid) * k / 60; ideal.push([V, Math.pow(V, -n)]); }
    ch.line('ideal', ideal, { color: C.gray, dash: '5 4' });
    ch.line('comp', comp, { color: C.blue, width: 2.8 });
    ch.line('jump', [[V2, pi], [V2, pr]], { color: C.blue, width: 2.8 });
    ch.line('dis', [[V2, pr], [0, pr]], { color: C.orange, width: 2.4 });
    ch.dot('open', V2, pi, { color: C.blue });
    const W = (pi * V2 - 1) / (n - 1) + pr * V2 - 1, W0 = n / (n - 1) * (Math.pow(pr, (n - 1) / n) - 1);
    const extra = 100 * (W / W0 - 1);
    const mode = Math.abs(pi - pr) / pr < 0.02 ? 'Matched' : pi > pr ? 'Over-compression' : 'Under-compression';
    ro(0, `Vi ${api.fmt(vi, 1)} → π<sub>i</sub> ${api.fmt(pi, 2)} vs system ${api.fmt(pr, 1)}`, mode);
    ro(1, 'Compared with a pocket matched to the system (illustrative)', `+${api.fmt(Math.max(0, extra), 1)} %`);
  }
  draw();
});
