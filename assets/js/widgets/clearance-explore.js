/* Chillers IOM: one chiller next to a wall, where the air goes.
   The manufacturer's guideline comes from the page (spec "data"), not from this file:
     { "Hc": <chiller height, m>, "Lmin": <minimum wall distance when the wall is lower, m>, "above": <clear height above, mm>,
       "ruleLow": "<guideline text when the wall is lower than the chiller>", "ruleHigh": "<guideline text otherwise>",
       "note": "<where the guideline is quoted from>" }
   The temperature effect is an ILLUSTRATIVE mixing model, not manufacturer data:
     recirculated fraction f = 0.35 · min(h/Hc, 2)/2 · clamp((4.0 − L)/3.5, 0, 1)
     coil inlet t_in = t_amb + f · 12 K (discharge air taken as 12 K above ambient, typical)
     capacity ≈ −1.45 % per K of inlet rise (illustrative cycle on chillers/overview). */
window.HVACWidgets.define('clearance-explore', function (root, api) {
  'use strict';
  const d = api.need(['Hc', 'Lmin', 'above', 'ruleLow', 'ruleHigh']);
  const num = x => { const n = Number(x); if (!isFinite(n)) throw new Error('bad number'); return n; };
  const C = api.COLORS, HC = num(d.Hc), LMIN = num(d.Lmin), ABOVE = num(d.above), RISE = 12, CAP_PER_K = 1.45;
  let L = LMIN, h = 2.0, amb = 46, on = true;

  const S = 26, X = m => 12 + m * 30, Y = m => 212 - m * S;   // metres → px
  const CX0 = 6.3, CX1 = 8.6;                                 // chiller left and right faces (m)
  const TOP = Math.min(HC + ABOVE / 1000, 7.6);               // the "keep clear" line, kept inside the drawing

  const fig = api.el('div', 'cx-fig');
  fig.appendChild(api.svg(`<svg viewBox="0 0 360 236" role="img" aria-label="Side view of a chiller next to a wall, with outdoor air entering the coils and hot air leaving upward">
  <defs><marker id="cxa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9z" fill="context-stroke"/></marker></defs>
  <line x1="0" y1="${Y(0)}" x2="360" y2="${Y(0)}" class="cx-ground"/>
  <g id="cx-flows"></g>
  <rect id="cx-wall" class="cx-wall"/>
  <rect x="${X(CX0)}" y="${Y(HC)}" width="${X(CX1) - X(CX0)}" height="${HC * S}" rx="3" class="cx-unit"/>
  <path d="M${X(CX0) + 4} ${Y(HC) + 6} L${X(7.45)} ${Y(Math.min(0.9, HC * 0.375))} L${X(CX1) - 4} ${Y(HC) + 6}" class="cx-coil"/>
  <ellipse cx="${X(6.85)}" cy="${Y(HC)}" rx="15" ry="3.5" class="cx-fan"/>
  <ellipse cx="${X(8.05)}" cy="${Y(HC)}" rx="15" ry="3.5" class="cx-fan"/>
  <text class="cx-t" x="${X(CX1) + 5}" y="${Y(HC - 0.3)}">Hc ${HC} m</text>
  <line x1="${X(5.2)}" x2="${X(11.6)}" y1="${Y(TOP)}" y2="${Y(TOP)}" class="cx-clear"/>
  <text class="cx-t" x="${X(11.5)}" y="${Y(TOP) - 5}" text-anchor="end">keep clear ${ABOVE} mm above</text>
  <g id="cx-dim"></g>
</svg>`));
  root.appendChild(fig);
  const svg = fig.querySelector('svg'), flows = svg.querySelector('#cx-flows'), wall = svg.querySelector('#cx-wall'), dim = svg.querySelector('#cx-dim');

  api.slider({ label: 'Wall distance L', min: 0.5, max: 6, step: 0.1, value: L, unit: 'm', format: v => v.toFixed(1), onInput: v => { L = v; draw(); } });
  api.slider({ label: 'Wall height h', min: 0, max: 6, step: 0.1, value: h, unit: 'm', format: v => v.toFixed(1), onInput: v => { h = v; draw(); } });
  api.slider({ label: 'Outdoor air', min: 35, max: 52, step: 1, value: amb, unit: '°C', onInput: v => { amb = v; draw(); } });
  const opts = api.row();
  api.toggle({ label: 'Chiller running', value: true, host: opts, onInput: v => { on = v; draw(); } });
  const ro = api.readouts(['IOM guideline', 'Air entering the wall-side coil', 'Effect on the chiller']);
  api.legend([{ label: 'Fresh outdoor air', color: C.blue }, { label: 'Hot discharge air', color: C.orange }]);
  api.note((d.note ? String(d.note) + ' ' : '') + `The temperatures and capacity effect come from a simple illustrative mixing model (discharge air ${RISE} K above ambient), not from manufacturer data.`);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const P = (m, n) => `${X(m).toFixed(1)} ${Y(n).toFixed(1)}`;
  const path = (dd, color, op = 1) => `<path class="cx-flow" d="${dd}" style="stroke:${color};opacity:${op}" marker-end="url(#cxa)"/>`;

  function draw() {
    const wx = CX0 - L;                                   // wall's chiller-side face (m)
    const hasWall = h > 0.05;
    wall.setAttribute('x', X(wx - 0.25)); wall.setAttribute('width', X(wx) - X(wx - 0.25));
    wall.setAttribute('y', Y(h)); wall.setAttribute('height', Math.max(0, h * S));
    wall.style.display = hasWall ? '' : 'none';

    const f = hasWall ? 0.35 * (Math.min(h / HC, 2) / 2) * clamp((4.0 - L) / 3.5, 0, 1) : 0;
    const tin = amb + f * RISE;

    let fl = '';
    if (on) {
      const top = HC + 4.6, mid = wx + L / 2, over = Math.max(h, HC) + 1.0;
      fl += path(`M${P(6.85, HC + 0.15)} L${P(6.85, top)}`, C.orange);
      fl += path(`M${P(8.05, HC + 0.15)} L${P(8.05, top)}`, C.orange);
      fl += path(`M${P(11.4, 1.5)} L${P(CX1 + 0.1, 1.5)}`, C.blue);
      fl += path(`M${P(11.4, 0.8)} L${P(CX1 + 0.1, 0.8)}`, C.blue);
      fl += path(`M${P(mid, over + 1.2)} Q${P(mid, 1.4)} ${P(CX0 - 0.1, 1.3)}`, C.blue, clamp(1 - f * 2, 0.25, 1));
      if (f > 0.02) fl += path(`M${P(6.6, HC + 1.0)} Q${P(wx + L * 0.3, HC + 1.8)} ${P(CX0 - 0.1, 1.8)}`, C.orange, clamp(f / 0.25, 0.25, 1));
    }
    api.put(flows, fl);
    svg.classList.toggle('cx-run', on);

    api.put(dim, `<line x1="${X(wx)}" x2="${X(CX0)}" y1="${Y(0.25)}" y2="${Y(0.25)}" class="cx-dimline" marker-end="url(#cxa)"/>` +
      `<text class="cx-tb" x="${(X(wx) + X(CX0)) / 2}" y="${Y(0.25) - 5}" text-anchor="middle">L ${L.toFixed(1)} m</text>` +
      (hasWall ? `<text class="cx-tb" x="${Math.max(X(wx - 0.3), 20)}" y="${Y(h) - 5}" text-anchor="middle">h ${h.toFixed(1)} m</text>` : ''));

    // The guideline readout shows the page's text as it is (plain text, never markup).
    const rule = (text, verdict) => ro(0, String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), verdict);
    if (!hasWall || (h < HC && L >= LMIN)) rule(d.ruleLow, hasWall ? 'Meets' : 'No wall');
    else if (Math.abs(h - HC) < 0.05 && L >= LMIN) ro(0, 'Wall at the chiller height: the guideline covers lower and higher walls, so ask', 'Check');
    else rule(d.ruleHigh, 'Ask the manufacturer');

    if (!on) { ro(1, 'Fans off: no airflow', '–'); ro(2, 'No heat rejection', '–'); return; }
    ro(1, `${api.fmt(f * 100, 0)} % of the wall-side intake is recirculated (illustrative)`, `${api.fmt(tin, 1)} °C`);
    ro(2, `Condensing temperature about +${api.fmt(tin - amb, 1)} K (illustrative)`, f > 0.005 ? `−${api.fmt((tin - amb) * CAP_PER_K, 1)} % capacity` : 'No penalty');
  }
  draw();
});
