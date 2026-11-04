/* Chillers: inverter drive power factor. PF = DPF / sqrt(1 + THD²); S = P / PF; I = S / (√3 · U). Generic physics. */
window.HVACWidgets.define('pf-explore', function (root, api) {
  'use strict';
  const C = api.COLORS, U = 400;
  let dpf = 0.95, thd = 35, P = 200;

  api.slider({ label: 'Displacement PF', min: 0.80, max: 1.00, step: 0.01, value: dpf, format: v => v.toFixed(2), onInput: v => { dpf = v; draw(); } });
  api.slider({ label: 'Current THD', min: 0, max: 100, step: 1, value: thd, unit: '%', onInput: v => { thd = v; draw(); } });
  api.slider({ label: 'Drive input', min: 50, max: 400, step: 10, value: P, unit: 'kW', onInput: v => { P = v; draw(); } });
  const ro = api.readouts(['True power factor', 'Supply current at 400 V']);
  api.legend([{ label: 'PF at this DPF', color: C.blue }, { label: 'PF if DPF = 1.00', color: C.gray, dash: true }]);
  const ch = api.chart({ x: [0, 100], y: [40, 106], xticks: [0, 20, 40, 60, 80, 100], yticks: [50, 60, 70, 80, 90, 100],
    xlabel: 'Current THD (%)', ylabel: 'Power factor (%)', label: 'True power factor against current harmonic distortion' });
  api.note('Equation (2) of the page. Typical current THD (input side): six-pulse drive without chokes well above 50 %; with DC or AC chokes about 30–45 %; active front end or active filter below 5 %.');

  function draw() {
    ch.line('one', t => 100 / Math.sqrt(1 + (t / 100) ** 2), { color: C.gray, dash: '5 4' });
    ch.line('pf', t => 100 * dpf / Math.sqrt(1 + (t / 100) ** 2), { color: C.blue, width: 2.8 });
    const pf = dpf / Math.sqrt(1 + (thd / 100) ** 2), S = P / pf, I = S * 1000 / (Math.sqrt(3) * U);
    ch.dot('pt', thd, 100 * pf, { color: C.blue });
    ro(0, `DPF ${api.fmt(dpf, 2)} × distortion factor ${api.fmt(1 / Math.sqrt(1 + (thd / 100) ** 2), 3)}`, api.fmt(pf, 3));
    ro(1, `Apparent power ${api.fmt(S, 0)} kVA for ${api.fmt(P, 0)} kW`, `${api.fmt(I, 0)} A`);
  }
  draw();
});
