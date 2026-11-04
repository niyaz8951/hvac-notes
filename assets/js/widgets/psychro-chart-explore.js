/* Psychrometrics — interactive psychrometric chart.
   Perfect-gas relations of ASHRAE Handbook — Fundamentals (2021, SI) Ch. 1: Eqs. 3, 5, 6, 20, 26, 30, 33.
   The reader sets a state by sliders, by preset or by tapping the chart; the readouts give every property. */
window.HVACWidgets.define('psychro-chart-explore', function (root, api) {
  'use strict';
  const C = api.COLORS, NS = 'http://www.w3.org/2000/svg';

  /* ---------- moist-air relations ---------- */
  const pAlt = Z => 101.325 * Math.pow(1 - 2.25577e-5 * Z, 5.2559);
  function pws(t) { // kPa
    const T = t + 273.15;
    const ln = t < 0
      ? -5674.5359 / T + 6.3925247 - 9.677843e-3 * T + 6.2215701e-7 * T * T + 2.0747825e-9 * T ** 3 - 9.484024e-13 * T ** 4 + 4.1635019 * Math.log(T)
      : -5800.2206 / T + 1.3914993 - 4.8640239e-2 * T + 4.1764768e-5 * T * T - 1.4452093e-8 * T ** 3 + 6.5459673 * Math.log(T);
    return Math.exp(ln) / 1000;
  }
  const Wpw = (pw, p) => 0.621945 * pw / (p - pw);
  const pwW = (W, p) => p * W / (0.621945 + W);
  const Wrh = (t, f, p) => Wpw(f * pws(t), p);
  const hOf = (t, W) => 1.006 * t + W * (2501 + 1.86 * t);
  const vOf = (t, W, p) => 0.287042 * (t + 273.15) * (1 + 1.607858 * W) / p;
  function bisect(f, a, b) { let fa = f(a); for (let i = 0; i < 60; i++) { const m = (a + b) / 2, fm = f(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; } return (a + b) / 2; }
  function Wwb(t, ts, p) {
    const Ws = Wpw(pws(ts), p);
    return ts >= 0 ? ((2501 - 2.326 * ts) * Ws - 1.006 * (t - ts)) / (2501 + 1.86 * t - 4.186 * ts)
      : ((2830 - 0.24 * ts) * Ws - 1.006 * (t - ts)) / (2830 + 1.86 * t - 2.1 * ts);
  }
  const tDew = (W, p) => { const pw = pwW(W, p); return bisect(x => pws(x) - pw, -60, 60); };
  const tWet = (t, W, p) => bisect(x => Wwb(t, x, p) - W, -40, t);

  /* ---------- chart ---------- */
  const VW = 380, VH = 300, L = 8, R = 344, T = 14, B = 262, TMAX = 50, WMAX = 30;
  const X = t => L + (R - L) * t / TMAX, Y = W => B - (B - T) * W * 1000 / WMAX;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`); svg.setAttribute('class', 'w-chart');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Psychrometric chart with a movable state point');
  svg.style.cursor = 'crosshair';
  const g = (cls) => { const e = document.createElementNS(NS, 'g'); if (cls) e.setAttribute('class', cls); svg.appendChild(e); return e; };
  const gGrid = g(), gFam = g(), gSat = g(), gGuide = g(), gPt = g();
  const pl = (pts, s) => pts.length < 2 ? '' : `<polyline fill="none" points="${pts.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ')}" style="stroke:${s.c};stroke-width:${s.w || 1};${s.d ? 'stroke-dasharray:' + s.d + ';' : ''}${s.o ? 'opacity:' + s.o : ''}" stroke-linecap="round"/>`;
  const tx = (x, y, s, c, a, cls) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${a || 'start'}" class="${cls || 'w-tick'}" style="fill:${c || 'var(--text2)'}">${s}</text>`;

  let grid = '';
  for (let t = 5; t <= TMAX; t += 5) grid += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${B}" class="w-grid"/>`;
  for (let w = 5; w <= WMAX; w += 5) grid += `<line x1="${L}" x2="${R}" y1="${Y(w / 1000)}" y2="${Y(w / 1000)}" class="w-grid"/>`;
  for (let t = 0; t <= TMAX; t += 10) grid += tx(X(t), B + 14, t, null, 'middle');
  for (let w = 0; w <= WMAX; w += 5) grid += tx(R + 5, Y(w / 1000) + 3.5, w);
  grid += `<line x1="${L}" x2="${R}" y1="${B}" y2="${B}" class="w-axis"/><line x1="${R}" x2="${R}" y1="${T}" y2="${B}" class="w-axis"/>`;
  grid += tx(R, VH - 6, 'Dry-bulb temperature, t (°C)', null, 'end', 'w-axlabel') + tx(R + 4, 10, 'W (g/kg)', null, 'end', 'w-axlabel');
  api.put(gGrid, grid);
  api.legend([
    { label: 'Relative humidity, 10 % steps', color: C.blue },
    { label: 'Wet bulb', color: C.green },
    { label: 'Enthalpy', color: C.purple, dash: true },
    { label: 'Specific volume', color: C.orange, dash: true }
  ]);
  root.appendChild(svg);

  const curve = (f, a, b, n = 80) => { const pts = []; for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n, y = f(x); if (y == null || !isFinite(y) || y < 0) continue; if (y * 1000 > WMAX) { pts.push([x, y]); break; } pts.push([x, y]); } return pts; };
  function drawFamilies(p, show) {
    const satTop = bisect(x => Wrh(x, 1, p) * 1000 - WMAX, 0, TMAX);
    const sat = curve(t => Wrh(t, 1, p), 0, Math.min(TMAX, satTop + 0.01), 120).map(q => [q[0], Math.min(q[1], WMAX / 1000)]);
    api.put(gSat, pl(sat, { c: 'var(--text)', w: 2.2 }) + `<polygon points="${X(0)},${Y(WMAX / 1000)} ${sat.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ')}" style="fill:var(--text2);opacity:.08"/>`);
    let s = '';
    for (let f = 0.1; f < 0.95; f += 0.1) s += pl(curve(t => Wrh(t, f, p), 0, TMAX, 60), { c: C.blue, w: f === 0.5 ? 1.2 : 0.8, o: .75 });
    [0.2, 0.4, 0.6].forEach(f => { const t = Math.min(TMAX - 2, bisect(x => Wrh(x, f, p) * 1000 - WMAX * 0.92, 0, 60)); const W = Wrh(t, f, p); if (W * 1000 <= WMAX) s += tx(X(t) + 3, Y(W) + 10, Math.round(f * 100) + ' %', C.blue); });
    if (show.wb) for (let ts = 0; ts <= 32; ts += 2) {
      const Ws = Wrh(ts, 1, p); if (Ws * 1000 > WMAX) break;
      s += pl(curve(t => { const W = Wwb(t, ts, p); return W < 0 ? null : W; }, ts, TMAX, 30), { c: C.green, w: ts % 10 ? 0.6 : 1.1, o: .8 });
      if (ts % 10 === 0 && ts) s += tx(X(ts) - 3, Y(Ws) - 3, ts, C.green, 'end');
    }
    if (show.h) for (let hh = 10; hh <= 140; hh += 10) {
      const pts = []; for (let i = 0; i <= 40; i++) { const t = TMAX * i / 40, W = (hh - 1.006 * t) / (2501 + 1.86 * t); if (W < 0 || W * 1000 > WMAX || W > Wrh(t, 1, p)) continue; pts.push([t, W]); }
      s += pl(pts, { c: C.purple, w: 0.8, d: '4 3', o: .8 });
    }
    if (show.v) for (let vv = 0.80; vv <= 0.951; vv += 0.01) {
      const pts = []; for (let i = 0; i <= 30; i++) { const W = WMAX / 1000 * i / 30, t = vv * p / (0.287042 * (1 + 1.607858 * W)) - 273.15; if (t < 0 || t > TMAX || W > Wrh(t, 1, p)) continue; pts.push([t, W]); }
      s += pl(pts, { c: C.orange, w: 0.8, d: '2 3', o: .8 });
    }
    api.put(gFam, s);
  }

  /* ---------- state and controls ---------- */
  let t = 24, f = 0.5, Z = 0, syncing = false;
  const show = { wb: true, h: false, v: false };
  const presets = api.row();
  [['Office', 24, null, 0.5], ['Ceiling void', 30, null, 0.6], ['Humid coast', 35, 0.028], ['Inland desert', 46, 0.015]].forEach(([lab, tt, W, ff]) => {
    const b = api.el('button', 'w-btn', lab); b.type = 'button';
    b.onclick = () => { t = tt; f = ff != null ? ff : Math.min(1, pwW(W, pAlt(Z)) / pws(tt)); sync(); draw(); };
    presets.appendChild(b);
  });
  const sT = api.slider({ label: 'Dry bulb', min: 0, max: 50, step: 0.5, value: 24, unit: '°C', onInput: x => { if (syncing) return; t = x; draw(); } });
  const sF = api.slider({ label: 'Rel. humidity', min: 2, max: 100, step: 1, value: 50, unit: '%', onInput: x => { if (syncing) return; f = x / 100; draw(); } });
  const sZ = api.slider({ label: 'Altitude', min: 0, max: 2500, step: 50, value: 0, unit: 'm', onInput: x => { if (syncing) return; Z = x; drawFamilies(pAlt(Z), show); draw(); } });
  const opts = api.row();
  api.toggle({ label: 'Wet-bulb lines', value: true, host: opts, onInput: x => { show.wb = x; drawFamilies(pAlt(Z), show); } });
  api.toggle({ label: 'Enthalpy lines', host: opts, onInput: x => { show.h = x; drawFamilies(pAlt(Z), show); } });
  api.toggle({ label: 'Volume lines', host: opts, onInput: x => { show.v = x; drawFamilies(pAlt(Z), show); } });
  const ro = api.readouts(['Humidity ratio, W', 'Relative humidity, φ', 'Dew point', 'Wet bulb, t*', 'Enthalpy, h', 'Specific volume, v']);
  const note = api.el('p', 'w-note'); root.appendChild(note);

  function sync() {
    syncing = true;
    [[sT, t], [sF, Math.round(f * 100)]].forEach(([inp, val]) => { inp.value = val; inp.dispatchEvent(new Event('input')); });
    syncing = false;
  }

  function draw() {
    const p = pAlt(Z), W = Wrh(t, f, p), pw = pwW(W, p), td = tDew(W, p), tw = tWet(t, W, p), h = hOf(t, W), v = vOf(t, W, p);
    const inChart = W * 1000 <= WMAX;
    let gd = '';
    if (inChart) {
      gd += `<line x1="${X(t)}" y1="${Y(W)}" x2="${X(t)}" y2="${B}" style="stroke:${C.red};stroke-width:1;stroke-dasharray:3 3"/>`;
      gd += `<line x1="${X(t)}" y1="${Y(W)}" x2="${R}" y2="${Y(W)}" style="stroke:${C.red};stroke-width:1;stroke-dasharray:3 3"/>`;
      if (td >= 0) gd += `<line x1="${X(t)}" y1="${Y(W)}" x2="${X(td)}" y2="${Y(W)}" style="stroke:${C.red};stroke-width:1.6"/><circle cx="${X(td)}" cy="${Y(W)}" r="3" style="fill:${C.red}"/>`;
      if (tw >= 0) gd += pl(curve(x => Wwb(x, tw, p), tw, t, 12), { c: C.green, w: 2.2 }) + `<circle cx="${X(tw)}" cy="${Y(Wrh(tw, 1, p))}" r="3" style="fill:${C.green}"/>`;
      api.put(gPt, `<circle cx="${X(t)}" cy="${Y(W)}" r="7" style="fill:${C.red};stroke:var(--paper);stroke-width:2.5"/>`);
    } else api.put(gPt, tx(L + 6, T + 14, 'Point above 30 g/kg: off this chart', C.red, 'start', 'w-lab'));
    api.put(gGuide, gd);
    ro(0, `p_w = ${api.fmt(pw, 3)} kPa`, `${api.fmt(W * 1000, 2)} g/kg`);
    ro(1, `p_ws(${api.fmt(t, 1)} °C) = ${api.fmt(pws(t), 3)} kPa`, `${api.fmt(f * 100, 0)} %`);
    ro(2, 'Surfaces colder than this sweat', `${api.fmt(td, 1)} °C`);
    ro(3, `Depression t − t* = ${api.fmt(t - tw, 1)} K`, `${api.fmt(tw, 1)} °C`);
    ro(4, 'Per kg of dry air', `${api.fmt(h, 1)} kJ/kg`);
    ro(5, `Density ρ = ${api.fmt((1 + W) / v, 3)} kg/m³`, `${api.fmt(v, 3)} m³/kg`);
    note.textContent = `Pressure ${api.fmt(p, 3)} kPa at ${Z} m (Eq. 1). The chart redraws for this pressure. Tap the chart to move the point.`;
  }

  /* ---------- tap and drag ---------- */
  function toState(ev) {
    const m = svg.getScreenCTM(); if (!m) return;
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const p = pAlt(Z);
    const tt = Math.max(0, Math.min(TMAX, (pt.x - L) / (R - L) * TMAX));
    const W = Math.max(0.0001, Math.min(Wrh(tt, 1, p), (B - pt.y) / (B - T) * WMAX / 1000));
    t = Math.round(tt * 2) / 2; f = Math.max(0.02, Math.min(1, pwW(W, p) / pws(t)));
    sync(); draw();
  }
  let dragging = false;
  svg.addEventListener('pointerdown', ev => { if (ev.pointerType === 'touch') return; dragging = true; svg.setPointerCapture(ev.pointerId); toState(ev); });
  svg.addEventListener('pointermove', ev => { if (dragging) toState(ev); });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('click', ev => toState(ev));

  drawFamilies(pAlt(Z), show);
  draw();
});
