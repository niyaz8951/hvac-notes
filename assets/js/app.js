/* HVAC Notes reader: library, notebooks, pages, highlights, search, review. Guard first (core); content and the
   reader's own data come from the database and the private bucket (hn-data.js); every node is built with HN.html or
   from sanitized Markdown (hn-dom.js). Part 1 of 2: content rendering, chrome and views. Part 2 (app-reader.js):
   the reader, highlights, sheets, search and the router. */
(function () {
  'use strict';

  /* ================= constants ================= */

  const TABS = [
    { id: 'theory', name: 'Theory', icon: 'i-theory', kicker: 'Fundamentals', blurb: 'Thermodynamics, psychrometrics, heat transfer, fluid flow, the refrigeration cycle, fan and pump laws, acoustics and ventilation.' },
    { id: 'chillers', name: 'Chillers', icon: 'i-chillers', kicker: 'Air-cooled', blurb: 'Compressors, refrigerants, high-ambient operation, part load, controls, plant integration and selection.' },
    { id: 'ahu', name: 'AHU', icon: 'i-ahu', kicker: 'Air handling units', blurb: 'Chilled-water and DX units, fresh air units, heat recovery, hygienic designs, and the parts inside them.' },
    { id: 'fcu', name: 'FCU', icon: 'i-fcu', kicker: 'Fan coil units', blurb: 'Ducted, cassette, hi-wall and floor units; 2-pipe and 4-pipe; AC and EC motors; noise and condensate.' },
    { id: 'systems', name: 'Systems', icon: 'i-systems', kicker: 'Whole building', blurb: 'Chilled-water plants, district cooling, BMS and protocols, sequences of operation, testing, balancing and commissioning.' },
    // Books: reading notes on one book, chapter by chapter. On the Books shelf and in the sidebar, not in the tab bar.
    { id: 'ashrae', name: 'ASHRAE Handbook', cover: 'ASHRAE', icon: 'i-book', kicker: 'Fundamentals 2021', book: true, blurb: 'Reading notes on the ASHRAE Handbook — Fundamentals (2021), chapter by chapter, in our own words, with links to where each idea lives in the notebooks.' }
  ];
  const TAB = Object.fromEntries(TABS.map(t => [t.id, t]));
  const PRODUCTS = ['chillers', 'ahu', 'fcu'].map(id => TAB[id]);
  const BOOKS = ['theory', 'ashrae', 'systems'].map(id => TAB[id]);
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
  const THEMES = [
    { id: 'auto', name: 'Auto' }, { id: 'light', name: 'White' }, { id: 'sepia', name: 'Sepia' }, { id: 'gray', name: 'Gray' }, { id: 'dark', name: 'Night' }
  ];
  const SIZES = [15, 16, 17, 18, 19, 20, 22, 24, 26, 28];
  const SITE = 'HVAC Notes';
  const VIEW_KEY = 'dame.hvac-notes.view';

  /* ================= dom + helpers ================= */

  const { html, render, clone } = window.HN;
  const icon = window.HN.icon;
  const D = window.HNData;
  const $ = (s, el = document) => el.querySelector(s);
  const root = document.documentElement;
  const main = $('#main'), navbar = $('#navbar'), navLeft = $('#nav-left'), navTitle = $('#nav-title'), navRight = $('#nav-right');
  const sidebar = $('#sidebar'), tabbar = $('#tabbar'), hlBar = $('#hl-bar');
  const sheet = $('#sheet'), sheetBody = $('#sheet-body'), backdrop = $('#sheet-backdrop');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Only for building the HTML string that the sanitizer reads (never inserted as markup by this code).
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slugify = window.HVACIndex.slugify;          // shared with the Publish page, so heading ids always match
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const one = frag => frag.firstElementChild;
  const chev = () => html`<svg class="row-chev" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevron"></use></svg>`;

  // View settings only (paper, font, size, layout, depth): kept on the device, cleared at sign-out.
  function readView() { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') || {}; } catch (e) { return {}; } }
  const settings = Object.assign({ size: 18, font: 'serif', paper: 'auto', mode: 'scroll', depth: 'full', focusK: 1, others: 'show' }, readView());
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(settings)); } catch (e) { /* view settings are optional */ } }

  // The reader's own data, from the database (hn-data.js). Re-bound after a restore.
  let positions, highlights, cardState, reviewState, practiceState, seen;
  function bindMine() {
    positions = D.my.positions; highlights = D.my.highlights; cardState = D.my.cards;
    reviewState = D.my.state.review; practiceState = D.my.state.practice; seen = D.my.state.seen;
  }
  const saveReview = () => D.save.state('review');
  const savePractice = () => D.save.state('practice');
  const saveSeen = () => { D.my.state.seen = seen; D.save.state('seen'); };

  const toast = msg => Core.toast(msg);
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (er) { /* nothing else to try */ } ta.remove();
    }
    toast('Copied');
  }

  /* ================= content ================= */

  const loadNav = tab => D.nav(tab);
  const loadPage = (tab, slug) => D.page(tab, slug);

  /* Markdown with KaTeX maths: code is protected first so "$" inside it is never maths. The HTML string goes
     through the sanitizer (HN.content) and comes back as nodes. */
  function renderMarkdown(md) {
    const code = [], math = [];
    let src = md.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g, m => `KTXCODE${code.push(m) - 1}END`)
      .replace(/(`+)[^`\n][\s\S]*?\1/g, m => `KTXCODE${code.push(m) - 1}END`);
    src = src.replace(/\\\$/g, 'KTXDOLLAREND')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `\n\nKTXMATHD${math.push(t) - 1}END\n\n`)
      .replace(/\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g, (_, t) => `KTXMATHI${math.push(t) - 1}END`);
    // [^3] or [^2, 4]: numbered references to the page's Sources list.
    src = src.replace(/\[\^([\d\s,]+)\]/g, (_, l) => `<sup class="src-ref no-hl">${l.split(',').map(n => n.trim()).filter(Boolean).map(n => `<button type="button" data-src="${+n}" aria-label="Source ${+n}">${+n}</button>`).join('<span>,</span>')}</sup>`);
    src = src.replace(/KTXCODE(\d+)END/g, (_, i) => code[+i]);
    const out = window.marked.parse(src, { gfm: true, breaks: false });
    const kt = (t, display) => {
      try { return window.katex.renderToString(t, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', trust: false }); }
      catch (e) { return `<code>${esc(t)}</code>`; }
    };
    const full = out.replace(/<p>KTXMATHD(\d+)END<\/p>/g, (_, i) => `<div class="math-display">${kt(math[+i], true)}</div>`)
      .replace(/KTXMATHD(\d+)END/g, (_, i) => `<div class="math-display">${kt(math[+i], true)}</div>`)
      .replace(/KTXMATHI(\d+)END/g, (_, i) => kt(math[+i], false))
      .replace(/KTXDOLLAREND/g, '$');
    return window.HN.content(full);
  }
  // A short piece of Markdown without its wrapping paragraph (labels, captions).
  function renderInline(md) {
    const f = renderMarkdown(md);
    if (f.childNodes.length === 1 && f.firstChild.nodeName === 'P') { const p = f.firstChild; const g = document.createDocumentFragment(); g.append(...p.childNodes); return g; }
    return f;
  }

  /* YouTube link → { id, start } or null. Accepts watch, youtu.be, shorts, embed and live links, with t= or start=. */
  function youtube(u) {
    let x; try { x = new URL(u); } catch (e) { return null; }
    const h = x.hostname.replace(/^(www|m)\./, '');
    let id = null;
    if (h === 'youtu.be') id = x.pathname.slice(1);
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (x.pathname === '/watch') id = x.searchParams.get('v');
      else { const m = x.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/); if (m) id = m[1]; }
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const t = x.searchParams.get('t') || x.searchParams.get('start') || '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { id, start };
  }
  const clock = s => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  const CALLOUTS = { general: 'General engineering', daikin: 'Daikin public documentation', example: 'Illustrative example', note: 'Note', tip: 'Tip', warning: 'Caution', key: 'Key ideas', check: 'Check yourself' };

  /* ================= term cards ================= */

  // Card colours: one hue each, mixed with the page colour, so they suit every theme.
  const KCOLORS = [
    ['coral', 'Coral'], ['peach', 'Peach'], ['sand', 'Sand'], ['mint', 'Mint'], ['sage', 'Sage'],
    ['fog', 'Fog'], ['storm', 'Storm'], ['dusk', 'Dusk'], ['blossom', 'Blossom'], ['clay', 'Clay']
  ];
  function autoColor(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return KCOLORS[Math.abs(h) % KCOLORS.length][0]; }
  const cardColor = key => (cardState[key] && cardState[key].color) || autoColor(key.split('/').pop());
  const cardNotesOf = tab => Object.entries(cardState).filter(([k, v]) => v.note && k.startsWith(tab + '/')).map(([key, v]) => ({ key, ...v }));
  const notesCount = tab => hlsOf(tab).length + cardNotesOf(tab).length;
  function cardEntry(key, title) {
    const [tab, slug, id] = key.split('/');
    return (cardState[key] = cardState[key] || { tab, slug, id, title, color: null, note: '' });
  }

  // Every ### heading and what follows it (up to the next heading) becomes a card; runs of cards share a grid.
  // A list whose items each start with a link becomes a set of small coloured tiles.
  function cardify(el, tab, slug) {
    let grid = null, card = null;
    for (const x of [...el.children]) {
      if (x.tagName === 'H3') {
        if (!grid) { grid = document.createElement('div'); grid.className = 'kgrid'; x.before(grid); }
        card = document.createElement('section');
        card.className = 'kcard'; card.dataset.k = `${tab}/${slug}/${x.id}`;
        grid.appendChild(card); card.appendChild(x);
        card.append(html`<button class="kcard-edit no-hl" type="button" aria-label="Colour and note">${icon('i-palette')}</button>`);
        continue;
      }
      if (/^H[1-2]$/.test(x.tagName)) { grid = card = null; continue; }
      if (card) {
        const lead = x.tagName === 'P' && x.firstElementChild && x.firstElementChild.tagName === 'STRONG' && x.firstChild === x.firstElementChild ? x.firstElementChild : null;
        if (lead) { lead.classList.add('klabel'); if (/^see also/i.test(lead.textContent)) x.classList.add('ksee'); }
        card.insertBefore(x, card.querySelector('.kcard-edit'));
        continue;
      }
      if (x.tagName === 'UL' && x.children.length && [...x.children].every(li => li.firstElementChild && li.firstElementChild.tagName === 'A' && li.firstChild === li.firstElementChild)) {
        x.classList.add('kchips');
        [...x.children].forEach(li => {
          li.dataset.c = autoColor(slugify(li.firstElementChild.textContent));
          const t = li.firstElementChild.nextSibling;        // "Term: meaning" → title on its own line, so drop the colon
          if (t && t.nodeType === 3) t.data = t.data.replace(/^\s*[:–—-]\s*/, '');
        });
      }
    }
    el.querySelectorAll('.kcard').forEach(paintCard);
  }

  // Card notes are shared: the reader's own (shown as "You") and everyone else's, each with the author's name.
  const othersOn = () => settings.others !== 'hide';
  const cardOthers = key => othersOn() ? (D.shared.cards[key] || []) : [];
  const cardNotes = key => {
    const st = cardState[key] || {};
    return (st.note ? [{ by: 'You', note: st.note, updated: st.updated, mine: true }] : []).concat(cardOthers(key));
  };
  const noteBy = (who, iso) => html`<span class="note-by">${who}${iso ? ` · ${fmtDate(iso)}` : ''}</span>`;
  function paintCard(card) {
    const key = card.dataset.k;
    card.dataset.c = cardColor(key);
    card.querySelectorAll('.kcard-note').forEach(n => n.remove());
    const edit = card.querySelector('.kcard-edit');
    cardNotes(key).forEach(x => card.insertBefore(one(html`<button class="kcard-note no-hl ${x.mine ? '' : 'other'}" type="button">${icon('i-note')}<span>${noteBy(x.by)}${x.note}</span></button>`), edit));
  }
  // Everyone else's notes on a card, in a sheet or focus mode; with 'edit', each can be removed.
  function otherNotes(key, onChange) {
    const list = cardOthers(key);
    if (!list.length) return '';
    const box = one(html`<div class="other-notes"><p class="sheet-sec">From others</p>${list.map(x => html`<div class="other-note">
      ${noteBy(x.by, x.updated)}<p class="note-text">${x.note}</p>
      ${canPublish() ? html`<button class="link-btn danger" type="button" data-rm="${x.id}">Remove</button>` : ''}</div>`)}</div>`);
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const x = list.find(n => String(n.id) === b.dataset.rm);
      if (!x || !await Core.confirm(`Remove ${x.by}'s note on this card? This cannot be undone.`, { ok: 'Remove', danger: true })) return;
      try { await D.remove.card(key, x.id); b.closest('.other-note').remove(); toast('Note removed'); if (onChange) onChange(); }
      catch (err) { Core.showError(err); }
    });
    return box;
  }

  function openCard(card) {
    const key = card.dataset.k, h = card.querySelector('h3'), title = h ? h.textContent : key;
    const cur = cardColor(key);
    openSheet(html`<div class="sheet-head"><span></span><h2>${title}</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="sheet-swatches kswatches" role="group" aria-label="Colour">${KCOLORS.map(([c, name]) => html`<button class="kswatch" type="button" data-c="${c}" aria-pressed="${c === cur}" aria-label="${name}" title="${name}"></button>`)}</div>
      <textarea class="note-input" id="card-note" placeholder="Note" aria-label="Note"></textarea>
      <p class="sheet-hint">Your note is seen by everyone with HVAC Notes. The colour is yours only.</p>
      ${otherNotes(key, () => paintCard(card))}`, body => {
      body.querySelectorAll('.kswatch').forEach(b => b.onclick = () => {
        Object.assign(cardEntry(key, title), { color: b.dataset.c, title, updated: new Date().toISOString() }); D.save.card(key, 0);
        body.querySelectorAll('.kswatch').forEach(x => x.setAttribute('aria-pressed', x === b));
        paintCard(card);
      });
      const note = $('#card-note');
      note.value = (cardState[key] || {}).note || '';
      note.oninput = debounce(() => {
        Object.assign(cardEntry(key, title), { note: note.value.trim(), title, updated: new Date().toISOString() }); D.save.card(key);
        paintCard(card); renderSidebar();
        if (R && settings.mode === 'pages') layout(fraction());
      }, 250);
    });
  }

  /* ---- callouts: "> [!type] Title" as the first line of a blockquote ---- */
  const isBlank = p => [...p.childNodes].every(n => n.nodeType === 3 && !n.data.trim());
  // The nodes on the first line of a paragraph (up to a line break or a newline in the text), taken out of it.
  function takeFirstLine(p) {
    const out = document.createDocumentFragment();
    while (p.firstChild) {
      const n = p.firstChild;
      if (n.nodeName === 'BR') { n.remove(); if (p.firstChild && p.firstChild.nodeType === 3) p.firstChild.data = p.firstChild.data.replace(/^\n/, ''); break; }
      if (n.nodeType === 3) {
        const i = n.data.indexOf('\n');
        if (i >= 0) { out.append(n.data.slice(0, i)); n.data = n.data.slice(i + 1); if (!n.data) n.remove(); break; }
      }
      out.append(n);
    }
    const a = out.firstChild, z = out.lastChild;
    if (a && a.nodeType === 3) a.data = a.data.replace(/^\s+/, '');
    if (z && z.nodeType === 3) z.data = z.data.replace(/\s+$/, '');
    return out;
  }
  function callouts(el) {
    el.querySelectorAll('blockquote').forEach(bq => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P' || !p.firstChild || p.firstChild.nodeType !== 3) return;
      const t = p.firstChild, m = t.data.match(/^\s*\[!(\w+)\][ \t]*/);
      if (!m || !CALLOUTS[m[1].toLowerCase()]) return;
      const type = m[1].toLowerCase();
      t.data = t.data.slice(m[0].length);
      if (type === 'check') {
        // > [!check] Question (to the end of the line)
        // > Answer, revealed on tap.
        const q = takeFirstLine(p);
        if (isBlank(p)) p.remove();
        const d = one(html`<details class="hn-check"><summary class="no-hl"><span class="check-q"></span></summary><div class="check-a"></div></details>`);
        const qs = d.querySelector('.check-q');
        if (q.textContent.trim() || q.querySelector && q.querySelector('*')) qs.append(q); else qs.textContent = CALLOUTS.check;
        d.querySelector('.check-a').append(...bq.childNodes);
        bq.replaceWith(d);
        return;
      }
      // The title is the rest of the marker's line, up to any formatting (as before the move).
      const tm = t.data.match(/^([^\n]*)(\n|$)/);
      const title = tm[1].trim();
      t.data = t.data.slice(tm[0].length);
      if (!tm[2] && !t.data && t.nextSibling && t.nextSibling.nodeName === 'BR') t.nextSibling.remove();
      if (!t.data) t.remove();
      if (isBlank(p)) p.remove();
      const aside = one(html`<aside class="callout callout-${type}"><p class="callout-title no-hl">${title || CALLOUTS[type]}</p></aside>`);
      aside.append(...bq.childNodes);
      bq.replaceWith(aside);
    });
  }

  function enhance(el, tab) {

    // ```widget {json}``` → an interactive block, mounted once the page is on screen (widgets.js).
    el.querySelectorAll('pre > code.language-widget').forEach(c => {
      let spec; try { spec = JSON.parse(c.textContent); } catch (e) { c.parentElement.remove(); return; }
      const kind = (window.HVACWidgets && window.HVACWidgets.KIND[spec.type]) || 'Interactive';
      const w = one(html`<div class="widget no-hl"><div class="widget-head"><span class="widget-kind">${kind}</span><span class="widget-title">${spec.title || ''}</span>
        <button class="widget-open" type="button" data-widget-open>Open</button></div><div class="widget-body"></div></div>`);
      w._spec = spec;
      c.parentElement.replaceWith(w);
    });
    const used = new Set(), deep = [];
    el.querySelectorAll('h2, h3, h4').forEach(h => {
      // "## Heading {.deeper}": a section a first reading can skip (hidden in Essentials).
      const last = h.lastChild;
      if (last && last.nodeType === 3 && /\s*\{\.deeper\}\s*$/.test(last.data)) { last.data = last.data.replace(/\s*\{\.deeper\}\s*$/, ''); deep.push(h); }
      let id = slugify(h.textContent), n = 2;
      while (used.has(id)) id = slugify(h.textContent) + '-' + n++;
      used.add(id); h.id = id;
    });
    deep.forEach(h => {
      if (h.classList.contains('deep')) return;        // already inside a deeper parent
      const level = +h.tagName[1], group = h.id;
      h.before(html`<button class="deep-chip no-hl" type="button" data-deep-open="${group}"><span>Deeper</span>${h.textContent}</button>`);
      let n = h;
      do { n.classList.add('deep'); n.dataset.deepOf = group; n = n.nextElementSibling; }
      while (n && !n.classList.contains('deep-chip') && !(/^H[1-6]$/.test(n.tagName) && +n.tagName[1] <= level));
    });
    el.querySelectorAll('table').forEach(t => {
      const w = document.createElement('div'); w.className = 'hn-table'; w.tabIndex = 0;
      w.setAttribute('role', 'region'); w.setAttribute('aria-label', 'Table');
      t.replaceWith(w); w.appendChild(t);
      numericColumns(t);
      if (t.querySelectorAll('tbody tr').length > 10) w.classList.add('tall');      // header stays in view
    });
    el.querySelectorAll('img').forEach(img => {
      const s = (img.getAttribute('data-src') || '').trim();
      img.removeAttribute('data-src');
      if (/^data:image\/(png|jpe?g|gif|webp);/i.test(s)) img.src = s;
      else if (s && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(s)) img.dataset.img = `${tab}/${s.replace(/^\.\//, '')}`;   // from the private bucket
      else { img.remove(); return; }                  // outside images are not loaded (CSP); the Publish check refuses them
      img.decoding = 'async';
      const p = img.parentElement;
      if (p && p.tagName === 'P' && p.childNodes.length === 1) {
        const fig = document.createElement('figure');
        p.replaceWith(fig); fig.appendChild(img);
        if (img.title) { const c = document.createElement('figcaption'); c.textContent = img.title; fig.appendChild(c); img.removeAttribute('title'); }
      }
    });
    // A YouTube link on a line of its own: a card that opens the video on YouTube (no player on this site).
    el.querySelectorAll('p').forEach(p => {
      const a = p.children.length === 1 && p.firstElementChild.tagName === 'A' && p.textContent.trim() === p.firstElementChild.textContent.trim() ? p.firstElementChild : null;
      const yt = a && youtube(a.getAttribute('href'));
      if (!yt) return;
      const text = a.textContent.trim(), name = /^https?:/.test(text) ? 'Video' : text;
      const url = `https://www.youtube.com/watch?v=${yt.id}${yt.start ? '&t=' + yt.start + 's' : ''}`;
      p.replaceWith(html`<figure class="video no-hl"><a class="video-card" href="${url}" target="_blank" rel="noopener noreferrer">
          <span class="video-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"></path></svg></span>
          <span class="video-text"><span class="video-name">${name}</span><span class="video-sub">Watch on YouTube${yt.start ? ' from ' + clock(yt.start) : ''}</span></span>
          ${icon('i-chevron')}</a>${a.title ? html`<figcaption>${a.title}</figcaption>` : ''}</figure>`);
    });
    el.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (/^https?:/.test(h)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.classList.add('ext'); return; }
      if (/^(#|mailto:|tel:)/.test(h)) return;
      const m = h.replace(/^\.\//, '').match(/^(?:\.\.\/([a-z0-9-]+)\/)?([a-z0-9-]+)(?:\.md)?(?:#([\w-]+))?$/i);
      if (m) a.setAttribute('href', `#/${m[1] || tab}/${m[2]}${m[3] ? '/' + m[3] : ''}`);
      else a.removeAttribute('href');
    });
    callouts(el);
    // In an example callout, everything after a "**Solution:**" paragraph is revealed one line at a time.
    el.querySelectorAll('aside.callout-example').forEach(a => {
      const sp = [...a.children].find(c => c.tagName === 'P' && /^solution:?$/i.test((c.querySelector('strong') || {}).textContent || '') && c.firstElementChild && c.firstElementChild.tagName === 'STRONG');
      if (!sp) return;
      const steps = [];
      let n = sp.nextElementSibling;
      while (n) { if (n.tagName === 'UL' || n.tagName === 'OL') steps.push(...n.children); else steps.push(n); n = n.nextElementSibling; }
      if (steps.length < 2) return;
      steps.forEach(x => x.classList.add('sol-step'));
      a.classList.add('sol');
      a.append(html`<div class="sol-bar no-hl"><button class="w-btn w-primary" type="button" data-sol-next>Next line</button><button class="w-btn" type="button" data-sol-all>Show all</button><span class="sol-count">0 of ${steps.length}</span></div>`);
    });
    // "### Symptom: …" and what follows it, up to the next heading, becomes a symptom card.
    [...el.children].filter(h => h.tagName === 'H3' && /^symptom:/i.test(h.textContent.trim())).forEach(h => {
      const sec = document.createElement('section'); sec.className = 'symptom';
      let n = h.nextElementSibling; h.before(sec); sec.appendChild(h);
      while (n && !/^H[1-3]$/.test(n.tagName)) { const nx = n.nextElementSibling; sec.appendChild(n); n = nx; }
      sec.querySelectorAll(':scope > p > strong:first-child').forEach(b => { if (b.parentElement.firstChild === b) b.classList.add('klabel'); });
    });
    fieldCards(el);
    const src = [...el.querySelectorAll('h2')].find(h => /^sources$/i.test(h.textContent.trim()));
    if (src) { let n = src.nextElementSibling; while (n && n.tagName !== 'H2') { n.classList.add('sources'); n = n.nextElementSibling; } }
    const list = src && [...el.querySelectorAll('ol.sources')][0];
    if (list) {
      [...list.children].forEach((li, i) => { li.id = 'src-' + (i + 1); });
      el.querySelectorAll('.src-ref button').forEach(b => { const li = list.children[+b.dataset.src - 1]; if (li) b.title = li.textContent.trim().replace(/\s+/g, ' ').slice(0, 180); });
    }
  }

  /* ---- In the field: recent research, articles, market reports, regulations, case studies, products ---- */
  function fmtMonth(d) {
    const [y, m, day] = d.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, day || 1));
    return dt.toLocaleDateString('en-GB', { ...(day ? { day: 'numeric' } : {}), month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function fieldItem(x, extra) {
    const k = slugify(x.kind);
    const hasNote = x.note && (typeof x.note === 'string' ? x.note.trim() : x.note.textContent.trim());
    return html`<a class="fd-head ext no-hl" href="${x.url}" target="_blank" rel="noopener noreferrer"><span class="fd-meta"><span class="fd-kind fk-${k}">${x.kind}</span><span>${x.src} · ${fmtMonth(x.date)}</span></span><span class="fd-title">${x.title}</span></a>${hasNote ? html`<p class="fd-note">${x.note}</p>` : ''}${extra || ''}`;
  }
  // "- [Title](https://…) · Source · 2026-05 · Kind" with a note on the next line becomes a link card.
  function fieldCards(el) {
    const h = [...el.querySelectorAll('h2')].find(x => /^in the field$/i.test(x.textContent.trim()));
    if (!h) return;
    for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) {
      if (n.tagName !== 'UL') continue;
      n.classList.add('field-list');
      [...n.children].forEach(li => {
        const box = li.firstElementChild && li.firstElementChild.tagName === 'P' ? li.firstElementChild : li;
        const a = box.firstElementChild;
        if (!a || a.tagName !== 'A' || box.firstChild !== a || !/^https?:/.test(a.getAttribute('href') || '')) return;
        const t = a.nextSibling;
        if (!t || t.nodeType !== 3) return;
        const m = t.data.match(/^\s*·\s*([^\n]*?)\s*·\s*(\d{4}-\d{2}(?:-\d{2})?)\s*·\s*([^\n]+?)\s*(?:\n|$)/);
        if (!m) return;
        t.data = t.data.slice(m[0].length).replace(/^\s+/, '');
        if (!t.data && t.nextSibling && t.nextSibling.nodeName === 'BR') t.nextSibling.remove();
        const title = document.createDocumentFragment(); title.append(...a.childNodes);
        const note = document.createDocumentFragment();
        while (a.nextSibling) note.append(a.nextSibling);
        const more = box === li ? [] : [...li.children].slice(1);
        li.className = 'fd';
        render(li, fieldItem({ url: a.getAttribute('href'), title, src: m[1], date: m[2], kind: m[3], note }), more);
      });
    }
  }

  /* ---- source references: [^n] opens item n of the page's Sources in place ---- */
  const sourcesCache = {};
  async function sourcesOf(route) {
    if (!sourcesCache[route]) {
      const [tab, slug] = route.split('/'), tpl = document.createElement('div');
      try { tpl.append(renderMarkdown(await loadPage(tab, slug))); enhance(tpl, tab); } catch (e) { /* no sources */ }
      sourcesCache[route] = [...tpl.querySelectorAll('ol.sources > li')];
    }
    return sourcesCache[route];
  }
  async function openSource(b) {
    const n = +b.dataset.src, inBook = b.closest('#book');
    const k = b.closest('[data-k]'), pg = b.closest('[data-page]');
    const route = k ? k.dataset.k.split('/').slice(0, 2).join('/') : pg ? pg.dataset.page : R ? `${R.tab}/${R.slug}` : null;
    if (!route) return;
    const li = (inBook && $('#src-' + n)) || (await sourcesOf(route))[n - 1];
    if (!li) { toast('Source not found'); return; }
    const here = R && route === `${R.tab}/${R.slug}` && where.view === 'reader';
    openSheet(html`<div class="sheet-head"><span></span><h2>Source ${n}</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="book peek-book src-peek"><p>${[...clone(li).childNodes]}</p></div>
      ${here ? html`<div class="sheet-actions"><button class="btn" type="button" data-all-sources>All sources</button></div>` : ''}`, body => {
      body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      const all = body.querySelector('[data-all-sources]');
      if (all) all.onclick = () => { closeSheet(); goToAnchor('sources'); };
    });
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a.ext[href^="http"]');
    if (a && navigator.standalone === true && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.assign(a.href); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('.src-ref button'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); openSource(b);
  }, true);

  // Columns that hold plain numbers are right-aligned on the decimal point. Only spacing changes: the values never do.
  const NUM = /^[−\-+±~≈<>≤≥]?\s?\d[\d,  ]*(?:\.(\d+))?\s?%?$/;
  function numericColumns(t) {
    const rows = [...t.querySelectorAll('tbody tr')];
    if (rows.length < 2 || rows.some(r => [...r.children].some(c => c.colSpan > 1))) return;
    const cols = Math.max(...rows.map(r => r.children.length));
    const head = t.querySelector('thead tr');
    for (let c = 0; c < cols; c++) {
      const cells = rows.map(r => r.children[c]).filter(Boolean), filled = cells.filter(x => x.textContent.trim());
      const nums = filled.filter(x => NUM.test(x.textContent.trim()));
      if (nums.length < 2 || nums.length / filled.length < 0.6) continue;
      const dec = x => { const m = x.textContent.trim().match(NUM); return m && m[1] ? m[1].length : 0; };
      const maxD = Math.max(...nums.map(dec));
      cells.forEach(x => x.classList.add('num'));
      nums.forEach(x => { const d = dec(x), pad = maxD - d + (d === 0 && maxD > 0 ? 0.3 : 0); if (pad) x.style.setProperty('--dp', pad + 'ch'); });
      if (head && head.children[c]) head.children[c].classList.add('num');
    }
  }
  // A table wider than the page keeps its first column in view while it scrolls sideways.
  function markWide(el) { el.querySelectorAll('.hn-table').forEach(w => w.classList.toggle('wide', w.scrollWidth > w.clientWidth + 2)); }

  // Images come from the private bucket through the reader's own session.
  function loadImages(el, onEach) {
    el.querySelectorAll('img[data-img]').forEach(async img => {
      const path = img.dataset.img;
      try {
        const url = await D.imageUrl(path);
        img.onload = onEach;
        img.src = url;
      } catch (e) { const f = img.closest('figure'); (f || img).remove(); }
    });
  }

  /* ================= settings ================= */

  function applySettings() {
    if (settings.paper === 'auto') delete root.dataset.paper; else root.dataset.paper = settings.paper;
    root.dataset.font = settings.font;
    root.dataset.depth = settings.depth === 'essentials' ? 'essentials' : 'full';
    root.style.setProperty('--read-size', settings.size + 'px');
    saveView();
    updateThemeColor();
  }
  function updateThemeColor() {
    requestAnimationFrame(() => { const m = $('#theme-color'); if (m) m.setAttribute('content', getComputedStyle(document.body).backgroundColor); });
  }

  /* ================= chrome: nav bar, tab bar, sidebar ================= */

  const backBtn = (href, label) => html`<a class="nav-btn nav-back" href="${href}">${icon('i-back')}<span>${label}</span></a>`;
  const searchBtn = () => html`<button class="nav-btn" id="btn-search" type="button" aria-label="Search">${icon('i-search')}</button>`;
  const focusBtn = () => html`<button class="nav-btn" id="btn-focus" type="button" aria-label="Focus mode">${icon('i-focus')}</button>`;

  function setNav({ left = '', title = '', right = '' }) {
    render(navLeft, left); navTitle.textContent = title; render(navRight, right);
    navbar.classList.remove('solid', 'show-title');
  }

  let ltObs;
  function watchLargeTitle() {
    if (ltObs) ltObs.disconnect();
    const lt = main.querySelector('.large-title');
    if (!lt) { navbar.classList.add('solid', 'show-title'); return; }
    ltObs = new IntersectionObserver(([e]) => {
      const past = !e.isIntersecting;
      navbar.classList.toggle('solid', past); navbar.classList.toggle('show-title', past);
    }, { rootMargin: `-${navbar.getBoundingClientRect().bottom}px 0px 0px 0px` });
    ltObs.observe(lt);
  }

  function renderTabbar() {
    const items = [{ id: 'library', name: 'Home', icon: 'i-home', href: '#/' }, ...PRODUCTS.map(t => ({ id: t.id, name: t.name, icon: t.icon, href: `#/${t.id}` }))];
    render(tabbar, items.map(b => html`<a class="tab" href="${b.href}" data-tab="${b.id}">${icon(b.icon)}<span>${b.name}</span></a>`),
      html`<button class="tab" type="button" data-act="search">${icon('i-search')}<span>Search</span></button>`);
    tabbar.querySelector('[data-act="search"]').addEventListener('click', () => openSearch());
  }

  const where = { view: 'library', tab: null, slug: null };
  function setActive(view, tab, slug) {
    Object.assign(where, { view, tab, slug });
    root.dataset.view = view;
    root.dataset.section = tab || 'library';
    tabbar.querySelectorAll('.tab').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === (tab || 'library')));
    renderSidebar();
  }

  const canPublish = () => !!(Core.user && (Core.user.is_super || (Core.user.rights || []).indexOf('edit') >= 0));

  async function renderSidebar() {
    const navs = await Promise.all(TABS.map(t => loadNav(t.id)));
    const { view, tab, slug } = where;
    const link = (href, t, name, ic, cur, count, cls) => html`<a class="side-link" href="${href}" data-tab="${t}" aria-current="${cur ? 'page' : null}">
      <span class="icon-tile ${cls || ''}">${icon(ic)}</span>${name}${count ? html`<span class="side-count">${count}</span>` : ''}</a>`;
    const count = t => navs[TABS.indexOf(t)].length;
    const parts = [
      html`<button class="side-search" type="button" data-act="search">${icon('i-search')}<span>Search</span></button>`,
      link('#/', 'library', 'Home', 'i-home', view === 'library'),
      html`<p class="side-label">Products</p>`,
      PRODUCTS.map(t => link(`#/${t.id}`, t.id, t.name, t.icon, tab === t.id, count(t))),
      html`<p class="side-label">Books</p>`,
      BOOKS.map(t => link(`#/${t.id}`, t.id, t.name, t.icon, tab === t.id, count(t))),
      html`<p class="side-label">Library</p>`,
      link('#/review', 'library', 'Review', 'i-review', view === 'review', '', 'it-review'),
      link('#/timeline', 'library', 'Timeline', 'i-timeline', view === 'timeline', '', 'it-timeline'),
      link('#/symptoms', 'library', 'Troubleshooting', 'i-wrench', view === 'symptoms', '', 'it-symptoms'),
      link('#/field', 'library', 'In the Field', 'i-globe', view === 'field', '', 'it-field'),
      link('#/terms', 'library', 'All Terms', 'i-az', view === 'terms', '', 'it-terms'),
      link('#/standards', 'library', 'All Standards', 'i-standards', view === 'standards', '', 'it-standards')
    ];
    if (canPublish()) parts.push(html`<a class="side-link" href="/hvac-notes/publish.html"><span class="icon-tile it-publish">${icon('i-upload')}</span>Publish</a>`);
    if (tab && TAB[tab]) {
      const pages = navs[TABS.findIndex(t => t.id === tab)], n = notesCount(tab);
      if (pages.length || n) parts.push(html`<p class="side-label">${TAB[tab].name}</p><ul class="side-pages">${pages.map(p => html`<li><a href="#/${tab}/${p.slug}" aria-current="${p.slug === slug ? 'page' : null}">${p.title}</a></li>`)}${n ? html`<li><a href="#/notebook/${tab}" aria-current="${view === 'notebook' ? 'page' : null}">Highlights &amp; Notes<span class="side-count">${n}</span></a></li>` : ''}</ul>`);
    }
    render(sidebar, parts);
    sidebar.querySelector('[data-act="search"]').onclick = () => openSearch();
  }

  /* ================= cover art (original line drawings) ================= */

  function coverArt(id) {
    const S = window.HN.svg;
    if (id === 'theory') {
      const curve = f => { const pts = []; for (let x = 0; x <= 100; x += 5) { const w = 92 * (Math.exp(x / 34) - 1) / (Math.exp(100 / 34) - 1); pts.push(`${10 + x},${(108 - w * f).toFixed(1)}`); } return pts.join(' '); };
      return html`<svg viewBox="0 0 120 120" aria-hidden="true">
        <g class="ln ca-faint" stroke-width="1">${[30, 50, 70, 90].map(x => S`<path d="M${x} 108V16"></path>`)}${[0.25, 0.5, 0.75].map(f => S`<polyline points="${curve(f)}"></polyline>`)}</g>
        <path class="ln" d="M10 108h102M110 108V14" stroke-width="1.5"></path>
        <polyline class="ln draw" points="${curve(1)}" stroke-width="2.6"></polyline></svg>`;
    }
    if (id === 'chillers') return html`<svg viewBox="0 0 120 120" aria-hidden="true"><g class="ln" stroke-width="2.2">
        <path d="M60 8v104M15 34l90 52M15 86l90-52"></path>
        <path d="M48 16l12 11 12-11M48 104l12-11 12 11M17 49l16-4-5-16M103 71l-16 4 5 16M28 91l5-16-16-4M92 29l-5 16 16 4"></path></g>
        <circle class="ln ca-faint" cx="60" cy="60" r="9" stroke-width="1.2"></circle></svg>`;
    if (id === 'ahu') return html`<svg viewBox="0 0 120 120" aria-hidden="true"><g class="ln" stroke-width="2.2">
        <path d="M6 40h62a14 14 0 1 0-14-14"></path><path d="M6 60h86a14 14 0 1 1-14 14"></path><path d="M6 80h40a12 12 0 1 1-12 12"></path></g>
        <g class="ln ca-faint" stroke-width="1"><path d="M6 100h100M6 20h100"></path></g></svg>`;
    if (id === 'ashrae') return html`<svg viewBox="0 0 120 120" aria-hidden="true">
        <g class="ln ca-faint" stroke-width="1"><path d="M66 40h36M66 50h36M66 60h28M18 40h36M18 50h36M18 60h30M18 70h36"></path></g>
        <g class="ln" stroke-width="2.2"><path d="M60 26C48 18 28 16 10 20v70c18-4 38-2 50 6 12-8 32-10 50-6V20c-18-4-38-2-50 6z"></path><path d="M60 26v70"></path></g>
        <path class="ln" d="M66 86c10-1 22-6 34-22" stroke-width="2"></path></svg>`;
    if (id === 'systems') return html`<svg viewBox="0 0 120 120" aria-hidden="true">
        <g class="ln ca-faint" stroke-width="1"><path d="M22 38v44M98 38v44M38 22h44M38 98h44"></path></g>
        <g class="ln" stroke-width="2.2"><rect x="44" y="44" width="32" height="32" rx="7"></rect>
        <circle cx="22" cy="22" r="10"></circle><circle cx="98" cy="22" r="10"></circle><circle cx="22" cy="98" r="10"></circle><circle cx="98" cy="98" r="10"></circle>
        <path d="M30 30l14 14M90 30l-14 14M30 90l14-14M90 90l-14-14"></path></g>
        <circle class="ln" cx="60" cy="60" r="5" stroke-width="1.6"></circle></svg>`;
    return html`<svg viewBox="0 0 120 120" aria-hidden="true"><g class="ln" stroke-width="2.2">
        <circle cx="60" cy="60" r="48"></circle><circle cx="60" cy="60" r="7"></circle>
        <path d="M60 53c-2-15 3-27 15-30 9-2 13 8 6 14-6 5-12 9-21 16zM66 64c13 6 21 16 17 28-3 9-14 8-16-1-1-8-1-15-1-27zM54 64c-12 9-24 11-33 3-7-7 0-16 9-13 8 2 14 6 24 10z"></path></g>
        <circle class="ln ca-faint" cx="60" cy="60" r="38" stroke-width="1"></circle></svg>`;
  }

  /* ================= knowledge index ================= */

  let IDX = null;
  async function getIndex() { if (!IDX) IDX = await D.index(TABS.map(t => t.id)); return IDX; }
  const pageOf = (idx, route) => idx.pages.find(p => `${p.tab}/${p.slug}` === route) || (ALIAS && ALIAS[route] ? idx.pages.find(p => `${p.tab}/${p.slug}` === ALIAS[route]) : undefined);

  // "aliases" in nav.json: old names of a page ("old-slug" or "tab/old-slug") → its current route.
  let ALIAS = null;
  async function aliasMap() {
    if (ALIAS) return ALIAS;
    const navs = await Promise.all(TABS.map(t => loadNav(t.id))), map = {};
    TABS.forEach((t, i) => navs[i].forEach(m => (m.aliases || []).forEach(a => { map[String(a).includes('/') ? String(a) : `${t.id}/${a}`] = `${t.id}/${m.slug}`; })));
    return (ALIAS = map);
  }
  // Positions, highlights, card colours and notes, review history and "seen" records follow a renamed page.
  async function migrateAliases() {
    const map = await aliasMap();
    if (!Object.keys(map).length) return;
    const moveKeys = (obj, sep, onMove) => { let n = 0; for (const k of Object.keys(obj)) {
      const cut = sep ? k.indexOf(sep, k.indexOf('/') + 1) : -1, r = cut > 0 ? k.slice(0, cut) : k, to = map[r];
      if (!to) continue; const nk = to + (cut > 0 ? k.slice(cut) : '');
      if (!(nk in obj)) { obj[nk] = obj[k]; if (obj[nk] && typeof obj[nk] === 'object' && 'slug' in obj[nk]) [obj[nk].tab, obj[nk].slug] = to.split('/'); }
      delete obj[k]; n++; if (onMove) onMove(k, nk); } return n; };
    highlights.forEach(h => { const to = map[`${h.tab}/${h.slug}`]; if (to) { [h.tab, h.slug] = to.split('/'); D.save.highlight(h); } });
    moveKeys(positions, null, (k, nk) => D.save.position(nk, 0));
    moveKeys(cardState, '/', (k, nk) => { D.save.card(nk, 0); D.save.card(k, 0); });
    if (moveKeys(reviewState, '#')) saveReview();
    if (moveKeys(practiceState)) savePractice();
    if (seen && moveKeys(seen)) saveSeen();
  }
  const routeOf = p => `${p.tab}/${p.slug}`;

  // Related reading: pages named in nav.json, then chapters that link here, then chapters this page links to.
  function relatedOf(idx, tab, slug, meta, skip) {
    const me = `${tab}/${slug}`, seenR = new Set([me, ...skip]), out = [];
    const add = r => { if (seenR.has(r)) return; const p = pageOf(idx, r); if (!p) return; seenR.add(r); out.push(p); };
    ((meta && meta.related) || []).forEach(add);
    idx.pages.filter(p => p.layout !== 'cards' && p.links.includes(me)).forEach(p => add(routeOf(p)));
    const mine = pageOf(idx, me);
    (mine ? mine.links : []).forEach(r => { const p = pageOf(idx, r); if (p && p.layout !== 'cards') add(r); });
    return out.slice(0, 6);
  }

  /* ================= review (spaced practice from Check yourself) ================= */

  const DAY = 864e5, BOX_DAYS = [0, 1, 3, 7, 16, 35];
  // Questions from pages the reader has opened, optionally in one notebook.
  function reviewPool(idx, tab) {
    const out = [];
    idx.pages.forEach(p => {
      if (tab && p.tab !== tab) return;
      if (!positions[routeOf(p)]) return;
      p.checks.forEach(c => out.push({ key: `${routeOf(p)}#${c.key}`, page: p, c }));
      (practiceState[routeOf(p)] || []).forEach(x => out.push({ key: `${routeOf(p)}#${x.id}`, page: p, c: { q: x.q, a: x.a, id: null } }));
    });
    return out;
  }
  function dueOf(pool, now = Date.now()) {
    const due = pool.filter(x => !reviewState[x.key] || reviewState[x.key].due <= now);
    return due.sort((a, b) => ((reviewState[a.key] || {}).due || Infinity) - ((reviewState[b.key] || {}).due || Infinity));
  }

  /* ================= growth: what changed since the reader last read a page ================= */

  // Per reader: for every page he has opened, a fingerprint of each section as it was then.
  const secKey = sec => sec.id || '_';
  function fingerprint(p) {
    const out = {};
    p.sections.forEach(sec => { if (!/^sources$/i.test(sec.heading || '')) out[secKey(sec)] = window.HVACIndex.hash((sec.heading || '') + '\n' + sec.text); });
    return out;
  }
  // null = never read; otherwise the sections that are new or changed since then.
  function changesOf(p) {
    const old = seen && seen[routeOf(p)];
    if (!old) return null;
    const now = fingerprint(p), out = [];
    p.sections.forEach(sec => {
      const k = secKey(sec);
      if (!(k in now)) return;
      if (!(k in old.s)) out.push({ id: sec.id, heading: sec.heading, kind: 'new' });
      else if (old.s[k] !== now[k]) out.push({ id: sec.id, heading: sec.heading, kind: 'updated' });
    });
    return out;
  }
  // The text a section had when the reader last read it, from the timeline (publishing keeps the previous text of
  // changed sections). Exact when the fingerprint matches; otherwise the first change after that day.
  function wasOf(log, route, id, old) {
    if (!log || !old) return null;
    const day = new Date(old.t).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    let later = null;
    for (const d of log.days) {
      if (d.date < day) continue;
      for (const it of d.items) {
        if (it.route !== route) continue;
        const c = [...(it.changed || []), ...(it.revised || [])].find(x => x.id === id && typeof x.was === 'string');
        if (!c) continue;
        if (window.HVACIndex.hash((c.h || '') + '\n' + c.was) === old.s[id || '_']) return { was: c.was, date: d.date };
        if (!later && d.date > day) later = { was: c.was, date: d.date };
      }
    }
    return later;
  }
  // Word-level difference, as a few short "… before <del>old</del> <ins>new</ins> after …" excerpts (as nodes).
  function wordDiff(a, b) {
    const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
    const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e), n = a2.length, m = b2.length;
    if (n * m > 1.2e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = A.slice(0, s).map(w => ['=', w]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push(['=', a2[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
    A.slice(A.length - e).forEach(w => ops.push(['=', w]));
    const changedN = ops.filter(o => o[0] !== '=').length;
    if (!changedN) return null;
    if (changedN > 0.6 * Math.max(A.length, B.length)) return { rewritten: true };
    const CTX = 5, hunks = [];
    ops.forEach((o, k) => { if (o[0] === '=') return; const last = hunks[hunks.length - 1]; if (last && k - last.b <= CTX * 2) last.b = k; else hunks.push({ a: k, b: k }); });
    const parts = hunks.slice(0, 3).map(h => {
      const from = Math.max(0, h.a - CTX), to = Math.min(ops.length - 1, h.b + CTX);
      const out = document.createDocumentFragment();
      if (from > 0) out.append('… ');
      let run = null, buf = [];
      const flush = () => {
        if (!buf.length) return;
        const t = (run !== '=' && buf.length > 14 ? [...buf.slice(0, 10), '…'] : buf).join(' ');
        if (run === '=') out.append(t + ' ');
        else { const x = document.createElement(run === '-' ? 'del' : 'ins'); x.textContent = t; out.append(x, ' '); }
        buf = [];
      };
      for (let k = from; k <= to; k++) { if (ops[k][0] !== run) { flush(); run = ops[k][0]; } buf.push(ops[k][1]); }
      flush();
      if (to < ops.length - 1) out.append('…');
      return out;
    });
    return { parts, more: Math.max(0, hunks.length - 3) };
  }
  function markSeen(p) { seen[routeOf(p)] = { t: Date.now(), s: fingerprint(p) }; saveSeen(); }
  // The first time this runs for a reader, every page already read becomes the baseline (nothing shows as new).
  function seedSeen(idx) {
    if (seen) return;
    seen = {};
    idx.pages.forEach(p => { if (positions[routeOf(p)]) seen[routeOf(p)] = { t: Date.now(), s: fingerprint(p) }; });
    saveSeen();
  }

  /* ================= learning path: what to read next ================= */

  // Chapters in learning order: Theory first, then the products, then Systems; dictionaries and book notes left out.
  const PATH_ORDER = ['theory', 'chillers', 'ahu', 'fcu', 'systems'];
  function upNext(idx, navs, skip) {
    const meta = {};
    TABS.forEach((t, i) => navs[i].forEach(m => { meta[`${t.id}/${m.slug}`] = m; }));
    const chapters = idx.pages.filter(p => p.layout !== 'cards' && PATH_ORDER.includes(p.tab))
      .sort((a, b) => PATH_ORDER.indexOf(a.tab) - PATH_ORDER.indexOf(b.tab));
    const done = r => progressOf(...r.split('/')) >= 0.98;
    const open = chapters.filter(p => !done(routeOf(p)) && routeOf(p) !== skip);
    const pre = p => ((meta[routeOf(p)] || {}).prereq || []).filter(r => meta[r]);
    const ready = open.filter(p => pre(p).every(done));
    // Prefer a chapter that builds on something already read, then the order above.
    const pick = ready.find(p => pre(p).length) || ready[0] || open[0];
    const total = chapters.length, read = chapters.filter(p => done(routeOf(p))).length;
    if (!pick) return { total, read };
    const after = pre(pick).map(r => pageOf(idx, r)).filter(Boolean);
    return { total, read, page: pick, after, minutes: Math.max(1, Math.round(pick.words / 200)) };
  }

  /* ================= shared pieces for part 2 ================= */

  window.HNApp = {
    TABS, TAB, PRODUCTS, BOOKS, COLORS, THEMES, SIZES, SITE, KCOLORS, CALLOUTS,
    html, render, clone, icon, D, $, root, main, navbar, sidebar, tabbar, hlBar, sheet, sheetBody, backdrop, reduced,
    slugify, uid, clamp, debounce, fmtDate, fmtMonth, one, chev, settings, saveView, bindMine,
    mine: () => ({ positions, highlights, cardState, reviewState, practiceState, seen }),
    saveReview, savePractice, toast, copyText, loadNav, loadPage, renderMarkdown, renderInline, autoColor, cardColor,
    cardNotesOf, notesCount, cardEntry, cardify, paintCard, openCard, othersOn, cardOthers, cardNotes, noteBy, otherNotes, enhance, fieldItem, markWide, loadImages,
    applySettings, updateThemeColor, backBtn, searchBtn, focusBtn, setNav, watchLargeTitle, renderTabbar, where, setActive,
    canPublish, renderSidebar, coverArt, getIndex, pageOf, aliasMap, migrateAliases, routeOf, relatedOf, reviewPool, dueOf,
    changesOf, wasOf, wordDiff, markSeen, seedSeen, upNext, BOX_DAYS, DAY
  };
  // Functions part 2 provides, used above.
  function hlsOf(tab) { return highlights.filter(h => h.tab === tab); }
  function progressOf(tab, slug) { const p = positions[`${tab}/${slug}`]; return p ? p.f : 0; }
  window.HNApp.hlsOf = hlsOf; window.HNApp.progressOf = progressOf;
  function openSheet(...a) { return window.HNApp.openSheet(...a); }
  function closeSheet(...a) { return window.HNApp.closeSheet(...a); }
  function goToAnchor(...a) { return window.HNApp.goToAnchor(...a); }
  function openSearch(...a) { return window.HNApp.openSearch(...a); }
  function layout(...a) { return window.HNApp.layout(...a); }
  function fraction(...a) { return window.HNApp.fraction(...a); }
  Object.defineProperty(window.HNApp, 'R', { get: () => R, set: v => { R = v; } });
  let R = null;               // current reader state (set by part 2)
})();
