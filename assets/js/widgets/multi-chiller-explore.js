/* Chillers IOM: three chillers side by side, dominant wind and compound walls. Qualitative only.
   What the manufacturer's manual says about each chiller comes from the page (spec "data"), not from this file:
     { "calm":    "<all chillers, no wind, recommended spacing>",
       "wind":    ["<chiller 1>", "<chiller 2>", "<chiller 3>"],      dominant wind from the left
       "walls":   ["<chiller 1>", "<chiller 2>", "<chiller 3>"],      compound walls as high as the chillers
       "aligned": "<all chillers aligned with the wind>",
       "note":    "<where the descriptions come from>" } */
window.HVACWidgets.define('multi-chiller-explore', function (root, api) {
  'use strict';
  const d = api.need(['calm', 'wind', 'walls', 'aligned']);
  const txt = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');   // shown as plain text
  const C = api.COLORS;
  let wind = true, walls = false, aligned = false;
  const COL = { ok: C.blue, warm: C.amber, hot: C.orange };

  const fig = api.el('div', 'mc-fig');
  fig.appendChild(api.svg('<svg viewBox="0 0 360 220" role="img" aria-label="Three chillers with wind and air paths"><defs><marker id="mca" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9z" fill="context-stroke"/></marker></defs><g id="mc-g"></g></svg>'));
  root.appendChild(fig);
  const g = fig.querySelector('#mc-g');

  const opts = api.row();
  api.toggle({ label: 'Dominant wind from the left', value: true, host: opts, onInput: v => { wind = v; draw(); } });
  api.toggle({ label: 'Compound walls as high as the chillers', host: opts, onInput: v => { walls = v; draw(); } });
  api.toggle({ label: 'Align the chillers with the wind (plan view)', host: opts, onInput: v => { aligned = v; draw(); } });
  const ro = api.readouts(['Chiller 1', 'Chiller 2', 'Chiller 3']);
  api.legend([{ label: 'Circuit in fresh air', color: COL.ok }, { label: 'Warmed ambient', color: COL.warm }, { label: 'Over-temperature', color: COL.hot }]);
  api.note((d.note ? String(d.note) + ' ' : '') + 'Qualitative: colours follow the manual\'s description of each circuit. No temperatures are implied.');

  const fl = (dd, c) => `<path class="mc-flow" d="${dd}" style="stroke:${c}" marker-end="url(#mca)"/>`;

  function elevation(state) {
    let s = '<line x1="0" y1="190" x2="360" y2="190" class="mc-ground"/>';
    const xs = [40, 150, 260];
    if (walls) s += '<rect x="8" y="118" width="8" height="72" class="mc-wall"/><rect x="344" y="118" width="8" height="72" class="mc-wall"/>';
    xs.forEach((x, i) => {
      const [a, b] = state[i];
      s += `<rect x="${x}" y="120" width="30" height="70" style="fill:${COL[a]}" class="mc-zone"/><rect x="${x + 30}" y="120" width="30" height="70" style="fill:${COL[b]}" class="mc-zone"/>`;
      s += `<rect x="${x}" y="120" width="60" height="70" rx="3" class="mc-unit"/>`;
      s += `<text class="mc-t" x="${x + 30}" y="208" text-anchor="middle">Chiller ${i + 1}</text>`;
      const bend = wind ? 38 : 0;
      s += fl(`M${x + 18} 118 Q${x + 18} 80 ${x + 18 + bend} 60`, C.orange) + fl(`M${x + 42} 118 Q${x + 42} 80 ${x + 42 + bend} 60`, C.orange);
      if (wind && i > 0) s += fl(`M${x - 40} 75 Q${x - 10} 100 ${x - 2} 150`, C.orange);
    });
    if (walls) s += fl('M300 70 Q345 70 330 140', C.orange) + fl('M190 70 Q235 70 222 140', C.orange);
    if (wind) s += fl('M2 40 L70 40', C.blue) + '<text class="mc-t" x="4" y="30">wind</text>';
    s += fl(`M${walls ? 20 : 4} 165 L38 165`, C.blue);
    if (!walls) s += fl('M356 165 L322 165', C.blue);
    return s;
  }

  function plan() {
    let s = '<text class="mc-t" x="4" y="16">plan view: long sides parallel to the wind</text>';
    [40, 100, 160].forEach((y, i) => {
      s += `<rect x="70" y="${y}" width="220" height="40" rx="3" style="fill:${COL.ok}" class="mc-zone"/><rect x="70" y="${y}" width="220" height="40" rx="3" class="mc-unit"/>`;
      for (let k = 0; k < 6; k++) s += `<circle cx="${92 + k * 35}" cy="${y + 20}" r="12" class="mc-fan"/>`;
      s += fl(`M6 ${y + 20} L64 ${y + 20}`, C.blue) + fl(`M296 ${y + 20} L352 ${y + 20}`, C.orange);
      s += `<text class="mc-t" x="180" y="${y + 54}" text-anchor="middle">Chiller ${i + 1}</text>`;
    });
    return s;
  }

  const at = (list, i) => txt(Array.isArray(list) ? list[i] || '' : list);
  function draw() {
    if (aligned) {
      api.put(g, plan());
      [0, 1, 2].forEach(i => ro(i, txt(d.aligned), 'Preferred'));
      return;
    }
    let state;
    if (walls) {
      state = [['ok', 'ok'], ['warm', 'warm'], ['hot', 'hot']];
      ro(0, at(d.walls, 0), 'Not recommended'); ro(1, at(d.walls, 1), 'Hotter'); ro(2, at(d.walls, 2), 'Hotter');
    } else if (wind) {
      state = [['ok', 'ok'], ['warm', 'warm'], ['hot', 'ok']];
      ro(0, at(d.wind, 0), 'Normal'); ro(1, at(d.wind, 1), 'Warmed'); ro(2, at(d.wind, 2), 'Left hot');
    } else {
      state = [['ok', 'ok'], ['ok', 'ok'], ['ok', 'ok']];
      [0, 1, 2].forEach(i => ro(i, txt(d.calm), 'Normal'));
    }
    api.put(g, elevation(state));
  }
  draw();
});
