/* Psychrometrics — adiabatic mixing of outdoor and room air.
   Mass and energy balances per kg of dry air (ASHRAE Handbook — Fundamentals 2021, SI, Ch. 1, Eq. 44); properties by Eqs. 20, 26, 30. */
window.HVACWidgets.define('psychro-mix-explore', function (root, api) {
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
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Psychrometric chart with outdoor, room and mixed air');
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
    { label: 'Mixing line', color: 'var(--text2)', dash: true }
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
  const p = 101.325, tR = 24, WR = Wrh(24, 0.5, p), hR = hOf(tR, WR);
  let tO = 46, WO = 0.015, x = 0.3;
  const presets = api.row();
  [['Inland desert 46 °C, 15 g/kg', 46, 15], ['Humid coast 35 °C, 28 g/kg', 35, 28]].forEach(([lab, tt, ww]) => {
    const b = api.el('button', 'w-btn', lab); b.type = 'button';
    b.onclick = () => { tO = tt; WO = ww / 1000; sT.value = tt; sW.value = ww; sT.dispatchEvent(new Event('input')); sW.dispatchEvent(new Event('input')); };
    presets.appendChild(b);
  });
  const sT = api.slider({ label: 'Outdoor dry bulb', min: 25, max: 50, step: 0.5, value: 46, unit: '°C', onInput: v => { tO = v; draw(); } });
  const sW = api.slider({ label: 'Outdoor W', min: 4, max: 30, step: 0.5, value: 15, unit: 'g/kg', onInput: v => { WO = v / 1000; draw(); } });
  api.slider({ label: 'Outdoor air share', min: 0, max: 100, step: 5, value: 30, unit: '% by mass', onInput: v => { x = v / 100; draw(); } });
  const ro = api.readouts(['Mixed air', 'Mixed humidity ratio', 'Mixed enthalpy', 'Outdoor vs room enthalpy']);
  const note = api.el('p', 'w-note'); root.appendChild(note);
  note.textContent = 'Room held at 24 °C, 50 % (9.30 g/kg, 47.8 kJ/kg). Shares are by mass of dry air; at 101.325 kPa.';

  function draw() {
    const WOc = Math.min(WO, Wrh(tO, 1, p) * 0.999), hO = hOf(tO, WOc);
    const W3 = x * WOc + (1 - x) * WR, h3 = x * hO + (1 - x) * hR, t3 = (h3 - 2501 * W3) / (1.006 + 1.86 * W3);
    const dot = (tt, W, c, r) => `<circle cx="${X(tt)}" cy="${Y(W)}" r="${r}" style="fill:${c};stroke:var(--paper);stroke-width:2"/>`;
    api.put(gGuide, `<line x1="${X(tR)}" y1="${Y(WR)}" x2="${X(tO)}" y2="${Y(WOc)}" style="stroke:var(--text2);stroke-width:1.6;stroke-dasharray:5 4"/>`
      + tx(X(tR) - 6, Y(WR) + 14, 'Room', 'var(--text)', 'end', 'w-lab') + tx(X(tO) - 4, Y(WOc) - 10, 'Outdoor', C.orange, 'end', 'w-lab'));
    api.put(gPt, dot(tR, WR, 'var(--text2)', 5) + dot(tO, WOc, C.orange, 6) + dot(t3, W3, C.red, 7));
    ro(0, `φ = ${api.fmt(100 * pwW(W3, p) / pws(t3), 0)} %, dew point ${api.fmt(tDew(W3, p), 1)} °C`, `${api.fmt(t3, 1)} °C`);
    ro(1, `${api.fmt(x * 100, 0)} % × ${api.fmt(WOc * 1000, 1)} + ${api.fmt(100 - x * 100, 0)} % × ${api.fmt(WR * 1000, 2)}`, `${api.fmt(W3 * 1000, 2)} g/kg`);
    ro(2, `Straight average of t: ${api.fmt(x * tO + (1 - x) * tR, 1)} °C`, `${api.fmt(h3, 1)} kJ/kg`);
    ro(3, `Outdoor φ = ${api.fmt(100 * pwW(WOc, p) / pws(tO), 0)} %`, `${api.fmt(hO, 1)} vs ${api.fmt(hR, 1)}`);
  }
  drawFamilies(p, { wb: false, h: false, v: false });
  draw();
});
