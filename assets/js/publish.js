/*
 * HVAC Notes: the Publish page (right 'edit').
 *
 * The owner picks a zip or a folder of pages on his computer. The page merges it over what is published, runs the
 * quality check (lint.js, the same rules as tools/lint.mjs), builds the knowledge index (indexer.js, shared with the
 * reader), shows what will change and what the timeline will gain, and publishes through his own session:
 *   1. changed images to the private bucket (<notebook>/images/<file>)
 *   2. pages, nav.json, the image list, the index and the timeline in one database call
 *      (public.hvac_notes_publish_commit), all or nothing; the database gives each reader only what he may read
 *   3. images no longer used (and the old index and timeline files, from before 005) are deleted from the bucket.
 * New pages arrive as drafts: the tile admin approves them on the page. A changed page keeps its status.
 * Download all pages gives the published library back as a zip (the authoring copy and a backup).
 * No key or password is involved anywhere: the database checks the right on every call.
 */
(function () {
  'use strict';
  const { html, render, one } = window.HN;
  let host = document;
  const $ = s => host.querySelector(s);
  const BUCKET = 'hvac-notes';
  const L = window.HVACLint, IDX = window.HVACIndex;
  const TABS = L.TABS;
  const MIME = { svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  const IMAGE = /\.(svg|png|jpe?g|webp|gif)$/i;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const kb = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  let cur = null, plan = null, busy = false;

  async function sha256(bytes) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function bucketJson(path) { return JSON.parse(await (await Api.file.download(BUCKET, path)).text()); }
  const parseNav = text => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : null; } catch (e) { return null; } };
  const sortTabs = list => [...list].sort((a, b) => (TABS.indexOf(a) + 1 || 99) - (TABS.indexOf(b) + 1 || 99) || a.localeCompare(b));

  /* ---------------- what is published ---------------- */

  async function load() {
    const box = $('#lib');
    render(box, html`<div class="loading-veil"><span class="spin"></span>Loading the library</div>`);
    const ex = await Api.rpc('hvac_notes_publish_export');
    cur = {
      version: ex.version, published_at: ex.published_at, credits: ex.credits || '',
      navs: ex.navs || {}, pages: new Map((ex.pages || []).map(p => [`${p.tab}/${p.slug}`, p.md])),
      files: new Map((ex.files || []).map(f => [f.path, f])), index_path: ex.index_path, growth_path: ex.growth_path,
      index: ex.index || null, growth: ex.growth || null, drafts: Object.keys(ex.status || {}).sort()
    };
    // Before 005 the index and timeline were files in the bucket: read them from there until they are moved.
    if (!cur.index && cur.index_path) cur.index = await bucketJson(cur.index_path).catch(() => null);
    if (!cur.growth && cur.growth_path) cur.growth = await bucketJson(cur.growth_path).catch(() => null);
    const move = !!(cur.version && (cur.index_path || cur.growth_path));
    const tabs = sortTabs(Object.keys(cur.navs));
    render(box, html`<div class="row between"><h2>Published</h2>${cur.version ? html`<span class="badge brand">Version ${cur.version}</span>` : html`<span class="badge">Nothing yet</span>`}</div>
      ${cur.version ? html`<p class="muted">${Core.dateTime(cur.published_at)} · ${plural(tabs.length, 'notebook', 'notebooks')} · ${plural(cur.pages.size, 'page', 'pages')} · ${plural(cur.files.size, 'image', 'images')}${cur.growth ? ` · timeline of ${plural(cur.growth.days.length, 'day', 'days')}` : ''}</p>
        <div class="hp-tabs">${tabs.map(t => html`<span class="chip">${t} · ${(parseNav(cur.navs[t]) || []).length}</span>`)}</div>
        ${cur.drafts.length ? html`<p class="notice warning">${plural(cur.drafts.length, 'draft', 'drafts')} waiting for approval (only editors see ${cur.drafts.length === 1 ? 'it' : 'them'}): ${cur.drafts.map((r, i) => html`${i ? ', ' : ''}<a href="./#/${r}" class="mono">${r}</a>`)}. Open a page and press Approve.</p>` : ''}
        ${move ? html`<div class="notice brand hp-move"><p>The search index and the timeline are still files in the bucket. Move them into the database, where each reader gets only the pages he may read. Nothing else changes.</p><button class="btn primary" type="button" id="move">Move now</button></div>` : ''}
        <div class="row hp-gap"><button class="btn" type="button" id="export">Download all pages</button><span class="muted small-note">A zip of every notebook (nav.json, pages, images), CREDITS.md and the timeline: the copy to edit, and a backup.</span></div>`
      : html`<p class="muted">The library is empty. Upload the pages below to publish them for the first time.</p>`}`);
    const b = $('#export'); if (b) b.addEventListener('click', e => Core.busy(e.currentTarget, exportAll).catch(err => Core.showError(err)));
    const mv = $('#move'); if (mv) mv.addEventListener('click', e => Core.busy(e.currentTarget, moveNow).catch(err => fail(err)));
  }

  // The index of a library: every page its notebooks list, in reading order (the same as the reader builds).
  function buildIndex(navText, pages) {
    const list = [];
    for (const tab of sortTabs(Object.keys(navText))) for (const meta of (parseNav(navText[tab]) || []))
      if (meta && meta.slug && pages.has(`${tab}/${meta.slug}`)) list.push({ tab, meta, md: pages.get(`${tab}/${meta.slug}`) });
    return { list, index: IDX.build(list) };
  }
  // One commit with no page changes: the index and timeline go into the database, the old files are deleted.
  async function moveNow() {
    if (busy) return;
    busy = true;
    try {
      const { index } = buildIndex(cur.navs, cur.pages);
      const growth = cur.growth && Array.isArray(cur.growth.days) ? cur.growth : { v: 1, days: [] };
      await Api.rpc('hvac_notes_publish_commit', { p_base: cur.version, p_navs: {}, p_pages: [], p_remove: [], p_files: [], p_remove_files: [],
        p_credits: null, p_index: index, p_growth: growth });
      for (const path of [cur.index_path, cur.growth_path].filter(Boolean)) await Api.file.remove(BUCKET, path).catch(() => { });
      Core.toast('Index and timeline moved', 'success');
      await load();
      if (host !== document) host.dispatchEvent(new CustomEvent('hn-published', { bubbles: true }));
    } finally { busy = false; }
  }

  /* ---------------- download all pages ---------------- */

  async function exportAll() {
    const files = [];
    if (cur.credits) files.push({ path: 'src/CREDITS.md', bytes: enc.encode(cur.credits) });
    if (cur.growth) files.push({ path: 'src/growth.json', bytes: enc.encode(JSON.stringify(cur.growth)) });
    for (const tab of sortTabs(Object.keys(cur.navs))) files.push({ path: `src/${tab}/nav.json`, bytes: enc.encode(cur.navs[tab]) });
    for (const [route, md] of [...cur.pages].sort()) files.push({ path: `src/${route}.md`, bytes: enc.encode(md) });
    let n = 0;
    for (const path of [...cur.files.keys()].sort()) {
      const blob = await Api.file.download(BUCKET, path);
      files.push({ path: `src/${path}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      n++;
    }
    const zip = await window.HNZip.write(files);
    Core.download(`hvac-notes-src-${today()}.zip`, zip);
    Core.toast(`Downloaded ${plural(cur.pages.size, 'page', 'pages')} and ${plural(n, 'image', 'images')}`, 'success');
  }

  /* ---------------- reading the upload ---------------- */

  async function fromFolder(list) {
    return Promise.all([...list].map(async f => ({ path: (f.webkitRelativePath || f.name).replace(/\\/g, '/'), bytes: new Uint8Array(await f.arrayBuffer()) })));
  }
  // Finds the folder that holds the notebooks (src/, HVAC-main/src/ or the zip's top) and sorts what is in it.
  function classify(entries) {
    let prefix = null;
    for (const e of entries) {
      const segs = e.path.split('/');
      for (let i = 0; i < segs.length - 1; i++) {
        if (!/^[a-z0-9-]+$/.test(segs[i])) continue;
        const next = segs[i + 1];
        if (next === 'nav.json' || (TABS.includes(segs[i]) && (/\.md$/.test(next) || next === 'images'))) {
          const p = segs.slice(0, i).join('/');
          if (prefix === null || p.length < prefix.length) prefix = p;
          break;
        }
      }
    }
    if (prefix === null) throw new Error('No notebook folders in it. Choose the folder (or a zip) that holds theory/, chillers/, ahu/ … each with its nav.json.');
    const out = { navs: {}, pages: new Map(), images: new Map(), credits: null, growth: null, index: null, ignored: [] };
    for (const e of entries) {
      if (prefix && !e.path.startsWith(prefix + '/')) continue;
      const r = prefix ? e.path.slice(prefix.length + 1) : e.path;
      if (r === 'CREDITS.md') { out.credits = dec.decode(e.bytes); continue; }
      if (r === 'growth.json') { out.growth = dec.decode(e.bytes); continue; }
      if (r === 'index.json') { out.index = dec.decode(e.bytes); continue; }
      let m;
      if ((m = /^([a-z0-9-]+)\/nav\.json$/.exec(r))) { out.navs[m[1]] = dec.decode(e.bytes); continue; }
      if ((m = /^([a-z0-9-]+)\/([a-z0-9-]+)\.md$/.exec(r))) { out.pages.set(`${m[1]}/${m[2]}`, dec.decode(e.bytes).replace(/\r\n/g, '\n')); continue; }
      if (/^[a-z0-9-]+\/images\//.test(r) && IMAGE.test(r)) { out.images.set(r, e.bytes); continue; }
      if (/(^|\/)\.[^/]*$/.test(r)) continue;                  // hidden files (.opened, .DS_Store)
      out.ignored.push(r);
    }
    return out;
  }

  /* ---------------- the plan: merge, check, compare ---------------- */

  async function makePlan(up, whole) {
    const navText = whole ? {} : { ...cur.navs };
    const pages = whole ? new Map() : new Map(cur.pages);
    const files = whole ? new Map() : new Map([...cur.files].map(([k, v]) => [k, { ...v }]));
    Object.assign(navText, up.navs);
    for (const [r, md] of up.pages) pages.set(r, md);
    const newBytes = new Map();
    for (const [path, bytes] of up.images) {
      const sha = await sha256(bytes);
      files.set(path, { path, size: bytes.length, sha });
      newBytes.set(path, bytes);
    }
    const credits = up.credits != null ? up.credits : cur.credits;
    // A notebook's nav.json lists its pages: a page it no longer lists, and that is not in this upload, goes.
    for (const tab of Object.keys(up.navs)) {
      const listed = new Set((parseNav(up.navs[tab]) || []).map(m => m && m.slug));
      for (const r of [...pages.keys()]) { const [t, s] = r.split('/'); if (t === tab && !listed.has(s) && !up.pages.has(r)) pages.delete(r); }
    }

    // First publish: the old site's index and timeline, when the upload carries them, are the starting point.
    const empty = !cur.version && !cur.pages.size;
    let baseline = null, startLog = cur.growth;
    if (empty && up.index) { try { baseline = JSON.parse(up.index); if (!Array.isArray(baseline.pages)) baseline = null; } catch (e) { baseline = null; } }
    if (empty && up.growth) { try { const g = JSON.parse(up.growth); if (g && Array.isArray(g.days)) startLog = g; } catch (e) { /* keep none */ } }
    const before = cur.index || baseline;

    // The check and the index
    const navs = {}, navErrors = [];
    for (const [tab, text] of Object.entries(navText)) { const list = parseNav(text); if (!list) navErrors.push({ route: `${tab}/nav.json`, level: 'error', msg: 'nav.json is not a JSON list' }); navs[tab] = list || []; }
    const { list, index } = buildIndex(navText, pages);
    const fileSet = new Set(), sizes = {};
    for (const [r, md] of pages) { fileSet.add(r + '.md'); sizes[r + '.md'] = enc.encode(md).length; }
    for (const [tab, text] of Object.entries(navText)) { fileSet.add(`${tab}/nav.json`); sizes[`${tab}/nav.json`] = enc.encode(text).length; }
    for (const [p, f] of files) { fileSet.add(p); sizes[p] = f.size; }
    const issues = navErrors.concat(L.lint({ pages: list, navs, index, files: fileSet, sizes, credits, before, widgets: window.HVACWidgets.NAMES }));

    // What changes
    const curNavs = {}; Object.entries(cur.navs).forEach(([t, x]) => { curNavs[t] = parseNav(x) || []; });
    const metaOf = (nv, r) => { const [t, s] = r.split('/'); return JSON.stringify((nv[t] || []).find(m => m && m.slug === s) || null); };
    const added = [], changed = [], removed = [];
    for (const [r, md] of pages) { if (!cur.pages.has(r)) added.push(r); else if (cur.pages.get(r) !== md) changed.push(r); }
    for (const r of cur.pages.keys()) if (!pages.has(r)) removed.push(r);
    const navChanged = Object.keys(navText).filter(t => navText[t] !== cur.navs[t]);
    const navRemoved = Object.keys(cur.navs).filter(t => !(t in navText));
    const imgAdded = [], imgChanged = [], imgRemoved = [];
    for (const [p, f] of files) { const o = cur.files.get(p); if (!o) imgAdded.push(p); else if (o.sha !== f.sha) imgChanged.push(p); }
    for (const p of cur.files.keys()) if (!files.has(p)) imgRemoved.push(p);
    const creditsChanged = credits !== cur.credits;

    // Errors block only on pages this publish changes (as before the move): pages added, changed, moved in nav.json,
    // removed; on a first publish with the old site's index, a page counts as changed when its index entry differs.
    const touched = new Set([...added, ...changed, ...removed, ...navChanged.map(t => `${t}/nav.json`), ...navRemoved.map(t => `${t}/nav.json`), ...imgAdded, ...imgChanged]);
    for (const r of pages.keys()) if (metaOf(navs, r) !== metaOf(curNavs, r)) touched.add(r);
    if (creditsChanged) touched.add('*');
    let affected = r => touched.has(r) || (!index.pages.some(p => `${p.tab}/${p.slug}` === r) && !/\/nav\.json$/.test(r) && cur.pages.has(r));
    if (empty && baseline) {
      const old = new Map(baseline.pages.map(p => [`${p.tab}/${p.slug}`, JSON.stringify(p)]));
      const now = new Map(index.pages.map(p => [`${p.tab}/${p.slug}`, JSON.stringify(p)]));
      affected = r => !now.has(r) && !old.has(r) ? true : (now.has(r) ? old.get(r) !== now.get(r) : !/\/nav\.json$/.test(r));
    }
    const split = L.split(issues, affected);
    const items = before ? IDX.diff(before, index) : [];
    const any = added.length + changed.length + removed.length + navChanged.length + navRemoved.length + imgAdded.length + imgChanged.length + imgRemoved.length + (creditsChanged ? 1 : 0);
    return { whole, navText, pages, files, newBytes, credits, index, navs, issues, split, items, startLog, added, changed, removed,
      navChanged, navRemoved, imgAdded, imgChanged, imgRemoved, creditsChanged, any, ignored: up.ignored, base: cur.version, empty, baseline: !!baseline };
  }

  /* ---------------- showing the plan ---------------- */

  function show(p) {
    const box = $('#review');
    box.hidden = false;
    const rows = [
      ['Pages added', p.added], ['Pages changed', p.changed], ['Pages removed', p.removed],
      ['Notebook lists (nav.json) changed', p.navChanged.map(t => `${t}/nav.json`)], ['Notebooks removed', p.navRemoved],
      ['Images added', p.imgAdded], ['Images changed', p.imgChanged], ['Images removed', p.imgRemoved]
    ].filter(r => r[1].length);
    const issue = x => html`<li><span class="mono">${x.route}</span> ${x.msg}</li>`;
    const s = p.split;
    const widgetJs = p.ignored.filter(x => /\/widgets\/[^/]+\.js$/.test(x));
    const others = p.ignored.filter(x => !widgetJs.includes(x));
    render(box, html`<div class="row between"><h2>What this publish does</h2>${p.whole ? html`<span class="badge warning">Whole library</span>` : html`<span class="badge">Merged over the published pages</span>`}</div>
      ${p.any ? html`<div class="table-wrap"><table><tbody>${rows.map(([label, list]) => html`<tr><th>${label} (${list.length})</th><td class="hp-list">${list.slice(0, 40).join(', ')}${list.length > 40 ? ` and ${list.length - 40} more` : ''}</td></tr>`)}
        ${p.creditsChanged ? html`<tr><th>CREDITS.md</th><td>changed</td></tr>` : ''}</tbody></table></div>` : html`<p class="notice">Nothing to publish: every page, list and image is the same as what is published.</p>`}
      ${p.items.length ? html`<h3 class="hp-h3">Timeline, ${today()}</h3><ul class="hp-ul">${p.items.map(it => html`<li><span class="mono">${it.route}</span> ${it.kind === 'new' ? 'new page' : [it.added.length ? plural(it.added.length, 'section added', 'sections added') : '', it.changed.length ? plural(it.changed.length, 'section changed', 'sections changed') : '', it.terms.length ? plural(it.terms.length, 'card added', 'cards added') : '', it.symptoms ? plural(it.symptoms, 'symptom', 'symptoms') : '', it.checks ? plural(it.checks, 'question', 'questions') : ''].filter(Boolean).join(', ')}</li>`)}</ul>` : ''}
      ${p.added.length ? html`<p class="notice warning">New pages arrive as drafts: only editors see them until the tile admin opens each one and presses Approve. Changed pages keep their status.</p>` : ''}
      ${p.empty ? html`<p class="notice brand">First publish.${p.baseline ? ' The old site\'s index is the starting point, so only pages that differ from it count as changed.' : ''}${p.startLog ? ` The old timeline (${plural(p.startLog.days.length, 'day', 'days')}) is carried over.` : ''}</p>` : ''}
      <h3 class="hp-h3">Check</h3>
      ${s.blocking.length ? html`<div class="notice danger"><strong>${plural(s.blocking.length, 'error', 'errors')} on pages in this publish: fix them, then upload again.</strong><ul class="hp-ul">${s.blocking.map(issue)}</ul></div>` : html`<p class="notice success">No errors on the pages in this publish.</p>`}
      ${s.older.length ? html`<details class="hp-details"><summary>${plural(s.older.length, 'error', 'errors')} already there, on pages not changed now (fix them when you next edit those pages)</summary><ul class="hp-ul">${s.older.map(issue)}</ul></details>` : ''}
      ${s.warnings.length ? html`<details class="hp-details"><summary>${plural(s.warnings.length, 'warning', 'warnings')}</summary><ul class="hp-ul">${s.warnings.map(issue)}</ul></details>` : ''}
      ${widgetJs.length ? html`<p class="muted">Left out: ${widgetJs.join(', ')}. Widget scripts are tile code now (assets/js/widgets/ in the tile repo); pages name them, the figures they need go in the page as "data".</p>` : ''}
      ${others.length ? html`<p class="muted">Left out (not pages, nav.json, images or CREDITS.md): ${others.slice(0, 12).join(', ')}${others.length > 12 ? ` and ${others.length - 12} more` : ''}</p>` : ''}
      <p class="error" id="pub-error" hidden></p>
      <div class="row end"><button class="btn" type="button" id="cancel">Clear</button><button class="btn primary" type="button" id="publish" disabled="${!p.any || s.blocking.length > 0}">Publish</button></div>`);
    $('#cancel').addEventListener('click', () => { plan = null; box.hidden = true; resetInputs(); });
    $('#publish').addEventListener('click', e => {
      const btn = e.currentTarget;
      const what = [p.added.length && plural(p.added.length, 'new page', 'new pages'), p.changed.length && plural(p.changed.length, 'changed page', 'changed pages'),
        p.removed.length && plural(p.removed.length, 'removed page', 'removed pages'), (p.imgAdded.length + p.imgChanged.length) && plural(p.imgAdded.length + p.imgChanged.length, 'image', 'images'),
        p.imgRemoved.length && plural(p.imgRemoved.length, 'image removed', 'images removed')].filter(Boolean).join(', ') || 'the notebook lists';
      Core.confirm(`Publish ${what}? ${p.changed.length || p.removed.length ? 'Changes to approved pages show at once. ' : ''}${p.added.length ? 'New pages stay drafts until approved.' : ''}`.trim(), { title: 'Publish', ok: 'Publish', danger: p.removed.length > 0 || p.imgRemoved.length > 0 })
        .then(yes => { if (yes) Core.busy(btn, () => publish(p)).catch(err => fail(err)); });
    });
  }
  function fail(err) {
    const box = $('#pub-error');
    const msg = err && err.code === 'INVALID:version' ? 'Someone published while this page was open. Nothing was written. Reload the page and upload again.' : Api.errorMessage(err);
    if (box) { box.textContent = msg; box.hidden = false; } else Core.toast(msg, 'danger');
    if (err && err.code === 'SIGNED_OUT') Core.showError(err);
  }

  /* ---------------- publishing ---------------- */

  function progress(text) { const b = $('#publish'); if (b) b.lastChild.textContent = ' ' + text; }
  async function publish(p) {
    if (busy) return;
    busy = true;
    try {
      // 1. images
      const up = [...p.imgAdded, ...p.imgChanged];
      for (let i = 0; i < up.length; i++) {
        const path = up[i], ext = path.split('.').pop().toLowerCase();
        progress(`Image ${i + 1} of ${up.length}`);
        await Api.file.upload(BUCKET, path, new Blob([p.newBytes.get(path)], { type: MIME[ext] }), MIME[ext]);
      }
      // 2. pages, lists, image records, index and timeline: one call, all or nothing
      const log = IDX.addToLog(p.startLog ? JSON.parse(JSON.stringify(p.startLog)) : null, today(), p.items);
      progress('Pages');
      const navs = {};
      p.navChanged.forEach(t => { navs[t] = p.navText[t]; });
      p.navRemoved.forEach(t => { navs[t] = null; });
      const pages = [...p.added, ...p.changed].map(r => { const [tab, slug] = r.split('/'); return { tab, slug, md: p.pages.get(r) }; });
      const files = [...p.imgAdded, ...p.imgChanged].map(path => p.files.get(path));
      const r = await Api.rpc('hvac_notes_publish_commit', {
        p_base: p.base, p_navs: navs, p_pages: pages, p_remove: p.removed, p_files: files, p_remove_files: p.imgRemoved,
        p_credits: p.creditsChanged ? p.credits : null, p_index: p.index, p_growth: log
      });
      // 3. tidy the bucket (a failure here leaves only unused files behind)
      progress('Tidying');
      const gone = [...p.imgRemoved, cur.index_path, cur.growth_path].filter(Boolean);
      for (const path of gone) await Api.file.remove(BUCKET, path).catch(() => { });
      Core.toast(`Published version ${r.version}${r.drafts ? ` · ${plural(r.drafts, 'draft', 'drafts')} to approve` : ''}`, 'success');
      plan = null; $('#review').hidden = true; resetInputs();
      await load();
      if (host !== document) host.dispatchEvent(new CustomEvent('hn-published', { bubbles: true }));
    } finally { busy = false; }
  }

  /* ---------------- the page ---------------- */

  function resetInputs() { $('#zip').value = ''; $('#dir').value = ''; }
  async function take(getEntries) {
    const box = $('#review');
    box.hidden = false;
    render(box, html`<div class="loading-veil"><span class="spin"></span>Reading and checking</div>`);
    try {
      const entries = await getEntries();
      const up = classify(entries);
      await load();                            // compare with what is published now
      plan = await makePlan(up, $('#whole').checked);
      show(plan);
    } catch (err) {
      render(box, html`<p class="notice danger">${err && err.code ? Api.errorMessage(err) : (err && err.message) || String(err)}</p>`);
      if (err && err.code === 'SIGNED_OUT') Core.showError(err);
    }
  }

  // The Publish panel: rendered into a host (publish.html's main, or the reader's #/publish view) and bound.
  function mount(where) {
    host = where; plan = null; cur = null; busy = false;
    render(where, html`<div class="card" id="lib"></div>
      <div class="card">
        <h2>Upload pages</h2>
        <p class="muted">A zip or a folder that holds notebook folders (theory, refrigeration, chillers, ahu, fcu, systems, ashrae), each with its <span class="mono">nav.json</span>, its pages (<span class="mono">&lt;slug&gt;.md</span>) and an <span class="mono">images/</span> folder, plus <span class="mono">CREDITS.md</span>. Pages you leave out stay as they are; a page its notebook's new <span class="mono">nav.json</span> no longer lists is removed.</p>
        <div class="row">
          <label class="btn primary" for="zip">Choose a zip</label>
          <input type="file" id="zip" accept=".zip,application/zip" hidden>
          <label class="btn" for="dir">Choose a folder</label>
          <input type="file" id="dir" webkitdirectory multiple hidden>
        </div>
        <label class="check hp-whole"><input type="checkbox" id="whole"> This is the whole library: remove published pages and images it does not have</label>
        <p class="hint">Nothing is published until you check the result below and press Publish.</p>
      </div>
      <div class="card" id="review" hidden></div>`);
    $('#zip').addEventListener('change', e => { const f = e.target.files[0]; if (f) take(() => window.HNZip.read(f)); });
    $('#dir').addEventListener('change', e => { const l = e.target.files; if (l && l.length) take(() => fromFolder(l)); });
    $('#whole').addEventListener('change', () => { if (plan) $('#review').hidden = true; resetInputs(); });
    return load();
  }
  window.HNPublish = { mount };

  // Stand-alone page (publish.html): guard with the right, then mount into main.
  if (document.body.dataset.page === 'publish') {
    Core.requireLogin({ tile: 'hvac-notes', right: 'edit' }).then(() => {
      Core.setTitle('Publish · HVAC Notes');
      mount(document.querySelector('#pub-host')).catch(err => { Core.showState('Cannot load', Api.errorMessage(err), { href: location.pathname, label: 'Try again' }); });
    });
  }
})();
