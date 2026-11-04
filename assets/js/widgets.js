/*
 * HVAC Notes: interactive blocks inside pages.
 *
 * A page declares a block as a fenced code block with the language "widget" and a JSON spec:
 *
 *   ```widget
 *   {"type": "practice", "title": "…", "problems": [ … ]}
 *   ```
 *
 * Types:
 *   explore   an explorer that is tile code: "src": "widgets/<name>.js" runs assets/js/widgets/<name>.js, which
 *             registers itself with HVACWidgets.define('<name>', (root, api) => { … }). The script is public; any
 *             figures from a manufacturer's documents are not in it but in the page, as "data": { … } in the spec,
 *             and reach the script as api.data.
 *   practice  problems with random numbers; the reader answers, the block marks the answer and shows
 *             the working; missed problems go to the Review queue.
 *   draw      an SVG from the page's images, whose <g id="…"> groups are drawn one step at a time, then a checklist.
 *
 * Templates in practice problems use [[name]] for a value and [[= expression | decimals]] for a calculation, so KaTeX
 * braces are never touched. Expressions are evaluated by HNExpr (hn-expr.js), never by eval.
 */
(function () {
  'use strict';

  const NAMES = ['bag-depth-explore', 'clearance-explore', 'fans-explore', 'filter-wall-explore', 'multi-chiller-explore',
    'pf-explore', 'psychro-chart-explore', 'psychro-mix-explore', 'vi-explore'];
  const BASE = '/hvac-notes/assets/js/widgets/';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HN = window.HN;

  function fmt(x, dp) {
    if (typeof x === 'string') return x;
    if (typeof x === 'boolean') return x ? 'yes' : 'no';
    if (!isFinite(x)) return '–';
    if (dp == null) {
      const a = Math.abs(x);
      return x.toLocaleString('en-GB', { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4 });
    }
    return x.toLocaleString('en-GB', { minimumFractionDigits: +dp, maximumFractionDigits: +dp });
  }
  const evalExpr = (expr, v) => window.HNExpr.evaluate(expr, v);
  function fill(tpl, v, dps) {
    return String(tpl)
      .replace(/\[\[=\s*([^\]|]+?)\s*(?:\|\s*(\d+)\s*)?\]\]/g, (_, e, dp) => { try { return fmt(evalExpr(e, v), dp); } catch (err) { return '?'; } })
      .replace(/\[\[\s*(\w+)\s*\]\]/g, (m, n) => (n in v ? fmt(v[n], dps[n]) : m));
  }
  const pick = r => {
    if (Array.isArray(r)) return r[Math.floor(Math.random() * r.length)];
    const step = r.step || 1, n = Math.round((r.max - r.min) / step);
    return +(r.min + step * Math.floor(Math.random() * (n + 1))).toFixed(10);
  };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(label, cls) { const b = el('button', 'w-btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; return b; }

  // A label or readout written in code with a little markup: <br>, <sub>, <sup>, <b>, <i> and &lt; &gt; &amp;.
  // Built as nodes; anything else stays text.
  function rich(s) {
    const frag = document.createDocumentFragment();
    const ent = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const stack = [frag];
    String(s == null ? '' : s).split(/(<\/?(?:br|sub|sup|b|i)\s*\/?>)/i).forEach(part => {
      const m = /^<(\/?)(br|sub|sup|b|i)\s*\/?>$/i.exec(part);
      const top = stack[stack.length - 1];
      if (!m) { if (part) top.append(ent(part)); return; }
      const tag = m[2].toLowerCase();
      if (tag === 'br') { top.append(document.createElement('br')); return; }
      if (m[1]) { if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tag) stack.pop(); return; }
      const e = document.createElement(tag); top.append(e); stack.push(e);
    });
    return frag;
  }

  // SVG markup written by a widget (numbers from its sliders, labels from its code): sanitized like content and
  // put into a group or an element as nodes, with style="" applied through the CSS object model.
  function svgNodes(markup) {
    const s = String(markup).trim();
    const whole = /^<svg[\s>]/i.test(s);
    const wrapped = whole ? s.replace(/^<svg(?![^>]*xmlns=)/i, `<svg xmlns="${SVG_NS}"`) : `<svg xmlns="${SVG_NS}">${s}</svg>`;
    const root = HN.contentSvg(wrapped);
    if (!root) return document.createDocumentFragment();
    if (whole) return root;
    const f = document.createDocumentFragment();
    while (root.firstChild) f.appendChild(root.firstChild);
    return f;
  }
  function put(host, markup) { HN.render(host, svgNodes(markup)); }

  /* ---------------- SVG chart ---------------- */
  function chart(host, o) {
    const W = o.width || 360, Ht = o.height || 250, m = { l: 46, r: 12, t: 12, b: 38 };
    const iw = W - m.l - m.r, ih = Ht - m.t - m.b;
    const [x0, x1] = o.x, [y0, y1] = o.y;
    const X = x => m.l + iw * (x - x0) / (x1 - x0), Y = y => m.t + ih * (1 - (y - y0) / (y1 - y0));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${Ht}`); svg.setAttribute('class', 'w-chart');
    svg.setAttribute('role', 'img'); if (o.label) svg.setAttribute('aria-label', o.label);
    const S = HN.svg;
    const grid = [];
    (o.yticks || []).forEach(t => { grid.push(S`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" class="w-grid"></line><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="w-tick">${fmt(t, 0)}</text>`); });
    (o.xticks || []).forEach(t => { grid.push(S`<text x="${X(t)}" y="${m.t + ih + 15}" text-anchor="middle" class="w-tick">${fmt(t, 0)}</text>`); });
    grid.push(S`<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" class="w-axis"></line><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ih}" class="w-axis"></line>`);
    if (o.xlabel) grid.push(S`<text x="${m.l + iw}" y="${Ht - 4}" text-anchor="end" class="w-axlabel">${o.xlabel}</text>`);
    if (o.ylabel) grid.push(S`<text x="${m.l + 4}" y="${m.t + 12}" class="w-axlabel">${o.ylabel}</text>`);
    const g = document.createElementNS(SVG_NS, 'g'); HN.render(g, grid); svg.appendChild(g);
    const data = document.createElementNS(SVG_NS, 'g'); data.setAttribute('class', 'w-data'); svg.appendChild(data);
    host.appendChild(svg);
    const layers = new Map();
    const layer = key => { if (!layers.has(key)) { const l = document.createElementNS(SVG_NS, 'g'); layers.set(key, l); data.appendChild(l); } return layers.get(key); };
    const clip = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    return {
      X, Y,
      line(key, f, s = {}) {
        const pts = [];
        if (typeof f === 'function') {
          const n = 120;
          for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = f(x); if (y == null || !isFinite(y)) continue; if (y < y0 || y > y1) { if (pts.length) break; continue; } pts.push([x, y]); }
        } else f.forEach(p => { if (clip(p[0], p[1])) pts.push(p); });
        HN.render(layer(key), pts.length < 2 ? '' : S`<polyline fill="none" points="${pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" style="${`stroke:${s.color || 'var(--text2)'};stroke-width:${s.width || 2.2}${s.dash ? ';stroke-dasharray:' + s.dash : ''}`}" stroke-linecap="round" stroke-linejoin="round"></polyline>`);
      },
      dot(key, x, y, s = {}) {
        if (x == null || !clip(x, y)) { HN.render(layer(key)); return; }
        const c = s.color || 'var(--text)', st = `fill:${c};stroke:var(--paper);stroke-width:2`;
        HN.render(layer(key), s.shape === 'diamond'
          ? S`<rect x="${X(x) - 5}" y="${Y(y) - 5}" width="10" height="10" transform="rotate(45 ${X(x)} ${Y(y)})" style="${st}"></rect>`
          : S`<circle cx="${X(x)}" cy="${Y(y)}" r="5.5" style="${st}"></circle>`);
      },
      text(key, x, y, t, s = {}) { HN.render(layer(key), S`<text x="${X(x)}" y="${Y(y)}" text-anchor="${s.anchor || 'start'}" class="w-lab" style="${'fill:' + (s.color || 'var(--text2)')}">${t}</text>`); },
      clear(key) { HN.render(layer(key)); }
    };
  }

  /* ---------------- explore (tile code) ---------------- */
  const defs = {}, loading = {};
  function load(name) {
    if (defs[name]) return Promise.resolve(defs[name]);
    if (!loading[name]) loading[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + name + '.js';
      s.onload = () => defs[name] ? resolve(defs[name]) : reject(new Error('Widget did not register'));
      s.onerror = () => { delete loading[name]; reject(new Error('Widget not found')); };
      document.head.appendChild(s);
    });
    return loading[name];
  }
  const COLORS = { blue: 'var(--w-blue)', orange: 'var(--w-orange)', green: 'var(--w-green)', purple: 'var(--w-violet)', gray: 'var(--w-gray)',
    red: 'var(--w-red)', amber: 'var(--w-amber)', rose: 'var(--w-rose)', coil: 'var(--w-coil)' };
  async function explore(body, spec, ctx) {
    const name = String(spec.src || '').replace(/^\.\//, '').replace(/^widgets\//, '').replace(/\.js$/, '');
    if (!NAMES.includes(name)) throw new Error('Unknown widget');
    const fn = await load(name);
    const api = {
      el, fmt, rich, put, svg: svgNodes, chart: o => chart(body, o), md: ctx.md, mdInline: ctx.mdInline,
      data: ctx.data, COLORS,
      color: c => COLORS[c] || COLORS.gray,
      slider(o) {
        const row = el('label', 'w-slider');
        const inp = document.createElement('input'), out = document.createElement('output');
        Object.assign(inp, { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: o.value });
        row.append(el('span', 'w-sl-name', o.label), inp, out);
        const show = () => { out.textContent = (o.format ? o.format(+inp.value) : inp.value) + (o.unit ? ' ' + o.unit : ''); };
        inp.addEventListener('input', () => { show(); if (o.onInput) o.onInput(+inp.value); });
        show(); body.appendChild(row); return inp;
      },
      toggle(o) {
        const row = el('label', 'w-toggle');
        const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!o.value;
        row.append(inp, el('span', null, o.label));
        inp.addEventListener('change', () => { if (o.onInput) o.onInput(inp.checked); });
        (o.host || body).appendChild(row); return inp;
      },
      row(cls) { const r = el('div', 'w-row' + (cls ? ' ' + cls : '')); body.appendChild(r); return r; },
      readouts(names) {
        const g = el('div', 'w-readouts'); body.appendChild(g);
        const cells = names.map(n => { const c = el('div', 'w-readout'); c.append(el('span', 'w-ro-name', n), el('span', 'w-ro-val'), el('span', 'w-ro-big')); g.appendChild(c); return c; });
        return (i, val, big) => { HN.render(cells[i].querySelector('.w-ro-val'), rich(val)); HN.render(cells[i].querySelector('.w-ro-big'), rich(big || '')); };
      },
      legend(items) {
        const box = el('div', 'w-legend');
        items.forEach(it => {
          const span = el('span'), i = document.createElement('i');
          i.style.borderTop = `2.5px ${it.dash ? 'dashed' : 'solid'} ${it.color}`;
          span.append(i, it.label); box.appendChild(span);
        });
        body.appendChild(box);
      },
      note(t) { body.appendChild(el('p', 'w-note', t)); },
      // A block whose figures come from the page: says so plainly when the page does not carry them.
      need(keys) {
        const d = ctx.data;
        const missing = !d || typeof d !== 'object' ? keys : keys.filter(k => d[k] === undefined || d[k] === null);
        if (missing.length) throw Object.assign(new Error('missing data'), { userMessage: 'This block needs its figures in the page (' + missing.join(', ') + ').' });
        return d;
      }
    };
    fn(body, api);
  }

  /* ---------------- practice ---------------- */
  function practice(body, spec, ctx) {
    const problems = spec.problems || [spec];
    let pi = Math.floor(Math.random() * problems.length), P, v, dps;
    const stage = el('div', 'w-prac'); body.appendChild(stage);
    const bar = el('div', 'w-bar');
    const bNew = button(problems.length > 1 ? 'New problem' : 'New numbers'), bCheck = button('Check', 'w-primary'), bWork = button('Show working');
    bar.append(bCheck, bWork, bNew); body.appendChild(bar);
    const score = el('p', 'w-score'); body.appendChild(score);
    const tally = { right: 0, tries: 0 };
    const label = a => String(a.label || '').replace(/\$[^$]*\$/g, '').trim() || 'Answer';

    function generate() {
      P = problems[pi]; v = {}; dps = {};
      Object.entries(P.vars || {}).forEach(([n, r]) => { v[n] = pick(r); if (r.dp != null) dps[n] = r.dp; });
      Object.entries(P.calc || {}).forEach(([n, e]) => { const [ex, dp] = String(e).split('|'); v[n] = evalExpr(ex, v); if (dp != null) dps[n] = +dp; });
      HN.render(stage, HN.html`<div class="w-prob">${ctx.md(fill(P.prompt, v, dps))}</div>
        <div class="w-answers">${P.answers.map((a, i) => HN.html`<label class="w-ans"><span class="w-ans-l">${ctx.mdInline(a.label)}</span>
          <span class="w-ans-in"><input type="text" inputmode="decimal" autocomplete="off" data-i="${i}" aria-label="${label(a)}"><span class="w-unit">${a.unit || ''}</span></span>
          <span class="w-mark" data-m="${i}"></span></label>`)}</div>
        <div class="w-work" hidden>${(P.working || []).map(l => HN.html`<div class="w-step">${ctx.md(fill(l, v, dps))}</div>`)}</div>`);
      stage.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); }));
    }
    const expected = a => evalExpr(a.expr, v);
    function check() {
      let ok = 0, filled = 0;
      P.answers.forEach((a, i) => {
        const inp = stage.querySelector(`input[data-i="${i}"]`), mk = stage.querySelector(`[data-m="${i}"]`);
        const raw = inp.value.replace(/,/g, '').trim();
        if (!raw) { mk.className = 'w-mark'; mk.textContent = 'Enter an answer'; return; }
        filled++;
        const x = parseFloat(raw), e = expected(a);
        const tol = Math.max(Math.abs(e) * (a.tol != null ? a.tol : 0.01), a.dp != null ? 0.5 * Math.pow(10, -a.dp) : 0);
        const good = isFinite(x) && Math.abs(x - e) <= tol;
        if (good) ok++;
        mk.className = 'w-mark ' + (good ? 'w-ok' : 'w-bad');
        mk.textContent = good ? '✓' : '✗ ' + fmt(e, a.dp) + (a.unit ? ' ' + a.unit : '');
      });
      if (!filled) return;
      tally.tries++; if (ok === P.answers.length) tally.right++;
      score.textContent = `${tally.right} of ${tally.tries} fully right`;
      stage.querySelector('.w-work').hidden = false;
      if (ok < P.answers.length && ctx.addReview) {
        ctx.addReview({
          q: fill(P.prompt, v, dps),
          a: P.answers.map(a => `${a.label} **${fmt(expected(a), a.dp)}${a.unit ? ' ' + a.unit : ''}**`).join('  \n') + '\n\n' + (P.working || []).map(l => fill(l, v, dps)).join('\n\n')
        });
      }
    }
    bCheck.onclick = check;
    bWork.onclick = () => { stage.querySelector('.w-work').hidden = false; };
    bNew.onclick = () => { if (problems.length > 1) pi = (pi + 1) % problems.length; generate(); };
    generate();
  }

  /* ---------------- draw ---------------- */
  async function draw(body, spec, ctx) {
    const txt = await ctx.text(spec.svg);
    const svg = HN.contentSvg(txt);
    if (!svg) throw new Error('Not an SVG');
    svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('class', 'w-draw-svg');
    const fig = el('div', 'w-draw'); fig.appendChild(svg); body.appendChild(fig);
    const ids = new Map([...svg.querySelectorAll('g[id]')].map(g => [g.getAttribute('id'), g]));
    const steps = spec.steps.map(s => ({ label: s.label, nodes: (s.ids || []).map(id => ids.get(id)).filter(Boolean) }));
    const cap = el('p', 'w-draw-cap'); body.appendChild(cap);
    const bar = el('div', 'w-bar');
    const bNext = button('Next stroke', 'w-primary'), bAll = button('Show all'), bReset = button('Start again');
    bar.append(bNext, bAll, bReset); body.appendChild(bar);
    const list = el('div', 'w-check');
    if (spec.checklist) {
      list.append(el('p', 'w-check-h', spec.checklistTitle || 'The sketch shows'));
      spec.checklist.forEach(c => { const l = el('label'), i = document.createElement('input'), sp = el('span'); i.type = 'checkbox'; sp.append(ctx.mdInline(c)); l.append(i, sp); list.appendChild(l); });
    }
    list.hidden = true; body.appendChild(list);
    let i = 0;
    const hideAll = () => steps.forEach(s => s.nodes.forEach(n => { n.style.opacity = '0'; }));
    function reveal(s, animate) {
      s.nodes.forEach(n => {
        n.style.opacity = '1';
        if (!animate) return;
        n.querySelectorAll('path, line, polyline, circle, rect').forEach(p => {
          let L = 0; try { L = p.getTotalLength(); } catch (e) { L = 0; }
          if (!L) return;
          p.style.transition = 'none'; p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
          p.getBoundingClientRect();
          p.style.transition = 'stroke-dashoffset .9s ease'; p.style.strokeDashoffset = '0';
          p.addEventListener('transitionend', () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.style.transition = ''; }, { once: true });
        });
      });
    }
    function update() {
      if (i === 0) cap.textContent = spec.start || '';
      else HN.render(cap, el('span', 'w-stepno', `${i} of ${steps.length}`), ' ', ctx.mdInline(steps[i - 1].label));
      bNext.disabled = i >= steps.length;
      list.hidden = i < steps.length;
    }
    bNext.onclick = () => { if (i < steps.length) { reveal(steps[i], !reduced()); i++; update(); } };
    bAll.onclick = () => { while (i < steps.length) { reveal(steps[i], false); i++; } update(); };
    bReset.onclick = () => { i = 0; hideAll(); list.querySelectorAll('input').forEach(c => { c.checked = false; }); update(); };
    hideAll(); update();
  }

  const TYPES = { explore, practice, draw };
  const KIND = { explore: 'Explore', practice: 'Practice', draw: 'Draw it' };

  window.HVACWidgets = {
    KIND, NAMES,
    define(name, fn) { if (NAMES.includes(name) && typeof fn === 'function') defs[name] = fn; },
    async mount(body, spec, ctx) {
      HN.render(body);
      const f = spec && TYPES[spec.type];
      if (!f) { body.textContent = 'This block cannot be shown.'; return; }
      try { await f(body, spec, ctx); }
      catch (e) { HN.render(body, el('p', 'w-note', (e && e.userMessage) || 'This block could not be loaded.')); }
    }
  };
})();
