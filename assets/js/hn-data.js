/*
 * HVAC Notes: data. Everything comes from the database and the private bucket through the core (Api.rpc, Api.file);
 * nothing internal is kept on the device.
 *
 *   HNData.library()            version, every notebook's nav, where the index and timeline are
 *   HNData.nav(tab)             a notebook's pages in reading order
 *   HNData.page(tab, slug)      a page's Markdown
 *   HNData.pages(routes)        several pages at once (routes "tab/slug", null = all)
 *   HNData.index() / growth()   the search index and the growth timeline (JSON files in the bucket)
 *   HNData.imageUrl(path)       an image of the content as a blob: URL ("ahu/images/x.svg")
 *   HNData.text(path)           a text file of the content (an SVG for a draw widget)
 *   HNData.my                   the reader's own data: highlights, cards, positions, state.review/practice/seen
 *   HNData.save.*               write them back, batched; HNData.flush() sends what is waiting
 */
window.HNData = (function () {
  'use strict';
  const BUCKET = 'hvac-notes';
  const MIME = { svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

  let lib = null, libP = null;
  const navs = {}, pageCache = {}, imgCache = new Map(), textCache = new Map();
  let IDX = null, GROWTH;

  function library() {
    if (lib) return Promise.resolve(lib);
    if (!libP) libP = Api.rpc('hvac_notes_library').then(r => {
      lib = r || {};
      Object.entries(lib.navs || {}).forEach(([tab, text]) => {
        let list = [];
        try { list = JSON.parse(text); } catch (e) { list = []; }
        navs[tab] = Array.isArray(list) ? list.filter(p => p && p.slug && p.title) : [];
      });
      return lib;
    }, err => { libP = null; throw err; });
    return libP;
  }
  async function nav(tab) { await library(); return navs[tab] || []; }

  async function page(tab, slug) {
    const k = tab + '/' + slug;
    if (pageCache[k] === undefined) pageCache[k] = Api.rpc('hvac_notes_page', { p_tab: tab, p_slug: slug }).then(r => r.md, e => { delete pageCache[k]; throw e; });
    return pageCache[k];
  }
  async function pages(routes) {
    const want = routes ? routes.filter(r => pageCache[r] === undefined) : null;
    if (!want || want.length) {
      const rows = await Api.rpc('hvac_notes_pages', { p_routes: want });
      (rows || []).forEach(r => { pageCache[r.tab + '/' + r.slug] = Promise.resolve(r.md); });
    }
    const keys = routes || Object.keys(pageCache);
    const out = {};
    for (const k of keys) if (pageCache[k] !== undefined) { try { out[k] = await pageCache[k]; } catch (e) { /* missing page */ } }
    return out;
  }

  async function json(path) {
    const blob = await Api.file.download(BUCKET, path);
    return JSON.parse(await blob.text());
  }
  // The knowledge index, built and uploaded by the Publish page; built here from the pages if it cannot be read.
  async function index(tabs) {
    if (IDX) return IDX;
    const l = await library();
    try { if (l.index_path) IDX = await json(l.index_path); } catch (e) { IDX = null; }
    if (!IDX || !Array.isArray(IDX.pages)) {
      const all = await pages(null), list = [];
      for (const t of tabs) for (const meta of (navs[t] || [])) { const md = all[`${t}/${meta.slug}`]; if (md != null) list.push({ tab: t, meta, md }); }
      IDX = window.HVACIndex.build(list);
    }
    return IDX;
  }
  async function growth() {
    if (GROWTH !== undefined) return GROWTH;
    const l = await library();
    try { GROWTH = l.growth_path ? await json(l.growth_path) : null; if (!GROWTH || !Array.isArray(GROWTH.days)) GROWTH = null; }
    catch (e) { GROWTH = null; }
    return GROWTH;
  }

  function imageUrl(path) {
    if (!imgCache.has(path)) {
      imgCache.set(path, Api.file.download(BUCKET, path).then(blob => {
        const type = MIME[path.split('.').pop().toLowerCase()] || blob.type || 'application/octet-stream';
        return URL.createObjectURL(new Blob([blob], { type }));
      }, e => { imgCache.delete(path); throw e; }));
    }
    return imgCache.get(path);
  }
  function text(path) {
    if (!textCache.has(path)) textCache.set(path, Api.file.download(BUCKET, path).then(b => b.text(), e => { textCache.delete(path); throw e; }));
    return textCache.get(path);
  }

  /* ---------------- the reader's own data ---------------- */

  const my = { highlights: [], cards: {}, positions: {}, state: { review: {}, practice: {}, seen: null } };
  async function loadMine() {
    const r = await Api.rpc('hvac_notes_my_data');
    my.highlights = (r.highlights || []).map(h => ({ ...h }));
    my.cards = {};
    Object.entries(r.cards || {}).forEach(([key, v]) => {
      const [tab, slug, id] = key.split('/');
      my.cards[key] = { tab, slug, id, title: v.title || '', color: v.color || null, note: v.note || '', updated: v.updated };
    });
    my.positions = {};
    Object.entries(r.positions || {}).forEach(([route, v]) => { my.positions[route] = { f: +v.f, t: +v.t, title: v.title || '' }; });
    const st = r.state || {};
    my.state.review = st.review || {};
    my.state.practice = st.practice || {};
    my.state.seen = st.seen || null;
    return my;
  }

  /* ---------------- everyone else's notes (highlights and card notes, with the author's name) ---------------- */

  const shared = { highlights: [], cards: {}, at: 0 };
  let sharedLoad = null;
  // maxAge: reuse what was loaded less than maxAge ms ago. Resolves to true when something changed.
  function loadShared(maxAge) {
    if (maxAge && Date.now() - shared.at < maxAge) return Promise.resolve(false);
    if (sharedLoad) return sharedLoad;
    sharedLoad = Api.rpc('hvac_notes_shared').then(r => {
      const before = JSON.stringify([shared.highlights, shared.cards]);
      shared.highlights = (r.highlights || []).map(h => ({ ...h, by: h.by || 'Someone' }));
      shared.cards = {};
      (r.cards || []).forEach(c => (shared.cards[c.key] = shared.cards[c.key] || []).push({ ...c, by: c.by || 'Someone' }));
      shared.at = Date.now();
      return JSON.stringify([shared.highlights, shared.cards]) !== before;
    }).finally(() => { sharedLoad = null; });
    return sharedLoad;
  }
  // Removing someone else's note: right 'edit' only (the database checks).
  const remove = {
    async highlight(id) {
      await Api.rpc('hvac_notes_highlight_delete', { p_id: id });
      shared.highlights = shared.highlights.filter(h => h.id !== id);
    },
    async card(key, id) {
      await Api.rpc('hvac_notes_card_remove', { p_id: id });
      if (shared.cards[key]) shared.cards[key] = shared.cards[key].filter(c => c.id !== id);
    }
  };

  // Writes wait a moment and are merged by key; a failed write is retried, and the reader is told once.
  const queue = new Map();
  let onError = null, lastError = 0;
  function later(key, ms, fn) {
    const old = queue.get(key);
    if (old) clearTimeout(old.t);
    const job = { fn, t: setTimeout(() => run(key), ms) };
    queue.set(key, job);
  }
  function run(key) {
    const job = queue.get(key);
    if (!job) return Promise.resolve();
    clearTimeout(job.t); queue.delete(key);
    return Promise.resolve().then(job.fn).catch(err => {
      if (err && err.code === 'SIGNED_OUT') { if (onError) onError(err); return; }
      if (!queue.has(key)) later(key, 10000, job.fn);
      if (Date.now() - lastError > 60000) { lastError = Date.now(); if (onError) onError(err); }
    });
  }
  function flush() { return Promise.all([...queue.keys()].map(run)); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => { flush(); });

  const save = {
    highlight(h, ms) {
      later('h:' + h.id, ms || 0, () => Api.rpc('hvac_notes_highlight_save', { p_id: h.id, p_tab: h.tab, p_slug: h.slug, p_title: h.title || '',
        p_color: h.color, p_note: h.note || '', p_quote: h.quote }));
    },
    highlightDelete(id) {
      const old = queue.get('h:' + id); if (old) { clearTimeout(old.t); queue.delete('h:' + id); }
      return Api.rpc('hvac_notes_highlight_delete', { p_id: id }).catch(err => { if (err.code !== 'NOT_FOUND') throw err; });
    },
    card(key, ms) {
      later('c:' + key, ms == null ? 400 : ms, () => {
        const c = my.cards[key] || {};
        return Api.rpc('hvac_notes_card_save', { p_key: key, p_title: c.title || '', p_color: c.color || null, p_note: c.note || '' });
      });
    },
    position(route, ms) {
      later('p:' + route, ms == null ? 2500 : ms, () => {
        const p = my.positions[route]; if (!p) return null;
        return Api.rpc('hvac_notes_position_save', { p_route: route, p_f: Math.max(0, Math.min(1, +p.f || 0)), p_title: p.title || '' });
      });
    },
    state(kind, ms) {
      later('s:' + kind, ms == null ? 1500 : ms, () => Api.rpc('hvac_notes_state_save', { p_kind: kind, p_data: my.state[kind] || {} }));
    }
  };

  return {
    BUCKET, library, nav, page, pages, index, growth, imageUrl, text, my, loadMine, save, flush, shared, loadShared, remove,
    onSaveError(fn) { onError = fn; },
    importBackup: data => Api.rpc('hvac_notes_my_import', { p_data: data })
  };
})();
