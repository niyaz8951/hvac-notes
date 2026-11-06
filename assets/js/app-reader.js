/* HVAC Notes reader, part 2 of 2: views, the page reader, focus mode, highlights, sheets, search and the router.
   Starts after the core guard: Core.requireLogin({ tile: 'hvac-notes' }). */
(function () {
  'use strict';
  const A = window.HNApp;
  const { TABS, TAB, PRODUCTS, BOOKS, COLORS, THEMES, SIZES, SITE, KCOLORS, html, render, clone, icon, D, $, root, main, navbar,
    hlBar, sheet, sheetBody, backdrop, reduced, slugify, uid, clamp, debounce, fmtDate, fmtMonth, one, chev, settings, saveView,
    toast, copyText, loadNav, loadToc, loadPage, renderMarkdown, autoColor, cardColor, cardNotesOf, notesCount, cardEntry, cardify,
    paintCard, openCard, enhance, fieldItem, markWide, loadImages, applySettings, updateThemeColor, backBtn, searchBtn, focusBtn,
    setNav, watchLargeTitle, renderTabbar, where, setActive, canPublish, renderSidebar, coverArt, getIndex, pageOf, aliasMap,
    migrateAliases, routeOf, relatedOf, reviewPool, dueOf, changesOf, wasOf, wordDiff, markSeen, seedSeen, upNext, BOX_DAYS, DAY,
    hlsOf, progressOf, saveReview, savePractice, othersOn, cardOthers, cardNotes, noteBy, otherNotes, thread, replyCount, replyBadge, discussions, shown, draftTag } = A;
  const m = () => A.mine();
  const setTitle = t => Core.setTitle(t ? `${t} · ${SITE}` : SITE);
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  /* ================= views ================= */

  // Highlights and card notes in a notebook: the reader's own and, unless hidden, everyone else's.
  const othersIn = tab => othersOn() ? D.shared.highlights.filter(h => h.tab === tab).length
    + Object.entries(D.shared.cards).reduce((n, [k, l]) => n + (k.startsWith(tab + '/') ? l.length : 0), 0) : 0;
  const notesRow = tab => {
    const n = notesCount(tab) + othersIn(tab);
    return n ? html`<div class="group gap-b"><a class="hn-row with-icon" href="#/notebook/${tab}"><span class="icon-tile it-notes">${icon('i-notebook')}</span>
      <span class="row-main"><span class="row-title">Highlights &amp; Notes</span></span><span class="row-value">${n}</span>${chev()}</a></div>` : '';
  };
  const libRow = (href, name, ic, cls, value) => html`<a class="hn-row with-icon" href="${href}"><span class="icon-tile ${cls}">${icon(ic)}</span>
      <span class="row-main"><span class="row-title">${name}</span></span><span class="row-value">${value || ''}</span>${chev()}</a>`;

  async function viewLibrary() {
    setActive('library', null, null);
    setTitle('');
    const navs = await Promise.all(TABS.map(t => loadToc(t.id)));
    setNav({ title: 'Home', right: searchBtn() });
    const all = navs.flatMap(pages => pages.filter(p => !p.linked));
    if (!all.length) {
      render(main, html`<div class="hn-page"><h1 class="large-title">Home</h1><div class="empty"><strong>No Pages Yet</strong>
        ${canPublish() ? html`<span>Publish the pages first.</span><a class="btn primary" href="#/publish">Publish</a>` : html`<span>Nothing has been published yet.</span>`}</div></div>`);
      watchLargeTitle(); return;
    }
    const { positions } = m();
    const idx = await getIndex();
    const dueN = dueOf(reviewPool(idx)).length, symN = idx.pages.reduce((n, p) => n + p.symptoms.length, 0), fieldN = idx.pages.reduce((n, p) => n + (p.field || []).length, 0), weekN = weekCount(await D.growth());
    const termN = idx.pages.reduce((n, p) => n + (p.kind === 'standards' ? 0 : p.terms.length), 0), stdN = idx.pages.reduce((n, p) => n + (p.kind === 'standards' ? p.terms.length : 0), 0);
    const last = Object.entries(positions).map(([k, v]) => ({ k, ...v })).filter(p => p.f < 0.98 && all.some(a => `${a.tab}/${a.slug}` === p.k))
      .sort((a, b) => b.t - a.t)[0];

    seedSeen(idx);
    const nx = upNext(idx, navs, last ? last.k : null);
    const cont = [];
    if (last) {
      const [tab, slug] = last.k.split('/'); const pct = Math.round(last.f * 100);
      const c = html`<a class="continue" href="#/${tab}/${slug}" data-tab="${tab}">
          <div class="cover"><div class="cover-art">${coverArt(tab)}</div></div>
          <div class="continue-main"><span class="continue-sec">Continue · ${TAB[tab].name}</span><span class="continue-title">${last.title || slug}</span>
          <div class="bar"><span></span></div><span class="continue-meta">${pct}%</span></div>${chev()}</a>`;
      c.querySelector('.bar span').style.width = pct + '%';
      cont.push(c);
    }
    if (nx.page) {
      const p = nx.page;
      cont.push(html`<a class="continue up-next" href="#/${p.tab}/${p.slug}" data-tab="${p.tab}">
          <div class="cover"><div class="cover-art">${coverArt(p.tab)}</div></div>
          <div class="continue-main"><span class="continue-sec">Up next · ${TAB[p.tab].name}</span><span class="continue-title">${p.title}</span>
          <span class="continue-meta">${nx.after.length ? `After ${nx.after.map(a => a.title).join(' and ')} · ` : ''}${nx.minutes} min</span></div>${chev()}</a>`);
    }

    // What's new: pages that grew since the reader last read them, then pages not opened yet, newest first.
    const fresh = idx.pages.map(p => ({ p, ch: changesOf(p), m: all.find(a => a.tab === p.tab && a.slug === p.slug) }))
      .filter(x => x.m && (x.ch === null ? true : x.ch.length))
      .sort((a, b) => (b.ch && b.ch.length ? 1 : 0) - (a.ch && a.ch.length ? 1 : 0) || (b.m.updated || '').localeCompare(a.m.updated || ''))
      .slice(0, 5);

    const coverOf = (t, i) => {
      const pages = navs[i], done = pages.filter(p => progressOf(p.tab, p.slug) >= 0.98).length;
      return html`<a class="book-item" href="#/${t.id}" data-tab="${t.id}">
        <div class="cover"><div class="cover-art">${coverArt(t.id)}</div><span class="cover-sub">${t.kicker}</span><span class="cover-name">${t.cover || t.name}</span></div>
        <div class="book-meta"><span>${pages.length ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'Coming soon'}</span>
        ${D.editor && D.audienceOf(t.id) === 'selected' ? html`<span class="aud-tag" title="Selected users only">Selected</span>` : ''}
        ${done ? html`<span class="book-progress">${Math.round(done / pages.length * 100)}%</span>` : ''}</div></a>`;
    };

    render(main, html`<div class="hn-page">
      <h1 class="large-title">Home</h1>
      <button class="home-search" type="button" data-act="search">${icon('i-search')}<span>Search</span></button>
      ${cont.length ? html`<div class="section-head"><h2>Learning</h2><span class="head-note">${nx.read} of ${nx.total} chapters read</span></div>` : ''}${cont}
      <div class="section-head"><h2>Products</h2></div>
      ${shown(PRODUCTS).length ? html`<div class="shelf">${shown(PRODUCTS).map(t => coverOf(t, TABS.indexOf(t)))}</div>` : ''}
      <div class="section-head"><h2>Books</h2></div>
      <div class="shelf">${shown(BOOKS).map(t => coverOf(t, TABS.indexOf(t)))}</div>
      <div class="group gap-t">
        ${libRow('#/review', 'Review', 'i-review', 'it-review', dueN ? `${dueN} due` : '')}
        ${libRow('#/timeline', 'Timeline', 'i-timeline', 'it-timeline', weekN ? `+${weekN} this week` : '')}
        ${libRow('#/terms', 'All Terms', 'i-az', 'it-terms', termN)}
        ${libRow('#/standards', 'All Standards', 'i-standards', 'it-standards', stdN)}
      </div>
      ${fresh.length ? html`<div class="section-head"><h2>What's New</h2></div><div class="group">${fresh.map(({ p, ch, m: mt }) => {
        const grew = ch && ch.length, first = grew ? ch.find(c => c.id) : null;
        return html`<a class="hn-row" href="#/${p.tab}/${p.slug}${first ? '/' + first.id : ''}" data-tab="${p.tab}"><span class="row-main"><span class="row-title">${p.title}</span>
        <span class="row-meta"><span class="sr-tab">${TAB[p.tab].name}</span>${grew ? html`<span class="new-tag">${ch.length} ${ch.length === 1 ? 'section' : 'sections'} new since you read it</span>` : html`<span class="new-tag soft">New to you</span>`}<span>${fmtDate(mt.updated)}</span></span></span>${chev()}</a>`;
      })}</div>` : ''}
    </div>`);
    main.querySelector('.home-search').onclick = () => openSearch();
    watchLargeTitle();
  }

  async function viewSection(tab) {
    const t = TAB[tab];
    setActive('section', tab, null);
    setTitle(t.name);
    const pages = await loadToc(tab);
    setNav({ title: t.name, right: searchBtn() });
    const own = pages.filter(p => !p.linked), startSlug = (own.find(p => p.start) || own[0] || {}).slug;
    const idx = await getIndex(), dueN = dueOf(reviewPool(idx, tab)).length;
    const symN = idx.pages.filter(p => p.tab === tab).reduce((n, p) => n + p.symptoms.length, 0);
    const fieldN = idx.pages.filter(p => p.tab === tab).reduce((n, p) => n + (p.field || []).length, 0);
    seedSeen(idx);
    const groups = [];
    pages.forEach((p, i) => {
      const g = p.group || null;
      if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, rows: [] });
      const f = progressOf(p.tab, p.slug);
      const status = f >= 0.98 ? html`<span class="row-done" aria-label="Finished">✓</span>` : f > 0.02 ? html`<span class="row-value">${Math.round(f * 100)}%</span>` : '';
      const ip = pageOf(idx, `${p.tab}/${p.slug}`), ch = ip ? changesOf(ip) : null;
      groups[groups.length - 1].rows.push(html`<a class="hn-row" href="#/${p.tab}/${p.slug}"><span class="row-num">${i + 1}</span>
        <span class="row-main"><span class="row-title">${p.title}</span>${p.summary ? html`<span class="row-sub">${p.summary}</span>` : ''}
        <span class="row-meta">${ch && ch.length ? html`<span class="new-tag">${ch.length} new</span>` : ''}${p.linked ? html`<span class="from-tag" data-tab="${p.tab}">In ${TAB[p.tab] ? TAB[p.tab].name : p.tab}</span>` : ''}${draftTag(`${p.tab}/${p.slug}`)}${!p.linked && p.slug === startSlug && pages.length > 1 ? html`<span class="start-badge">Start here</span>` : ''}${p.updated ? html`<span>Updated ${fmtDate(p.updated)}</span>` : ''}</span></span>
        ${status}${chev()}</a>`);
    });
    render(main, html`<div class="hn-page"><h1 class="large-title">${t.name}</h1><p class="subtitle">${t.blurb}</p>
      ${audienceRow(tab)}${notesRow(tab)}${dueN ? html`<div class="group gap-b"><a class="hn-row with-icon" href="#/review/${tab}"><span class="icon-tile it-review">${icon('i-review')}</span>
      <span class="row-main"><span class="row-title">Review</span></span><span class="row-value">${dueN} due</span>${chev()}</a></div>` : ''}
      ${symN || fieldN ? html`<div class="group gap-b">
        ${symN ? html`<a class="hn-row with-icon" href="#/symptoms/${tab}"><span class="icon-tile it-symptoms">${icon('i-wrench')}</span><span class="row-main"><span class="row-title">Troubleshooting</span></span><span class="row-value">${symN}</span>${chev()}</a>` : ''}
        ${fieldN ? html`<a class="hn-row with-icon" href="#/field/${tab}"><span class="icon-tile it-field">${icon('i-globe')}</span><span class="row-main"><span class="row-title">In the Field</span></span><span class="row-value">${fieldN}</span>${chev()}</a>` : ''}</div>` : ''}
      ${pages.length ? groups.map(g => html`${g.g ? html`<p class="group-label">${g.g}</p>` : ''}<div class="group">${g.rows}</div>`) : html`<div class="empty"><strong>No Pages Yet</strong></div>`}</div>`);
    bindAudience(tab);
    watchLargeTitle();
  }

  // Who can read a notebook (editors see it; the tile admin changes it): everyone with HVAC Notes, or selected users,
  // who hold the tile right nb_<notebook> given on the DAME admin page. Selected with nobody given the right = hidden.
  const rightOf = tab => 'nb_' + tab.replace(/-/g, '_');
  function audienceRow(tab) {
    if (!D.editor) return '';
    const sel = D.audienceOf(tab) === 'selected';
    return html`<div class="group gap-b vis-row" id="vis-row"><div class="hn-row"><span class="row-main"><span class="row-title">Who can read</span>
      <span class="row-sub">${sel ? html`Selected users: those given the right <span class="mono">${rightOf(tab)}</span> on the DAME admin page (Tiles &gt; HVAC Notes &gt; Access). Editors always can.` : 'Everyone with HVAC Notes. Drafts stay with editors until approved.'}</span></span>
      ${D.approver ? html`<div class="seg vis-seg" role="group" aria-label="Who can read"><button type="button" data-aud="all" aria-pressed="${!sel}">All users</button><button type="button" data-aud="selected" aria-pressed="${sel}">Selected users</button></div>` : html`<span class="row-value">${sel ? 'Selected users' : 'All users'}</span>`}</div></div>`;
  }
  function bindAudience(tab) {
    main.querySelectorAll('[data-aud]').forEach(b => b.addEventListener('click', async () => {
      const v = b.dataset.aud;
      if (v === D.audienceOf(tab)) return;
      const ok = await Core.confirm(v === 'selected'
        ? `Only users given the right ${rightOf(tab)} will see ${TAB[tab].name}. Until someone has it, the notebook is hidden from everyone but editors.`
        : `Everyone with HVAC Notes will see the approved pages of ${TAB[tab].name}.`, { title: v === 'selected' ? 'Selected users' : 'All users', ok: 'Change' });
      if (!ok) return;
      try { await D.setAudience(tab, v); A.forgetIndex(); IDXC = null; toast(v === 'selected' ? `${TAB[tab].name}: selected users` : `${TAB[tab].name}: all users`); route(); }
      catch (err) { Core.showError(err); }
    }));
  }

  // A draft (editors only): who sees it, and Approve for the tile admin. An approved page: Hide for the tile admin.
  function visBar(tab, slug) {
    const r = `${tab}/${slug}`, draft = D.draft(r);
    if (draft) return html`<div class="vis-bar draft no-hl" id="vis-bar"><span class="draft-tag">Draft</span><span class="vis-text">Only editors see this page${D.approver ? '' : ' until the tile admin approves it'}.</span>${D.approver ? html`<button class="btn small primary" type="button" data-vis="approved">Approve</button>` : ''}</div>`;
    if (D.approver) return html`<div class="vis-bar no-hl" id="vis-bar"><span class="vis-text">Open to readers.</span><button class="btn small" type="button" data-vis="draft">Hide</button></div>`;
    return null;
  }
  function bindVis(tab, slug) {
    const b = main.querySelector('[data-vis]');
    if (!b) return;
    b.addEventListener('click', async () => {
      const to = b.dataset.vis;
      if (to === 'draft' && !(await Core.confirm('Readers will no longer see this page, its highlights and notes, or its search entries, until you approve it again.', { title: 'Hide page', ok: 'Hide', danger: true }))) return;
      try {
        await Core.busy(b, () => D.setStatus([`${tab}/${slug}`], to));
        A.forgetIndex(); IDXC = null;
        toast(to === 'approved' ? 'Approved: readers can open it now' : 'Hidden from readers');
        A.R = null; route();                       // same address: draw the page again
      } catch (err) { Core.showError(err); }
    });
  }

  let nbTab = null;           // notebook whose highlights are shown and exported
  let nbWho = 'all';          // whose: 'all' (everyone) or 'mine'
  function notebookItems(tab) {
    const all = nbWho === 'all' && othersOn();
    const hl = hlsOf(tab).map(h => ({ ...h, by: 'You', mine: true }))
      .concat(all ? D.shared.highlights.filter(h => h.tab === tab) : []);
    const cards = cardNotesOf(tab).map(c => ({ ...c, by: 'You', mine: true }));
    if (all) Object.entries(D.shared.cards).forEach(([key, list]) => {
      if (!key.startsWith(tab + '/')) return;
      const [, slug, id] = key.split('/');
      list.forEach(x => cards.push({ key, tab, slug, id, title: x.title, note: x.note, updated: x.updated, by: x.by }));
    });
    return { hl, cards, all };
  }
  function viewNotebook(tab) {
    if (!TAB[tab]) return viewMissing();
    nbTab = tab;
    setActive('notebook', tab, null);
    const t = TAB[tab], { hl, cards, all } = notebookItems(tab);
    setTitle(`${t.name} Highlights`);
    setNav({ left: backBtn(`#/${tab}`, t.name), title: 'Highlights & Notes', right: html`<button class="nav-btn" id="btn-export" type="button" aria-label="Export">${icon('i-share')}</button>` });
    const byLine = x => html`<div class="nb-date">${all ? `${x.by} · ` : ''}${fmtDate(x.created || x.updated)}</div>`;
    const byPage = {};
    hl.forEach(h => { (byPage[`${h.tab}/${h.slug}`] = byPage[`${h.tab}/${h.slug}`] || []).push(h); });
    const keys = Object.keys(byPage).sort((a, b) => a.localeCompare(b));
    const body = keys.map(k => {
      const [, slug] = k.split('/'), list = byPage[k].sort((a, b) => String(a.created).localeCompare(String(b.created)));
      return html`<section class="nb-page" data-tab="${tab}">
        <a class="nb-head" href="#/${tab}/${slug}"><span class="nb-title">${list[0].title || slug}</span></a>
        <div class="group">${list.map(h => html`<a class="nb-item" href="#/${tab}/${slug}/hl-${h.id}" data-c="${h.color}">
          <div class="nb-quote">${h.quote.exact}</div>
          ${h.note ? html`<div class="nb-note">${icon('i-note')}<span>${h.note}</span></div>` : ''}
          ${byLine(h)}</a>`)}</div></section>`;
    });
    cards.sort((a, b) => (a.slug + a.title).localeCompare(b.slug + b.title) || String(a.updated).localeCompare(String(b.updated)));
    const cardsBox = cards.length ? html`<section class="nb-page" data-tab="${tab}"><p class="nb-head"><span class="nb-title">Card Notes</span></p>
      <div class="group">${cards.map(c => html`<a class="nb-item kc-item" href="#/${tab}/${c.slug}/${c.id}" data-c="${cardColor(c.key)}">
        <div class="nb-quote">${c.title}</div><div class="nb-note">${icon('i-note')}<span>${c.note}</span></div>
        ${c.updated || all ? byLine(c) : ''}</a>`)}</div></section>` : '';
    const who = othersOn() ? html`<div class="seg gap-b" id="seg-who"><button type="button" data-v="all" aria-pressed="${nbWho === 'all'}">Everyone</button>
      <button type="button" data-v="mine" aria-pressed="${nbWho === 'mine'}">Mine</button></div>` : '';
    render(main, html`<div class="hn-page"><h1 class="large-title">Highlights &amp; Notes</h1><p class="subtitle">${t.name}</p>${who}
      ${keys.length || cards.length ? [body, cardsBox] : html`<div class="empty"><strong>No Highlights</strong></div>`}</div>`);
    main.querySelectorAll('#seg-who button').forEach(b => b.onclick = () => { nbWho = b.dataset.v; viewNotebook(tab); });
    watchLargeTitle();
  }

  let dsFilter = 'open';     // 'open' = notes without an answer from someone else, 'all'
  function viewDiscussions() {
    setActive('discussions', null, null);
    setTitle('Discussions');
    setNav({ left: backBtn('#/', 'Home'), title: 'Discussions', right: searchBtn() });
    const all = discussions().filter(x => x.note || x.replies.length);
    const list = dsFilter === 'open' ? all.filter(x => !x.answered) : all;
    const seg = html`<div class="seg gap-b" id="seg-ds"><button type="button" data-v="open" aria-pressed="${dsFilter === 'open'}">Unanswered</button>
      <button type="button" data-v="all" aria-pressed="${dsFilter === 'all'}">All</button></div>`;
    const item = x => html`<a class="nb-item ds-item" href="${x.href}" data-c="${x.color || ''}">
      <div class="ds-head"><span class="ds-page">${TAB[x.tab] ? TAB[x.tab].name : x.tab} · ${x.title}</span>${x.answered ? html`<span class="ds-tag ok">Answered</span>` : x.note ? html`<span class="ds-tag">Open</span>` : ''}</div>
      ${x.kind === 'highlight' ? html`<div class="nb-quote">${x.text}</div>` : ''}
      ${x.note ? html`<div class="nb-note">${icon('i-note')}<span>${x.note}</span></div>` : ''}
      <div class="nb-date">${x.by} · ${fmtDate(x.at)}${x.replies.length ? ` · ${plural(x.replies.length, 'reply', 'replies')}, last by ${x.replies[x.replies.length - 1].by}` : ''}</div></a>`;
    render(main, html`<div class="hn-page"><h1 class="large-title">Discussions</h1><p class="subtitle">Questions and notes from the team, with answers</p>${seg}
      ${list.length ? html`<div class="group">${list.map(item)}</div>` : html`<div class="empty"><strong>${dsFilter === 'open' ? 'Nothing Unanswered' : 'No Discussions Yet'}</strong><span>Highlight a sentence or open a card, write a note or question, and anyone can reply.</span></div>`}</div>`);
    main.querySelectorAll('#seg-ds button').forEach(b => b.onclick = () => { dsFilter = b.dataset.v; viewDiscussions(); });
    watchLargeTitle();
  }

  // Publish, inside the reader (right 'edit'): the panel's code is loaded the first time it is opened.
  const SCRIPT_V = (document.querySelector('script[src*="app-reader.js"]') || {}).src || '';
  const V = (SCRIPT_V.match(/\?v=([\w.-]+)/) || [])[1];
  function loadScript(name) {
    return new Promise((ok, no) => {
      if (document.querySelector(`script[data-hn="${name}"]`)) { ok(); return; }
      const sc = document.createElement('script');
      sc.src = `/hvac-notes/assets/js/${name}.js${V ? '?v=' + V : ''}`; sc.dataset.hn = name; sc.defer = true;
      sc.onload = ok; sc.onerror = () => no(new Error(`Could not load ${name}`));
      document.head.appendChild(sc);
    });
  }
  async function viewPublish() {
    if (!canPublish()) return viewMissing();
    setActive('publish', null, null);
    setTitle('Publish');
    setNav({ left: backBtn('#/', 'Home'), title: 'Publish' });
    render(main, html`<div class="hn-page hn-publish"><h1 class="large-title">Publish</h1><p class="subtitle">Upload pages, check them, and publish them to everyone who has HVAC Notes.</p>
      <div id="pub-host"><div class="loading-veil"><span class="spin"></span>Loading</div></div></div>`);
    watchLargeTitle();
    try {
      for (const n of ['lint', 'hn-zip', 'publish']) await loadScript(n);
      await window.HNPublish.mount(main.querySelector('#pub-host'));
    } catch (err) {
      if (err && err.code === 'SIGNED_OUT') { Core.showError(err); return; }
      render(main.querySelector('#pub-host'), html`<div class="empty"><strong>Cannot Load</strong><span>${Api.errorMessage(err)}</span></div>`);
    }
  }
  // A publish from inside the reader: the pages, index and timeline are read again next time.
  main.addEventListener('hn-published', () => { D.reset(); A.forgetIndex(); IDXC = null; getIndex().then(x => { IDXC = x; }, () => { }); renderSidebar(); });

  function viewMissing() {
    setActive('missing', null, null);
    setTitle('Not Found');
    setNav({ left: backBtn('#/', 'Home') });
    render(main, html`<div class="hn-page"><div class="empty tall"><strong>Not Found</strong>
      <div class="empty-actions"><button class="btn" type="button" data-act="search">${icon('i-search')}Search</button><a class="btn primary" href="#/">Home</a></div></div></div>`);
    main.querySelector('[data-act="search"]').onclick = () => openSearch();
    navbar.classList.add('solid');
  }

  function emptyView(view, title, back, focus) {
    setActive(view, null, null);
    setTitle(title);
    setNav({ left: back ? backBtn(back[0], back[1]) : '', title, right: [focus ? focusBtn() : '', searchBtn()] });
  }

  /* In the Field: every "## In the field" item in every notebook, newest first */
  async function viewField(tab) {
    if (!TAB[tab]) return viewMissing();
    const t = TAB[tab];
    setActive('field', tab, null);
    setTitle(`${t.name} · In the Field`);
    setNav({ left: backBtn(`#/${tab}`, t.name), title: 'In the Field', right: searchBtn() });
    const idx = await getIndex();
    const items = idx.pages.filter(p => p.tab === tab).flatMap(p => (p.field || []).map(x => ({ ...x, p }))).sort((a, b) => b.date.localeCompare(a.date));
    const kinds = [...new Set(items.map(x => x.kind))];
    const months = {};
    items.forEach(x => { const k = x.date.slice(0, 7); (months[k] = months[k] || []).push(x); });
    const body = Object.entries(months).map(([mo, list]) => html`<p class="group-label fd-month">${fmtMonth(mo)}</p><div class="group field-group">${list.map(x =>
      html`<div class="fd" data-kind="${slugify(x.kind)}" data-tab="${x.p.tab}">${fieldItem(x,
        html`<a class="fd-from" href="#/${x.p.tab}/${x.p.slug}/in-the-field">${TAB[x.p.tab] ? TAB[x.p.tab].name : x.p.tab} · ${x.p.title}</a>`)}</div>`)}</div>`);
    render(main, html`<div class="hn-page"><h1 class="large-title">In the Field</h1><p class="subtitle">${t.name}</p>
      ${kinds.length > 1 ? html`<div class="seg fd-filter" role="group" aria-label="Kind"><button type="button" aria-pressed="true" data-k="">All</button>${kinds.map(k => html`<button type="button" aria-pressed="false" data-k="${slugify(k)}">${k}</button>`)}</div>` : ''}
      <div id="fd-body">${body.length ? body : html`<div class="empty"><strong>Nothing Yet</strong></div>`}</div></div>`);
    const f = main.querySelector('.fd-filter');
    if (f) f.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      f.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      main.querySelectorAll('#fd-body .fd').forEach(r => { r.hidden = !!b.dataset.k && r.dataset.kind !== b.dataset.k; });
      main.querySelectorAll('#fd-body .field-group').forEach(g => { const any = [...g.children].some(r => !r.hidden); g.hidden = !any; g.previousElementSibling.hidden = !any; });
    });
    watchLargeTitle();
  }

  /* Troubleshooting: every "### Symptom: …" in every notebook */
  async function viewSymptoms(tab) {
    if (!TAB[tab]) return viewMissing();
    const t = TAB[tab];
    setActive('symptoms', tab, null);
    setTitle(`${t.name} · Troubleshooting`);
    setNav({ left: backBtn(`#/${tab}`, t.name), title: 'Troubleshooting', right: searchBtn() });
    const idx = await getIndex();
    const byPage = idx.pages.filter(p => p.tab === tab && p.symptoms.length);
    const body = byPage.map(p => html`<p class="group-label" data-tab="${tab}">${p.title}</p><div class="group">${p.symptoms.map(s => html`<a class="hn-row" href="#/${p.tab}/${p.slug}/${s.id}" data-tab="${p.tab}">
        <span class="row-main"><span class="row-title">${s.title.replace(/^./, c => c.toUpperCase())}</span></span>${chev()}</a>`)}</div>`);
    render(main, html`<div class="hn-page"><h1 class="large-title">Troubleshooting</h1><p class="subtitle">${t.name}</p>${body.length ? body : html`<div class="empty"><strong>No Symptoms Yet</strong></div>`}</div>`);
    watchLargeTitle();
  }

  /* Timeline: how the library grew, day by day (written by the Publish page) */
  const dayName = iso => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const y = new Date(Date.parse(today + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
    if (iso === today) return 'Today';
    if (iso === y) return 'Yesterday';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  function growthLine(it, idx) {
    const parts = [];
    const names = list => list.slice(0, 3).map(x => x.h).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
    if (it.kind === 'new') {
      const p = pageOf(idx, it.route);                 // counts as the page stands now
      const terms = p ? p.terms.length : (it.terms || []).length, secs = p ? p.sections.filter(x => x.heading && !/^sources$/i.test(x.heading)).length : it.sections;
      if (it.cards) return it.std ? `New standards chapter · ${plural(terms, 'card', 'cards')}` : `New dictionary · ${plural(terms, 'term', 'terms')}`;
      return `New chapter · ${plural(secs, 'section', 'sections')}${p ? ` · ${Math.max(1, Math.round(p.words / 200))} min` : ''}`;
    }
    if ((it.added || []).length) parts.push(`+${plural(it.added.length, 'section', 'sections')}: ${names(it.added)}`);
    if ((it.terms || []).length) parts.push(`+${plural(it.terms.length, it.std ? 'card' : 'term', it.std ? 'cards' : 'terms')}: ${names(it.terms)}`);
    if (it.symptoms) parts.push(`+${plural(it.symptoms, 'symptom', 'symptoms')}`);
    if (it.checks) parts.push(`+${plural(it.checks, 'question', 'questions')}`);
    if ((it.changed || []).length) parts.push(`Updated: ${names(it.changed)}`);
    return parts.join(' · ');
  }
  function weekCount(log) {
    if (!log) return 0;
    const from = new Date(Date.now() - 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    return log.days.filter(d => d.date >= from).reduce((n, d) => n + d.items.length, 0);
  }
  async function viewTimeline() {
    emptyView('timeline', 'Timeline');
    const [idx, log] = await Promise.all([getIndex(), D.growth()]);
    const chapters = idx.pages.filter(p => p.layout !== 'cards').length;
    const terms = idx.pages.reduce((n, p) => n + (p.kind === 'standards' ? 0 : p.terms.length), 0), stds = idx.pages.reduce((n, p) => n + (p.kind === 'standards' ? p.terms.length : 0), 0);
    const syms = idx.pages.reduce((n, p) => n + p.symptoms.length, 0), qs = idx.pages.reduce((n, p) => n + p.checks.length, 0);
    const stat = (n, label) => html`<div class="tl-stat"><b>${n}</b><span>${label}</span></div>`;
    const days = log ? [...log.days].reverse() : [];
    render(main, html`<div class="hn-page"><h1 class="large-title">Timeline</h1>
      <div class="tl-stats">${stat(chapters, 'chapters')}${stat(terms, 'terms')}${stat(stds, 'standards')}${stat(syms, 'symptoms')}${stat(qs, 'questions')}</div>
      ${days.length ? days.map(d => {
        const items = [...d.items].reverse();
        const newP = items.filter(i => i.kind === 'new').length, grew = items.length - newP;
        return html`<div class="section-head"><h2>${dayName(d.date)}</h2><span class="head-note">${[newP ? plural(newP, 'new page', 'new pages') : '', grew ? plural(grew, 'page grew', 'pages grew') : ''].filter(Boolean).join(' · ')}</span></div>
          <div class="group">${items.map(it => {
            const [tab, slug] = it.route.split('/'), first = (it.added || [])[0] || (it.terms || [])[0];
            return html`<a class="hn-row" href="#/${tab}/${slug}${it.kind !== 'new' && first && first.id ? '/' + first.id : ''}" data-tab="${tab}"><span class="row-main"><span class="row-title">${it.title}</span>
              <span class="row-meta"><span class="sr-tab">${TAB[tab] ? TAB[tab].name : tab}</span></span><span class="row-sub">${growthLine(it, idx)}</span></span>${chev()}</a>`;
          })}</div>`;
      }) : html`<div class="empty"><strong>No History Yet</strong></div>`}</div>`);
    watchLargeTitle();
  }

  const scrollToGroup = el => {
    const strip = main.querySelector('.az-strip');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - navbar.getBoundingClientRect().bottom - (strip ? strip.offsetHeight : 0) - 8, behavior: reduced() ? 'auto' : 'smooth' });
  };
  /* All terms A–Z: every card in every notebook's dictionary */
  async function viewTerms() {
    emptyView('terms', 'All Terms', null, true);
    const idx = await getIndex();
    const terms = idx.pages.filter(p => p.kind !== 'standards').flatMap(p => p.terms.map(t => ({ ...t, p })))
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }));
    const letterOf = t => { const c = t.title.normalize('NFKD').charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
    const groups = [];
    terms.forEach(t => { const L = letterOf(t); if (!groups.length || groups[groups.length - 1].L !== L) groups.push({ L, items: [] }); groups[groups.length - 1].items.push(t); });
    render(main, html`<div class="hn-page"><h1 class="large-title">All Terms</h1>
      ${groups.length > 1 ? html`<div class="az-strip" role="group" aria-label="Letters">${groups.map(g => html`<button type="button" data-letter="${g.L}">${g.L}</button>`)}</div>` : ''}
      ${groups.length ? groups.map(g => html`<p class="group-label az-letter" id="az-${g.L === '#' ? 'num' : g.L}">${g.L}</p><ul class="az-tiles">${g.items.map(t => html`<li data-c="${autoColor(t.id)}">
        <a href="#/${t.p.tab}/${t.p.slug}/${t.id}"><span class="az-title">${t.title}</span>${t.meaning ? html`<span class="az-meaning">${t.meaning}</span>` : ''}
        <span class="az-tab" data-tab="${t.p.tab}">${TAB[t.p.tab] ? TAB[t.p.tab].name : t.p.tab}</span></a></li>`)}</ul>`) : html`<div class="empty"><strong>No Terms Yet</strong></div>`}</div>`);
    main.querySelectorAll('[data-letter]').forEach(b => b.onclick = () => scrollToGroup($('#az-' + (b.dataset.letter === '#' ? 'num' : b.dataset.letter))));
    watchLargeTitle();
  }

  /* All standards: every card on every standards page, grouped by the body that publishes it */
  function bodyOf(title) {
    const first = title.split(/[\s(]/)[0];
    const parts = first.split('/').filter(x => x && !/^ANSI$/i.test(x));
    const w = (parts.find(x => /^(ASHRAE|AHRI|ISO|EN|IEC|AMCA|ASTM|BS|UL|NFPA|DIN|VDI|CIBSE|SMACNA)$/i.test(x)) || parts[0] || first).replace(/[^A-Za-z]/g, '');
    return w || '#';
  }
  async function viewStandards() {
    emptyView('standards', 'All Standards', null, true);
    const idx = await getIndex();
    const items = idx.pages.filter(p => p.kind === 'standards').flatMap(p => p.terms.map(t => ({ ...t, p, body: bodyOf(t.title) })))
      .sort((a, b) => a.body.localeCompare(b.body) || a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }));
    const groups = [];
    items.forEach(t => { if (!groups.length || groups[groups.length - 1].B !== t.body) groups.push({ B: t.body, items: [] }); groups[groups.length - 1].items.push(t); });
    const sid = B => 'std-' + slugify(B);
    render(main, html`<div class="hn-page"><h1 class="large-title">All Standards</h1>
      ${groups.length > 1 ? html`<div class="az-strip" role="group" aria-label="Publishers">${groups.map(g => html`<button type="button" data-body="${g.B}">${g.B}</button>`)}</div>` : ''}
      ${groups.length ? groups.map(g => html`<p class="group-label az-letter" id="${sid(g.B)}">${g.B}</p><ul class="az-tiles">${g.items.map(t => html`<li data-c="${autoColor(t.body)}">
        <a href="#/${t.p.tab}/${t.p.slug}/${t.id}"><span class="az-title">${t.title}</span>${t.type ? html`<span class="std-type">${t.type}</span>` : ''}${t.meaning ? html`<span class="az-meaning">${t.meaning}</span>` : ''}
        <span class="az-tab" data-tab="${t.p.tab}">${TAB[t.p.tab] ? TAB[t.p.tab].name : t.p.tab}</span></a></li>`)}</ul>`) : html`<div class="empty"><strong>No Standards Yet</strong></div>`}</div>`);
    main.querySelectorAll('[data-body]').forEach(b => b.onclick = () => scrollToGroup($('#' + sid(b.dataset.body))));
    watchLargeTitle();
  }

  /* Review: Check yourself questions from pages already opened, spaced by a simple Leitner schedule */
  async function viewReview(tab) {
    if (tab && !TAB[tab]) return viewMissing();
    emptyView('review', 'Review', tab ? [`#/${tab}`, TAB[tab].name] : null);
    const idx = await getIndex();
    const pool = reviewPool(idx, tab), queue = dueOf(pool);
    const total = queue.length;
    let done = 0;
    const head = () => html`<h1 class="large-title">Review</h1>${tab ? html`<p class="subtitle">${TAB[tab].name}</p>` : ''}`;
    const show = () => {
      const { reviewState } = m();
      if (!queue.length) {
        const next = pool.map(x => (reviewState[x.key] || {}).due).filter(d => d > Date.now()).sort((a, b) => a - b)[0];
        render(main, html`<div class="hn-page">${head()}<div class="empty"><strong>${pool.length ? 'All Caught Up' : 'No Questions Yet'}</strong>
          ${next ? html`<span>Next review ${fmtDate(new Date(next).toISOString())}</span>` : ''}</div></div>`);
        watchLargeTitle(); return;
      }
      const x = queue[0];
      render(main, html`<div class="hn-page">${head()}
        <div class="rv-count">${done + 1} of ${total}</div>
        <div class="rv-card" data-tab="${x.page.tab}">
          <a class="rv-src" href="#/${x.page.tab}/${x.page.slug}${x.c.id ? '/' + x.c.id : ''}"><span class="sr-tab">${TAB[x.page.tab].name}</span> ${x.page.title}</a>
          <div class="rv-q book">${renderMarkdown(x.c.q)}</div>
          <div class="rv-a book" hidden>${renderMarkdown(x.c.a)}</div>
          <div class="rv-actions"><button class="btn" type="button" data-act="show">Show Answer</button></div>
        </div></div>`);
      const actions = main.querySelector('.rv-actions');
      main.querySelector('[data-act="show"]').onclick = () => {
        main.querySelector('.rv-a').hidden = false;
        render(actions, html`<button class="btn" type="button" data-act="again">Again</button><button class="btn primary" type="button" data-act="good">Got It</button>`);
        actions.querySelector('[data-act="again"]').onclick = () => { reviewState[x.key] = { box: 1, due: Date.now() + 10 * 60e3 }; saveReview(); queue.push(queue.shift()); show(); };
        actions.querySelector('[data-act="good"]').onclick = () => {
          const box = Math.min(((reviewState[x.key] || {}).box || 0) + 1, BOX_DAYS.length - 1);
          reviewState[x.key] = { box, due: Date.now() + BOX_DAYS[box] * DAY }; saveReview(); queue.shift(); done++; show();
        };
      };
      watchLargeTitle();
    };
    show();
  }

  /* ================= focus mode: one card at a time ================= */
  // On a phone it fills the screen (swipe or tap Previous / Next); on a wide screen it is a reading pane over the
  // dimmed page, with the cards before and after shown faintly. Colour and note are edited in place.
  const FX_SIZES = [0.85, 1, 1.15, 1.3, 1.5];
  let FX = null;

  // A card for focus or peek: its title, and a copy of its body without the heading and the edit controls.
  function cardItem(c, tab, slug, src) {
    const x = clone(c);
    x.querySelectorAll('.kcard-edit, .kcard-note').forEach(n => n.remove());
    const h = x.querySelector('h3'), title = h ? h.textContent : '';
    if (h) h.remove();
    return { key: c.dataset.k, title, body: x, tab, slug, src };
  }
  const bodyOfCard = c => [...clone(c.body).childNodes];
  const cardsCache = {};
  async function cardsOfPage(tab, slug, src) {
    const k = `${tab}/${slug}`;
    if (!cardsCache[k]) {
      const tpl = document.createElement('div');
      tpl.append(renderMarkdown(await loadPage(tab, slug)));
      enhance(tpl, tab); cardify(tpl, tab, slug);
      cardsCache[k] = [...tpl.querySelectorAll('.kcard')].map(c => cardItem(c, tab, slug, src));
    }
    return cardsCache[k];
  }
  // The first card at least partly below the bar: focus opens where the reader is.
  function firstVisible(els) {
    const top = navbar.getBoundingClientRect().bottom;
    const i = els.findIndex(e => e.getBoundingClientRect().bottom > top + 40);
    return Math.max(0, i);
  }

  // Focus mode opened on one card of the page being read (colour, note and replies are edited there).
  function focusCard(card) {
    const R = A.R; if (!R || !card) return;
    const els = [...document.querySelectorAll('#book .kcard')];
    openFocus(els.map(c => cardItem(c, R.tab, R.slug, '')), Math.max(0, els.indexOf(card)), R.title, 'page');
  }
  async function startFocus() {
    const R = A.R;
    if (where.view === 'reader' && R && root.dataset.layout === 'cards') {
      const els = [...document.querySelectorAll('#book .kcard')];
      if (!els.length) return;
      openFocus(els.map(c => cardItem(c, R.tab, R.slug, '')), firstVisible(els), R.title, 'page');
      return;
    }
    if (where.view !== 'terms' && where.view !== 'standards') return;
    const links = [...main.querySelectorAll('.az-tiles a')];
    if (!links.length) return;
    const routes = links.map(a => a.getAttribute('href').replace(/^#\//, ''));
    const pages = [...new Set(routes.map(r => r.split('/').slice(0, 2).join('/')))];
    await D.pages(pages);
    const byKey = {};
    await Promise.all(pages.map(async pg => {
      const [tab, slug] = pg.split('/');
      const meta = (await loadNav(tab)).find(p => p.slug === slug);
      (await cardsOfPage(tab, slug, `${TAB[tab] ? TAB[tab].name : tab} · ${meta ? meta.title : slug}`)).forEach(c => { byKey[c.key] = c; });
    }));
    const list = routes.map(r => byKey[r]).filter(Boolean);
    openFocus(list, firstVisible(links.map(a => a.closest('li'))), where.view === 'terms' ? 'All Terms' : 'All Standards', 'list');
  }

  function openFocus(list, start, title, from) {
    if (!list.length) return;
    closeFocus();
    const k = settings.focusK;
    FX = { list, i: clamp(start, 0, list.length - 1), title, from, k: FX_SIZES.includes(k) ? k : 1 };
    const el = one(html`<div class="fx" role="dialog" aria-modal="true" aria-label="Focus: ${title}"><div class="fx-win">
      <div class="fx-top"><button class="link-btn" type="button" data-fx="done">Done</button>
        <span class="fx-count" aria-live="polite"></span>
        <span class="fx-size"><button type="button" data-fx="smaller" aria-label="Smaller text">A</button><button type="button" data-fx="larger" aria-label="Larger text">A</button></span></div>
      <div class="fx-bar"><i></i></div>
      <div class="fx-body"><div class="fx-in"></div></div>
      <div class="fx-nav"><button type="button" data-fx="prev"><span>Previous</span><b></b></button><button type="button" data-fx="next"><span>Next</span><b></b></button></div></div></div>`);
    document.body.appendChild(el); document.body.classList.add('no-scroll');
    FX.el = el;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-fx]');
      if (e.target === el) { closeFocus(); return; }                 // a click on the dimmed page closes
      if (!b) return;
      const a = b.dataset.fx;
      if (a === 'done') closeFocus();
      else if (a === 'prev') focusGo(FX.i - 1);
      else if (a === 'next') focusGo(FX.i + 1);
      else if (a === 'ctx') focusGo(+b.dataset.i);
      else if (a === 'smaller' || a === 'larger') {
        const j = clamp(FX_SIZES.indexOf(FX.k) + (a === 'larger' ? 1 : -1), 0, FX_SIZES.length - 1);
        FX.k = FX_SIZES[j]; settings.focusK = FX.k; saveView(); focusSize();
      }
      else if (a === 'color') focusColor(b.dataset.c);
    });
    let sx = null, sy = 0;
    const body = el.querySelector('.fx-body');
    body.addEventListener('touchstart', e => { sx = e.target.closest('textarea, .hn-table, .math-display') || e.touches.length > 1 ? null : e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    body.addEventListener('touchend', e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) focusGo(FX.i + (dx < 0 ? 1 : -1));
    });
    focusSize(); focusRender(0);
    const win = el.querySelector('.fx-win'); win.tabIndex = -1; win.focus({ preventScroll: true });
  }

  function focusSize() {
    if (!FX) return;
    FX.el.style.setProperty('--fx-k', FX.k);
    FX.el.querySelector('[data-fx="smaller"]').disabled = FX.k === FX_SIZES[0];
    FX.el.querySelector('[data-fx="larger"]').disabled = FX.k === FX_SIZES[FX_SIZES.length - 1];
  }

  function focusGo(i) {
    if (!FX || i < 0 || i >= FX.list.length || i === FX.i) return;
    const dir = i > FX.i ? 1 : -1; FX.i = i; focusRender(dir);
  }

  function focusRender(dir) {
    const { cardState } = m();
    const { list, i, el } = FX, c = list[i], st = cardState[c.key] || {}, color = cardColor(c.key);
    const prev = list[i - 1], next = list[i + 1];
    el.querySelector('.fx-count').textContent = `${i + 1} of ${list.length}`;
    el.querySelector('.fx-bar i').style.width = ((i + 1) / list.length * 100).toFixed(1) + '%';
    const ctx = (x, j) => x ? html`<button class="fx-ctx" type="button" data-fx="ctx" data-i="${j}">${x.title}</button>` : '';
    render(el.querySelector('.fx-in'), html`${ctx(prev, i - 1)}
      <div class="fx-slide ${dir < 0 ? 'back' : ''} ${dir === 0 || reduced() ? 'still' : ''}" data-tab="${c.tab}">
        ${c.src ? html`<p class="fx-src">${c.src}</p>` : ''}
        <div class="book fx-book"><section class="kcard fx-card" data-c="${color}" data-k="${c.key}"><h2 class="fx-title">${c.title}</h2>${bodyOfCard(c)}</section></div>
        <div class="fx-tools">
          <div class="fx-swatches" role="group" aria-label="Colour">${KCOLORS.map(([k, name]) => html`<button class="kswatch" type="button" data-fx="color" data-c="${k}" aria-pressed="${k === color}" aria-label="${name}" title="${name}"></button>`)}</div>
          <textarea class="fx-note" rows="2" placeholder="Note" aria-label="Note on ${c.title}"></textarea>
          ${st.note && st.row ? [html`<p class="sheet-sec">Replies to your note</p>`, thread('card', st.row, () => repaintPageCard(c.key))] : ''}
          ${otherNotes(c.key, () => repaintPageCard(c.key))}
        </div>
      </div>${ctx(next, i + 1)}`);
    const nav = el.querySelectorAll('.fx-nav button');
    nav[0].disabled = !prev; nav[0].querySelector('b').textContent = prev ? prev.title : '';
    nav[1].disabled = !next; nav[1].querySelector('b').textContent = next ? next.title : '';
    loadImages(el.querySelector('.fx-card'), () => { });
    el.querySelector('.fx-body').scrollTop = 0;
    const note = el.querySelector('.fx-note'), grow = () => { note.style.height = 'auto'; note.style.height = note.scrollHeight + 'px'; };
    note.value = st.note || '';
    grow();
    note.addEventListener('input', () => { grow(); focusNote(note.value); });
  }

  function focusState() {
    const c = FX.list[FX.i];
    return { c, st: cardEntry(c.key, c.title) };
  }
  function repaintPageCard(key) {
    const card = document.querySelector(`#book .kcard[data-k="${CSS.escape(key)}"]`);
    if (card) paintCard(card);
  }
  function focusColor(color) {
    const { c, st } = focusState();
    Object.assign(st, { color, title: c.title, updated: new Date().toISOString() }); D.save.card(c.key, 0);
    FX.el.querySelector('.fx-card').dataset.c = color;
    FX.el.querySelectorAll('.fx-swatches .kswatch').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === color));
    repaintPageCard(c.key);
  }
  const focusNote = debounce(value => {
    if (!FX) return;
    const { c, st } = focusState();
    Object.assign(st, { note: value.trim(), title: c.title, updated: new Date().toISOString() }); D.save.card(c.key);
    repaintPageCard(c.key); renderSidebar();
  }, 250);

  function closeFocus() {
    if (!FX) return false;
    const { el, from, list, i } = FX;
    const ta = el.querySelector('.fx-note');
    if (ta && document.activeElement === ta) ta.blur();
    FX = null; el.remove();
    if (!sheetOpen && searchEl.hidden && !viewerEl) document.body.classList.remove('no-scroll');
    // Back on the page, the card last read is in view.
    if (from === 'page' && A.R) {
      const card = document.querySelector(`#book .kcard[data-k="${CSS.escape(list[i].key)}"]`);
      if (card) goToEl(card, true);
    }
    return true;
  }
  function focusKey(e) {
    const typing = /input|textarea/i.test(document.activeElement.tagName);
    if (e.key === 'Escape') { e.preventDefault(); if (typing) document.activeElement.blur(); else closeFocus(); return; }
    if (typing) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); focusGo(FX.i + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); focusGo(FX.i - 1); }
    else if (e.key === 'Home') focusGo(0);
    else if (e.key === 'End') focusGo(FX.list.length - 1);
  }

  /* ================= term peek: a term's card read in place ================= */

  // A link to a card on a dictionary or standards page (#/tab/slug/card-id) opens the card in a sheet,
  // so the reader keeps their place. Links to the page being read still scroll as before.
  let IDXC = null;          // the index once loaded (start() fills it), so a tap on a link never waits
  function peekTarget(a) {
    const mm = (a.getAttribute('href') || '').match(/^#\/([a-z0-9-]+)\/([a-z0-9-]+)\/([\w-]+)$/);
    if (!mm || !IDXC) return null;
    const [, tab, slug, id] = mm, p = pageOf(IDXC, `${tab}/${slug}`);
    if (!p || p.layout !== 'cards' || !p.terms.some(t => t.id === id)) return null;
    const R = A.R;
    if (R && R.tab === tab && R.slug === slug && where.view === 'reader') return null;
    return { tab, slug, id, page: p };
  }
  function peekLink(e) {
    const a = e.target.closest('a[href^="#/"]:not([data-nopeek])');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || hasSelection()) return false;
    const t = peekTarget(a);
    if (!t) return false;
    e.preventDefault();
    openPeek(t);
    return true;
  }
  async function openPeek(t) {
    const cards = await cardsOfPage(t.tab, t.slug, '');
    const c = cards.find(x => x.key === `${t.tab}/${t.slug}/${t.id}`); if (!c) { location.hash = `#/${t.tab}/${t.slug}/${t.id}`; return; }
    openSheet(html`<div class="sheet-head"><span></span><h2>${TAB[t.tab] ? TAB[t.tab].name : ''} · ${t.page.title}</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="book peek-book"><section class="kcard" data-c="${cardColor(c.key)}" data-k="${c.key}"><h3>${c.title}</h3>${bodyOfCard(c)}
      ${cardNotes(c.key).map(x => html`<p class="kcard-note no-hl static ${x.mine ? '' : 'other'}">${icon('i-note')}<span>${noteBy(x.by)}${x.note}</span></p>`)}</section></div>
      <div class="sheet-actions"><a class="btn" data-nopeek href="#/${t.tab}/${t.slug}/${t.id}">Open in ${t.page.title}</a></div>`, body => {
      body.addEventListener('click', e => { if (peekLink(e)) e.stopPropagation(); });
      loadImages(body, () => { });
    });
  }

  /* ================= reader ================= */

  let suppressClick = 0;

  async function viewReader(tab, slug, anchor) {
    const pages = await loadNav(tab);
    const i = pages.findIndex(p => p.slug === slug), meta = pages[i];
    if (i < 0) {                                       // a renamed or moved page: follow its alias
      const to = (await aliasMap())[`${tab}/${slug}`];
      if (to) { location.replace(`#/${to}${anchor ? '/' + anchor : ''}`); return; }
    }
    setActive('reader', tab, slug);
    const find = FIND && FIND.href === location.hash ? FIND : null; FIND = null;
    let md;
    try { md = await loadPage(tab, slug); } catch (e) { if (e && e.code === 'SIGNED_OUT') { Core.showError(e); return; } return viewMissing(); }

    const tpl = document.createElement('div');
    tpl.append(renderMarkdown(md));
    enhance(tpl, tab);
    if (meta && meta.layout === 'cards') { cardify(tpl, tab, slug); root.dataset.layout = 'cards'; }
    const h1 = tpl.querySelector('h1');
    const title = h1 ? h1.textContent : (meta ? meta.title : slug);
    const idx = await getIndex();
    const metaNodes = [];
    if (meta && meta.updated) metaNodes.push(html`<p class="page-meta no-hl">Updated ${fmtDate(meta.updated)}</p>`);
    const first = ((meta && meta.prereq) || []).map(r => pageOf(idx, r)).filter(Boolean);
    if (first.length) metaNodes.push(html`<p class="prereq no-hl"><span>Read first</span> ${first.map((p, k) => html`${k ? ' · ' : ''}<a href="#/${p.tab}/${p.slug}">${p.title}</a>`)}</p>`);
    seedSeen(idx);
    const ip = pageOf(idx, `${tab}/${slug}`), ch = ip ? changesOf(ip) : null;
    if (ch && ch.length) {
      const old = m().seen[`${tab}/${slug}`], log = ch.some(c => c.kind === 'updated') ? await D.growth() : null;
      ch.forEach(c => {
        const h = c.id && tpl.querySelector('#' + CSS.escape(c.id)); if (!h) return;
        h.append(' ', html`<span class="new-pill no-hl">${c.kind === 'new' ? 'New' : 'Updated'}</span>`);
        if (c.kind !== 'updated') return;
        // What changed in this section since it was last read here: the words before and after.
        const w = wasOf(log, `${tab}/${slug}`, c.id, old), sec = ip.sections.find(x => x.id === c.id);
        const d = w && sec ? wordDiff(w.was, sec.text || '') : null;
        if (!d) return;
        const deep = h.classList.contains('deep');
        h.after(html`<div class="chg no-hl${deep ? ' deep' : ''}" data-deep-of="${deep ? h.dataset.deepOf : null}"><span class="chg-t">${d.rewritten ? 'Rewritten' : 'Changed'} since you read it · ${fmtDate(w.date)}</span>${d.rewritten ? '' : [d.parts.map(x => html`<span class="chg-d">${x}</span>`), d.more ? html`<span class="chg-m">and ${plural(d.more, 'more change', 'more changes')}</span>` : '']}</div>`);
      });
      const firstId = (ch.find(c => c.id) || {}).id;
      const label = `${ch.length} ${ch.length === 1 ? 'section' : 'sections'} new or updated since you last read this page`;
      metaNodes.push(html`<p class="grew no-hl">${firstId ? html`<a href="#/${tab}/${slug}/${firstId}">${label}</a>` : html`<span>${label}</span>`}</p>`);
    }
    if (ip) markSeen(ip);
    const vb = D.editor ? visBar(tab, slug) : null;
    if (vb) metaNodes.unshift(vb);
    if (metaNodes.length) { if (h1) h1.after(...metaNodes); else tpl.prepend(...metaNodes); }
    const prev = i > 0 ? pages[i - 1] : null, next = i >= 0 && i < pages.length - 1 ? pages[i + 1] : null;
    const rel = relatedOf(idx, tab, slug, meta, [prev, next].filter(Boolean).map(p => `${tab}/${p.slug}`));
    const tail = [];
    const std = meta && meta.kind === 'standards';
    if (meta && meta.layout === 'cards') tail.push(html`<div class="group related-az"><a class="hn-row with-icon" href="#/${std ? 'standards' : 'terms'}"><span class="icon-tile ${std ? 'it-standards' : 'it-terms'}">${icon(std ? 'i-standards' : 'i-az')}</span>
      <span class="row-main"><span class="row-title">${std ? 'All Standards' : 'All Terms'}</span></span>${chev()}</a></div>`);
    if (rel.length) tail.push(html`<p class="related-h">Related</p><div class="group related">${rel.map(p => html`<a class="hn-row" href="#/${p.tab}/${p.slug}" data-tab="${p.tab}">
      <span class="row-main"><span class="row-title">${p.title}</span><span class="row-meta"><span class="sr-tab">${TAB[p.tab] ? TAB[p.tab].name : p.tab}</span>${p.summary ? html`<span>${p.summary}</span>` : ''}</span></span>${chev()}</a>`)}</div>`);
    if (tail.length) tpl.append(html`<section class="page-tail no-hl">${tail}</section>`);
    if (prev || next) tpl.append(html`<nav class="pager no-hl" aria-label="Previous and next page">
      ${prev ? html`<a class="pg-prev" href="#/${tab}/${prev.slug}"><span class="pg-dir">Previous</span><span class="pg-title">${prev.title}</span></a>` : html`<span></span>`}
      ${next ? html`<a class="pg-next" href="#/${tab}/${next.slug}"><span class="pg-dir">Next</span><span class="pg-title">${next.title}</span></a>` : ''}</nav>`);
    const words = (tpl.textContent.match(/\S+/g) || []).length;
    const deepWords = [...tpl.querySelectorAll('.deep')].reduce((n, e) => n + (e.textContent.match(/\S+/g) || []).length, 0);
    const hasDeep = deepWords > 0;
    const minFull = Math.max(1, Math.round(words / 200)), minEss = Math.max(1, Math.round((words - deepWords) / 200));
    if (hasDeep) {
      const seg = html`<div class="seg depth-seg no-hl" role="group" aria-label="Depth"><button type="button" data-depth-set="essentials" aria-pressed="${settings.depth === 'essentials'}">Essentials · ${minEss} min</button><button type="button" data-depth-set="full" aria-pressed="${settings.depth !== 'essentials'}">Full · ${minFull} min</button></div>`;
      const anchorEl = tpl.querySelector('.prereq') || tpl.querySelector('.page-meta') || h1;
      if (anchorEl) anchorEl.after(seg); else tpl.prepend(seg);
    }

    setTitle(title);
    setNav({
      left: backBtn(`#/${tab}`, TAB[tab].name), title,
      right: [meta && meta.layout === 'cards' ? focusBtn() : '', html`<button class="nav-btn" id="btn-contents" type="button" aria-label="Contents and highlights">${icon('i-contents')}</button>
              <button class="nav-btn" id="btn-aa" type="button" aria-label="Themes and settings"><span class="aa">Aa</span></button>`]
    });
    navbar.classList.add('show-title');

    render(main, html`<div class="reader"><div class="reader-stage" id="stage"><div class="stage-inner" id="stage-inner">
        <article class="book" id="book" data-page="${tab}/${slug}"></article></div></div>
      <footer class="reader-foot" id="rfoot"><div class="rf-track"><span id="rf-bar"></span></div><span id="rf-left"></span><button class="rf-full" id="btn-full" type="button" aria-label="Full screen" title="Full screen">${icon('i-fullscreen')}</button><span id="rf-right"></span></footer></div>`);
    const book = $('#book');
    book.append(...tpl.childNodes, html`<span class="book-end" id="book-end"></span>`);
    $('#btn-full').addEventListener('click', enterImmersive);

    A.R = { tab, slug, title, minFull, minEss, hasDeep, minutes: hasDeep && settings.depth === 'essentials' ? minEss : minFull, page: 0, pages: 1, W: 0 };
    mountWidgets(book, tab, slug);
    applyHighlights(book);
    bindReader();
    bindVis(tab, slug);
    const saved = m().positions[`${tab}/${slug}`];
    const f = saved && saved.f < 0.98 ? saved.f : 0;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    layout(f);
    if (markExpandable(book) && settings.mode === 'pages') layout(f);
    markWide(book);
    buildRail(book);
    // In scroll layout, layout() restores the position on the next frame; jump to the anchor (or the search match) after it.
    const jump = find ? () => runFind(find) : anchor ? () => goToAnchor(anchor, true) : null;
    if (jump) requestAnimationFrame(jump);
    // Images arrive after the text. Paginated pages are re-laid out; in scroll layout the view is left alone,
    // except that a requested section is jumped to again while the images settle.
    let settle = jump;
    setTimeout(() => { settle = null; }, 2500);
    loadImages(book, debounce(() => {
      if (settings.mode === 'pages') { layout(fraction()); if (settle) settle(); }
      else { if (settle) settle(); updateFoot(); }
      markWide(book);
    }, 120));
  }

  /* ---- interactive blocks (widgets.js): inline in scroll layout, full screen from a card in page layout ---- */
  function widgetCtx(tab, slug, spec) {
    const route = `${tab}/${slug}`;
    return {
      tab, route, data: spec && spec.data !== undefined ? spec.data : null,
      md: t => renderMarkdown(String(t)),
      mdInline: t => A.renderInline(String(t)),
      text: rel => D.text(`${tab}/${String(rel).replace(/^\.\//, '')}`),
      addReview(item) {
        const { practiceState, reviewState } = m();
        const list = practiceState[route] = practiceState[route] || [];
        let h = 7; for (const c of item.q) h = (h * 31 + c.charCodeAt(0)) | 0;
        const id = 'practice-' + Math.abs(h).toString(36);
        if (list.some(x => x.id === id)) return;
        list.push({ id, q: item.q, a: item.a });
        while (list.length > 12) { const old = list.shift(); delete reviewState[`${route}#${old.id}`]; }
        savePractice(); saveReview();
      }
    };
  }
  function mountWidgets(book, tab, slug) {
    if (!window.HVACWidgets) return;
    book.querySelectorAll('.widget').forEach(w => window.HVACWidgets.mount(w.querySelector('.widget-body'), w._spec, widgetCtx(tab, slug, w._spec)));
  }
  function openWidget(w) {
    const R = A.R;
    if (!w || !window.HVACWidgets || !R) return;
    closeViewer();
    const spec = w._spec;
    viewerEl = one(html`<div class="viewer" role="dialog" aria-modal="true"><div class="viewer-bar"><span class="viewer-title">${spec.title || ''}</span><button class="link-btn" type="button" data-close-viewer>Done</button></div>
      <div class="viewer-body book"><div class="widget is-open no-hl"><div class="widget-body"></div></div></div></div>`);
    viewerEl.querySelector('[data-close-viewer]').onclick = closeViewer;
    document.body.appendChild(viewerEl); document.body.classList.add('no-scroll');
    window.HVACWidgets.mount(viewerEl.querySelector('.widget-body'), spec, widgetCtx(R.tab, R.slug, spec));
    viewerEl.querySelector('[data-close-viewer]').focus();
  }

  /* ---- wide tables, formulas and figures open full screen ---- */
  function markExpandable(book) {
    let added = false;
    book.querySelectorAll('.hn-table, .math-display').forEach(w => {
      if (w.previousElementSibling && w.previousElementSibling.classList.contains('xp-bar')) return;
      if (w.scrollWidth <= w.clientWidth + 2) return;
      w.before(html`<div class="xp-bar no-hl"><button class="xp-btn" type="button" data-xp aria-label="Full screen">${icon('i-expand')}</button></div>`);
      added = true;
    });
    book.querySelectorAll('figure:not(.video) img').forEach(img => img.classList.add('xp-img'));
    return added;
  }
  let viewerEl = null;
  function openViewer(el) {
    closeViewer();
    const isImg = el.tagName === 'IMG';
    viewerEl = one(html`<div class="viewer" role="dialog" aria-modal="true"><div class="viewer-bar">${isImg ? html`<button class="nav-btn" type="button" data-z="-1" aria-label="Zoom out">−</button><button class="nav-btn" type="button" data-z="1" aria-label="Zoom in">+</button>` : html`<span></span>`}
      <button class="link-btn" type="button" data-close-viewer>Done</button></div><div class="viewer-body ${isImg ? 'is-img' : 'book'}"></div></div>`);
    const body = viewerEl.querySelector('.viewer-body');
    if (isImg) {
      const img = document.createElement('img'); img.src = el.src; img.alt = el.alt; body.appendChild(img);
      const cap = el.closest('figure') && el.closest('figure').querySelector('figcaption');
      if (cap) body.append(html`<p class="viewer-cap">${cap.textContent}</p>`);
      let z = 1; const zoom = d => { z = clamp(z + d, 1, 4); img.style.width = z === 1 ? '' : (z * 100) + '%'; img.style.maxWidth = z === 1 ? '' : 'none'; };
      viewerEl.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoom(+b.dataset.z));
      img.addEventListener('dblclick', () => zoom(z === 1 ? 1 : -3));
    } else body.appendChild(clone(el));
    viewerEl.querySelector('[data-close-viewer]').onclick = closeViewer;
    document.body.appendChild(viewerEl); document.body.classList.add('no-scroll');
    viewerEl.querySelector('[data-close-viewer]').focus();
  }
  function closeViewer() {
    if (!viewerEl) return false;
    viewerEl.remove(); viewerEl = null;
    if (!sheetOpen && searchEl.hidden) document.body.classList.remove('no-scroll');
    return true;
  }

  /* ---- on-this-page rail beside the text on wide screens ---- */
  let railHeads = [];
  function buildRail(book) {
    const old = $('#toc-rail'); if (old) old.remove();
    const R = A.R;
    railHeads = [...book.querySelectorAll(':scope > h2, :scope > h3')].filter(h => h.id && !h.closest('.page-tail'));
    if (railHeads.length < 3 || root.dataset.layout === 'cards') { railHeads = []; return; }
    $('.reader').appendChild(html`<nav id="toc-rail" class="toc-rail no-hl" aria-label="On this page"><p>On this page</p><ul>${railHeads.map(h => html`<li class="${h.tagName === 'H3' ? 'sub' : ''}"><a href="#/${R.tab}/${R.slug}/${h.id}" data-id="${h.id}">${h.textContent}</a></li>`)}</ul></nav>`);
    updateRail();
  }
  function updateRail() {
    const nav = $('#toc-rail'); if (!nav || !railHeads.length) return;
    const y = navbar.getBoundingClientRect().bottom + 24;
    let cur = railHeads[0];
    for (const h of railHeads) { if (h.getBoundingClientRect().top <= y) cur = h; else break; }
    nav.querySelectorAll('a').forEach(a => a.toggleAttribute('aria-current', a.dataset.id === cur.id));
  }

  function fraction() {
    const R = A.R;
    if (!R) return 0;
    if (settings.mode === 'pages') return R.pages > 1 ? R.page / (R.pages - 1) : 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? scrollY / max : 0;
  }

  function layout(f) {
    const book = $('#book'), R = A.R; if (!book || !R) return;
    if (settings.mode !== 'pages') {
      root.classList.remove('pages-mode', 'chrome-hidden');
      ['width', 'left', 'height', 'columnWidth', 'columnGap', 'transition', 'transform'].forEach(p => { book.style[p] = ''; });
      book.style.removeProperty('--stage-h');
      R.pages = 1;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        window.scrollTo(0, Math.max(0, f * max));
        updateFoot();
      });
      return;
    }
    root.classList.add('pages-mode');
    window.scrollTo(0, 0);
    const inner = $('#stage-inner'), W = inner.clientWidth, H = inner.clientHeight, M = W < 520 ? 22 : 48;
    Object.assign(book.style, { width: (W - 2 * M) + 'px', left: M + 'px', height: H + 'px', columnWidth: (W - 2 * M) + 'px', columnGap: (2 * M) + 'px', transition: 'none', transform: 'translate3d(0,0,0)' });
    book.style.setProperty('--stage-h', H + 'px');
    R.W = W;
    const pr = book.getBoundingClientRect(), er = $('#book-end').getBoundingClientRect();
    R.pages = Math.max(1, Math.floor((er.left - pr.left + 1) / W) + 1);
    goTo(Math.round(f * (R.pages - 1)), false);
  }

  function goTo(p, animate = true) {
    const book = $('#book'), R = A.R; if (!book || !R) return;
    R.page = clamp(p, 0, R.pages - 1);
    book.style.transition = animate && !reduced() ? '' : 'none';
    book.style.transform = `translate3d(${-R.page * R.W}px,0,0)`;
    updateFoot(); savePos();
  }

  function updateFoot() {
    const R = A.R;
    if (!R) return;
    const left = $('#rf-left'), right = $('#rf-right'), bar = $('#rf-bar'); if (!left) return;
    let done;
    if (settings.mode === 'pages') { done = (R.page + 1) / R.pages; left.textContent = `${R.page + 1} of ${R.pages}`; }
    else { done = fraction(); left.textContent = `${Math.round(done * 100)}%`; }
    const mn = Math.ceil(R.minutes * (1 - done));
    right.textContent = mn > 0 ? `${mn} min left` : '';
    bar.style.width = (done * 100).toFixed(1) + '%';
  }

  // Reading position: kept in memory at once, sent to the database a moment later (and when the page is left).
  const savePos = debounce(() => {
    const R = A.R;
    if (!R) return;
    const f = settings.mode === 'pages' ? (R.pages > 1 ? R.page / (R.pages - 1) : 1) : (document.documentElement.scrollHeight - innerHeight > 0 ? fraction() : 1);
    const route = `${R.tab}/${R.slug}`;
    m().positions[route] = { f, t: Date.now(), title: R.title };
    D.save.position(route);
  }, 300);

  function pageIndexOf(el) {
    const book = $('#book');
    return Math.max(0, Math.floor((el.getBoundingClientRect().left - book.getBoundingClientRect().left + 2) / A.R.W));
  }
  function goToEl(el, instant) {
    if (settings.mode === 'pages') goTo(pageIndexOf(el), !instant);
    else el.scrollIntoView({ block: 'start', behavior: instant || reduced() ? 'auto' : 'smooth' });
  }
  /* ---- full-screen reading: no app bars, the device's own bars hidden where the browser allows,
          and the screen kept awake where the browser allows ---- */
  let wakeLock = null, immUiT = 0;
  const immersive = () => root.classList.contains('immersive');
  async function keepAwake() {
    if (!('wakeLock' in navigator) || !immersive() || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
  }
  function enterImmersive() {
    if (!A.R || immersive()) return;
    const f = fraction();
    root.classList.add('immersive'); root.classList.remove('chrome-hidden');
    const el = document.documentElement;
    const fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fs) { try { const r = fs.call(el, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => { }); } catch (e) { /* not allowed here */ } }
    keepAwake();
    if (!$('#imm-ui')) document.body.append(html`<div class="imm-ui" id="imm-ui" aria-hidden="true"><span id="imm-pos"></span><button type="button" id="imm-exit" aria-label="Exit full screen">${icon('i-close')}</button></div>`);
    $('#imm-exit').onclick = exitImmersive;
    requestAnimationFrame(() => layout(f));
    showImmUi();
  }
  function exitImmersive() {
    if (!immersive()) return;
    const f = fraction();
    root.classList.remove('immersive', 'imm-show');
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { const x = d.exitFullscreen || d.webkitExitFullscreen; try { const r = x.call(d); if (r && r.catch) r.catch(() => { }); } catch (e) { /* already out */ } }
    if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
    if (A.R) requestAnimationFrame(() => layout(f));
  }
  // A tap on the page (not a link or control) shows the exit button and position for a few seconds.
  function showImmUi() {
    const ui = $('#imm-ui'); if (!ui) return;
    const l = $('#rf-left'), r = $('#rf-right');
    $('#imm-pos').textContent = [l && l.textContent, r && r.textContent].filter(Boolean).join(' · ');
    root.classList.add('imm-show'); ui.setAttribute('aria-hidden', 'false');
    clearTimeout(immUiT); immUiT = setTimeout(() => { root.classList.remove('imm-show'); ui.setAttribute('aria-hidden', 'true'); }, 3000);
  }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
    // Leaving the device's full screen (back gesture, Esc) leaves full-screen reading too.
    if (!(document.fullscreenElement || document.webkitFullscreenElement) && immersive()) exitImmersive();
  }));
  document.addEventListener('visibilitychange', () => { if (immersive() && !wakeLock) keepAwake(); });

  /* ---- Essentials | Full ---- */
  function setDepth(d) {
    const f = fraction(), R = A.R;
    settings.depth = d === 'essentials' ? 'essentials' : 'full'; applySettings();
    document.querySelectorAll('.depth-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.depthSet === settings.depth));
    if (R) { R.minutes = R.hasDeep && settings.depth === 'essentials' ? R.minEss : R.minFull; requestAnimationFrame(() => layout(f)); }
  }
  function openDeep(group) {
    const book = $('#book'); if (!book) return false;
    const els = book.querySelectorAll(`[data-deep-of="${CSS.escape(group)}"]`);
    if (!els.length) return false;
    els.forEach(e => e.classList.add('deep-open'));
    const chip = book.querySelector(`[data-deep-open="${CSS.escape(group)}"]`); if (chip) chip.classList.add('deep-open');
    if (settings.mode === 'pages') layout(fraction());
    return true;
  }

  function goToAnchor(anchor, instant) {
    const book = $('#book'); if (!book) return;
    // A link into a deeper section opens it first when Essentials hides it.
    const target = !anchor.startsWith('hl-') && book.querySelector('#' + CSS.escape(anchor));
    const inDeep = target ? target.closest('[data-deep-of]') || (target.dataset && target.dataset.deepOf ? target : null) : null;
    if (inDeep && settings.depth === 'essentials') openDeep(inDeep.dataset.deepOf);
    if (anchor.startsWith('hl-')) {
      const marks = book.querySelectorAll(`mark.hl[data-hl="${CSS.escape(anchor.slice(3))}"]`);
      const d0 = marks[0] && marks[0].closest('[data-deep-of]');
      if (d0 && settings.depth === 'essentials') openDeep(d0.dataset.deepOf);
      if (marks.length) { goToEl(marks[0], instant); marks.forEach(mk => { mk.classList.remove('flash'); void mk.offsetWidth; mk.classList.add('flash'); }); }
      return;
    }
    const el = book.querySelector('#' + CSS.escape(anchor)) || nearestHeading(book, anchor);
    if (el) {
      const d = el.closest('[data-deep-of]') || (el.dataset.deepOf ? el : null);
      if (d && settings.depth === 'essentials') openDeep(d.dataset.deepOf);
      goToEl(el, instant);
    }
  }
  // For a section id that has gone (a heading was renamed): the heading whose id shares the most words.
  function nearestHeading(book, anchor) {
    const want = new Set(anchor.split('-').filter(w => w.length > 1));
    let best = null, score = 0;
    book.querySelectorAll('h2[id], h3[id], h4[id]').forEach(h => {
      const have = h.id.split('-').filter(w => w.length > 1), common = have.filter(w => want.has(w)).length;
      const s = common / (want.size + have.length - common || 1);
      if (s > score) { score = s; best = h; }
    });
    return score >= 0.34 ? best : null;
  }

  /* ---- search: open a result at the paragraph that matched, briefly marked ---- */
  let FIND = null;
  function runFind(find) {
    const book = $('#book'); if (!book) return;
    const head = find.id ? book.querySelector('#' + CSS.escape(find.id)) : null;
    const alts = [...new Set(find.alts)].filter(Boolean).sort((a, b) => b.length - a.length);
    const BLOCK = 'p, li, td, th, dd, figcaption, h2, h3, h4, .kcard, aside, details';
    const w = document.createTreeWalker(book, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let on = !head, node, hit = null, best = 0;
    const score = new Map();                         // block → the query words it holds
    while ((node = w.nextNode())) {
      if (node.nodeType === 1) {
        if (node === head) { on = true; continue; }
        if (on && /^H[2-4]$/.test(node.tagName) && (head || node.tagName === 'H2')) break;
        continue;
      }
      if (!on || !node.parentElement || node.parentElement.closest('.no-hl, .katex')) continue;
      const low = node.data.toLowerCase(), found = alts.filter(x => low.includes(x));
      if (!found.length) continue;
      const blk = node.parentElement.closest(BLOCK) || node.parentElement;
      const set = score.get(blk) || new Set(); found.forEach(x => set.add(x)); score.set(blk, set);
      if (set.size > best) { best = set.size; hit = { node, block: blk }; }
    }
    if (!hit) { if (head) goToEl(head, true); return; }
    const block = hit.block;
    const d = block.closest('[data-deep-of]'); if (d && settings.depth === 'essentials') openDeep(d.dataset.deepOf);
    if (block.closest('details') && !block.closest('details').open) block.closest('details').open = true;
    if (settings.mode === 'pages') goTo(pageIndexOf(block), false);
    else block.scrollIntoView({ block: 'center' });
    if (find.shown) return;
    find.shown = true;
    if (window.CSS && CSS.highlights && window.Highlight) {
      const ranges = [];
      const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let t; while ((t = tw.nextNode())) {
        if (t.parentElement.closest('.no-hl, .katex')) continue;
        const low = t.data.toLowerCase();
        for (const a of alts) { let k = low.indexOf(a); while (k >= 0) { const r = document.createRange(); r.setStart(t, k); r.setEnd(t, k + a.length); ranges.push(r); k = low.indexOf(a, k + a.length); } }
      }
      CSS.highlights.set('find', new Highlight(...ranges));
      setTimeout(() => CSS.highlights.delete('find'), 4000);
    } else { block.classList.remove('find-flash'); void block.offsetWidth; block.classList.add('find-flash'); }
  }

  const hasSelection = () => { const s = getSelection(); return s && !s.isCollapsed && s.toString().trim().length > 0; };

  function bindReader() {
    const stage = $('#stage'), book = $('#book');
    // Opening an answer changes the length of a paginated page.
    book.addEventListener('toggle', e => {
      if (settings.mode !== 'pages' || !e.target.matches('details')) return;
      layout(fraction()); goTo(pageIndexOf(e.target), false);
    }, true);
    let sx = null, sy = 0, st = 0, drag = false;
    stage.addEventListener('touchstart', e => {
      sx = null;
      if (settings.mode !== 'pages' || e.touches.length > 1 || hasSelection()) return;
      const sc = e.target.closest('.hn-table, .math-display, pre');
      if (sc && sc.scrollWidth > sc.clientWidth + 2) return;
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); drag = false;
    }, { passive: true });
    stage.addEventListener('touchmove', e => {
      if (sx == null) return;
      const R = A.R, t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!drag) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { drag = true; book.style.transition = 'none'; }
        else if (Math.abs(dy) > 12) { sx = null; return; }
      }
      if (drag) {
        e.preventDefault();
        const edge = (R.page === 0 && dx > 0) || (R.page === R.pages - 1 && dx < 0);
        book.style.transform = `translate3d(${-R.page * R.W + (edge ? dx / 3 : dx)}px,0,0)`;
      }
    }, { passive: false });
    stage.addEventListener('touchend', e => {
      if (sx == null || !drag) { sx = null; return; }
      const R = A.R, dx = e.changedTouches[0].clientX - sx, v = Math.abs(dx) / Math.max(1, Date.now() - st);
      suppressClick = Date.now();
      if (dx < -R.W * 0.2 || (dx < -30 && v > 0.35)) goTo(R.page + 1);
      else if (dx > R.W * 0.2 || (dx > 30 && v > 0.35)) goTo(R.page - 1);
      else goTo(R.page);
      sx = null; drag = false;
    });
    stage.addEventListener('click', e => {
      if (Date.now() - suppressClick < 400) return;
      if (peekLink(e)) return;
      const mk = e.target.closest('mark.hl');
      if (mk && !hasSelection()) { openHighlight(mk.dataset.hl); return; }
      const dp = e.target.closest('[data-depth-set]');
      if (dp) { setDepth(dp.dataset.depthSet); return; }
      const chip = e.target.closest('[data-deep-open]');
      if (chip) { openDeep(chip.dataset.deepOpen); return; }
      const xp = e.target.closest('[data-xp]');
      if (xp) { const w = xp.parentElement.nextElementSibling; if (w) openViewer(w); return; }
      const xi = e.target.closest('img.xp-img');
      if (xi && !hasSelection()) { openViewer(xi); return; }
      const kc = e.target.closest('.kcard-edit, .kcard-note');
      if (kc) { focusCard(kc.closest('.kcard')); return; }
      const sn = e.target.closest('[data-sol-next], [data-sol-all]');
      if (sn) {
        const a = sn.closest('.sol'), hidden = [...a.querySelectorAll('.sol-step:not(.shown)')];
        (sn.hasAttribute('data-sol-all') ? hidden : hidden.slice(0, 1)).forEach(x => x.classList.add('shown'));
        const all = a.querySelectorAll('.sol-step').length, shown = a.querySelectorAll('.sol-step.shown').length;
        a.querySelector('.sol-count').textContent = `${shown} of ${all}`;
        if (shown === all) a.classList.add('sol-done');
        return;
      }
      const wo = e.target.closest('[data-widget-open]');
      if (wo) { openWidget(wo.closest('.widget')); return; }
      if (hasSelection() || e.target.closest('a, button, input, textarea, summary, .video, .hn-table, .math-display, pre, .widget')) return;
      if (settings.mode !== 'pages') { if (immersive()) showImmUi(); return; }
      const R = A.R, r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < 0.3) goTo(R.page - 1); else if (x > 0.7) goTo(R.page + 1); else if (immersive()) showImmUi(); else root.classList.toggle('chrome-hidden');
    });
  }

  /* ================= highlights ================= */

  function textIndex(el) {
    const nodes = []; let text = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement && n.parentElement.closest('.katex, .no-hl, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let n; while ((n = w.nextNode())) { nodes.push({ n, s: text.length }); text += n.data; }
    return { nodes, text };
  }

  function quoteFromRange(el, range) {
    const { nodes, text } = textIndex(el);
    let s = null, e = null;
    for (const { n, s: base } of nodes) {
      if (!range.intersectsNode(n)) continue;
      const a = n === range.startContainer ? range.startOffset : 0;
      const b = n === range.endContainer ? range.endOffset : n.data.length;
      if (s === null) s = base + a;
      e = base + b;
    }
    if (s === null || e <= s) return null;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e <= s) return null;
    return { start: s, end: e, exact: text.slice(s, e), prefix: text.slice(Math.max(0, s - 40), s), suffix: text.slice(e, e + 40) };
  }

  // Re-find a highlight by its text and surrounding context, so it survives edits to the page.
  function locate(q, text) {
    const L = q.exact.length; let best = -1, bestScore = -1, i = text.indexOf(q.exact), guard = 0;
    while (i !== -1 && guard++ < 300) {
      let sc = 0;
      const pre = text.slice(Math.max(0, i - q.prefix.length), i);
      for (let k = 1; k <= Math.min(pre.length, q.prefix.length) && pre[pre.length - k] === q.prefix[q.prefix.length - k]; k++) sc++;
      const suf = text.slice(i + L, i + L + q.suffix.length);
      for (let k = 0; k < Math.min(suf.length, q.suffix.length) && suf[k] === q.suffix[k]; k++) sc++;
      if (sc > bestScore) { bestScore = sc; best = i; }
      i = text.indexOf(q.exact, i + 1);
    }
    return best < 0 ? null : { start: best, end: best + L };
  }

  function wrapSpan(el, s, e, h, isNew, other) {
    const { nodes } = textIndex(el), segs = [];
    for (const { n, s: base } of nodes) {
      const len = n.data.length;
      if (base + len <= s || base >= e) continue;
      const a = Math.max(0, s - base), b = Math.min(len, e - base);
      if (b > a && n.data.slice(a, b).trim()) segs.push({ n, a, b });
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      let { n, a, b } = segs[i];
      if (b < n.data.length) n.splitText(b);
      if (a > 0) n = n.splitText(a);
      const mk = document.createElement('mark');
      mk.className = 'hl' + (other ? ' other' : '') + (h.note ? ' has-note' : '') + (isNew ? ' new' : '');
      mk.dataset.hl = h.id; mk.dataset.c = h.color;
      const rc = replyCount('highlight', h.id); if (rc && i === segs.length - 1) mk.dataset.replies = rc;
      n.parentNode.insertBefore(mk, n); mk.appendChild(n);
    }
  }

  // Everyone else's highlights first (a faint tint), then the reader's own on top.
  function applyOthers(book) {
    const R = A.R; if (!R || !othersOn()) return;
    const list = D.shared.highlights.filter(h => h.tab === R.tab && h.slug === R.slug);
    if (!list.length) return;
    const { text } = textIndex(book);
    list.forEach(h => { const loc = locate(h.quote, text); if (loc) wrapSpan(book, loc.start, loc.end, h, false, true); });
  }
  function applyHighlights(book) {
    const R = A.R;
    applyOthers(book);
    const mine = m().highlights.filter(h => h.tab === R.tab && h.slug === R.slug);
    if (!mine.length) return;
    const { text } = textIndex(book);
    mine.forEach(h => { const loc = locate(h.quote, text); if (loc) wrapSpan(book, loc.start, loc.end, h, false); });
  }

  function unwrapMarks(list) {
    list.forEach(mk => {
      const p = mk.parentNode; if (!p) return;
      while (mk.firstChild) p.insertBefore(mk.firstChild, mk);
      p.removeChild(mk); p.normalize();
    });
  }
  const unwrap = id => unwrapMarks(document.querySelectorAll(`mark.hl[data-hl="${CSS.escape(id)}"]`));

  // Everyone else's notes changed (reloaded, removed, shown or hidden): redraw them where they appear.
  function refreshOthers() {
    const book = $('#book');
    if (book && A.R) {
      const f = settings.mode === 'pages' ? fraction() : null;
      unwrapMarks([...book.querySelectorAll('mark.hl')]);
      applyHighlights(book);
      book.querySelectorAll('.kcard').forEach(paintCard);
      if (f != null) layout(f);
    }
    if (where.view === 'notebook') viewNotebook(nbTab);
    if (where.view === 'discussions') viewDiscussions();
  }

  function createHighlight(range, color) {
    const book = $('#book'), R = A.R; if (!book || !R) return null;
    const q = quoteFromRange(book, range); if (!q) return null;
    const h = { id: uid(), tab: R.tab, slug: R.slug, title: R.title, color, note: '', quote: { exact: q.exact.slice(0, 5000), prefix: q.prefix, suffix: q.suffix }, created: new Date().toISOString() };
    m().highlights.push(h); D.save.highlight(h);
    wrapSpan(book, q.start, q.end, h, true);
    renderSidebar();
    return h;
  }

  // Selection toolbar
  let lastRange = null;
  render(hlBar, COLORS.map(c => html`<button class="swatch" type="button" data-c="${c}" aria-label="Highlight ${c}"></button>`),
    html`<span class="hl-sep" aria-hidden="true"></span>
     <button class="hl-act" type="button" data-act="note">${icon('i-note')}<span>Note</span></button>
     <button class="hl-act" type="button" data-act="copy">${icon('i-copy')}<span>Copy</span></button>`);
  hlBar.addEventListener('mousedown', e => e.preventDefault());
  hlBar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !lastRange) return;
    const range = lastRange, R = A.R;
    if (b.dataset.c) createHighlight(range, b.dataset.c);
    else if (b.dataset.act === 'note') { const h = createHighlight(range, 'yellow'); if (h) setTimeout(() => openHighlight(h.id, true), 60); }
    else if (b.dataset.act === 'copy') copyText(`“${range.toString().trim()}”\n— ${R ? R.title : SITE}, ${SITE}`);
    lastRange = null; hlBar.hidden = true;
    try { getSelection().removeAllRanges(); } catch (er) { /* nothing selected */ }
  });
  document.addEventListener('selectionchange', debounce(() => {
    const book = $('#book'), sel = getSelection();
    if (!book || root.dataset.view !== 'reader' || !sel || sel.isCollapsed || !sel.rangeCount) { hlBar.hidden = true; return; }
    const r = sel.getRangeAt(0);
    if (!book.contains(r.commonAncestorContainer) || !r.toString().trim()) { hlBar.hidden = true; return; }
    lastRange = r.cloneRange(); hlBar.hidden = false;
    // Touch screens keep the colours at the top (the phone's own search panel takes the bottom);
    // if the selection itself is up there, the colours sit just under it instead.
    hlBar.style.top = '';
    if (matchMedia('(pointer: coarse)').matches) {
      const sr = r.getBoundingClientRect(), bar = hlBar.getBoundingClientRect();
      if (sr.top < bar.bottom + 8) hlBar.style.top = Math.min(sr.bottom + 44, innerHeight * 0.55) + 'px';
    }
  }, 120));

  // The reply count on a highlight's mark, after a reply was added or removed.
  function refreshMark(id) {
    const marks = [...document.querySelectorAll(`mark.hl[data-hl="${CSS.escape(id)}"]`)];
    marks.forEach(mk => delete mk.dataset.replies);
    const n = replyCount('highlight', id);
    if (n && marks.length) marks[marks.length - 1].dataset.replies = n;
    renderSidebar();
  }
  function openOtherHighlight(h) {
    openSheet(html`<div class="sheet-head"><span></span><h2>Highlight</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <p class="sheet-by">${noteBy(h.by, h.updated || h.created)}</p>
      <blockquote class="sheet-quote" data-c="${h.color}">${h.quote.exact}</blockquote>
      ${h.note ? html`<p class="note-text other-text">${h.note}</p>` : ''}
      <div class="sheet-actions"><button class="btn" type="button" data-act="copy">${icon('i-copy')}Copy</button>
      ${canPublish() ? html`<button class="btn danger" type="button" data-act="remove">${icon('i-trash')}Remove</button>` : ''}</div>
      <p class="sheet-sec">Replies</p>${thread('highlight', h.id, () => refreshMark(h.id))}`, body => {
      body.querySelector('[data-act="copy"]').onclick = () => copyText(`“${h.quote.exact}”${h.note ? `\nNote (${h.by}): ${h.note}` : ''}\n— ${h.title}, ${SITE}`);
      const rm = body.querySelector('[data-act="remove"]');
      if (rm) rm.onclick = async () => {
        if (!await Core.confirm(`Remove ${h.by}'s highlight${h.note ? ' and note' : ''}? This cannot be undone.`, { ok: 'Remove', danger: true })) return;
        try { await D.remove.highlight(h.id); } catch (err) { Core.showError(err); return; }
        unwrap(h.id); closeSheet(); toast('Highlight removed');
        if (where.view === 'notebook') viewNotebook(nbTab);
      };
    });
  }

  function openHighlight(id, focusNote) {
    const h = m().highlights.find(x => x.id === id);
    if (!h) { const o = D.shared.highlights.find(x => x.id === id); if (o) openOtherHighlight(o); return; }
    openSheet(html`<div class="sheet-head"><span></span><h2>Highlight</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <blockquote class="sheet-quote" id="hq" data-c="${h.color}">${h.quote.exact}</blockquote>
      <div class="sheet-swatches" role="group" aria-label="Colour">${COLORS.map(c => html`<button class="swatch" type="button" data-c="${c}" aria-pressed="${c === h.color}" aria-label="${c}"></button>`)}</div>
      <textarea class="note-input" id="note-input" placeholder="Note" aria-label="Note"></textarea>
      <p class="sheet-hint">Your highlight and note are seen by everyone with HVAC Notes.</p>
      <div class="sheet-actions"><button class="btn" type="button" data-act="copy">${icon('i-copy')}Copy</button>
      <button class="btn danger" type="button" data-act="delete">${icon('i-trash')}Delete</button></div>
      <p class="sheet-sec">Replies</p>${thread('highlight', h.id, () => refreshMark(h.id))}`, body => {
      const marks = () => document.querySelectorAll(`mark.hl[data-hl="${CSS.escape(id)}"]`);
      body.querySelectorAll('.swatch').forEach(b => b.onclick = () => {
        h.color = b.dataset.c; D.save.highlight(h);
        body.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', x === b));
        $('#hq').dataset.c = h.color;
        marks().forEach(mk => { mk.dataset.c = h.color; });
      });
      const note = $('#note-input');
      note.value = h.note || '';
      note.oninput = debounce(() => {
        h.note = note.value.trim().slice(0, 5000); h.updated = new Date().toISOString(); D.save.highlight(h, 500);
        marks().forEach(mk => mk.classList.toggle('has-note', !!h.note));
      }, 250);
      body.querySelector('[data-act="copy"]').onclick = () => copyText(`“${h.quote.exact}”${h.note ? `\nNote: ${h.note}` : ''}\n— ${h.title}, ${SITE}`);
      body.querySelector('[data-act="delete"]').onclick = () => {
        const list = m().highlights, k = list.indexOf(h); if (k >= 0) list.splice(k, 1);
        D.save.highlightDelete(id).catch(err => Core.showError(err));
        unwrap(id); closeSheet(); renderSidebar(); toast('Highlight deleted');
        if (where.view === 'notebook') viewNotebook(nbTab);
      };
      if (focusNote) setTimeout(() => note.focus(), 350);
    });
  }

  /* ================= sheets ================= */

  let sheetOpen = false;
  function openSheet(content, bind) {
    render(sheetBody, content);
    sheet.classList.remove('out'); backdrop.classList.remove('out');
    sheet.hidden = false; backdrop.hidden = false; sheetOpen = true;
    document.body.classList.add('no-scroll');
    sheetBody.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeSheet());
    if (bind) bind(sheetBody);
  }
  function closeSheet(instant) {
    if (!sheetOpen) return;
    sheetOpen = false; document.body.classList.remove('no-scroll');
    if (instant || reduced()) { sheet.hidden = true; backdrop.hidden = true; return; }
    sheet.classList.add('out'); backdrop.classList.add('out');
    setTimeout(() => { if (!sheetOpen) { sheet.hidden = true; backdrop.hidden = true; } }, 290);
  }
  backdrop.addEventListener('click', () => closeSheet());
  // drag the sheet down to dismiss
  (function () {
    let y0 = null;
    sheet.addEventListener('touchstart', e => { y0 = (sheetBody.scrollTop <= 0 && e.target.closest('.sheet-grabber, .sheet-head')) ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheet.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; sheet.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; });
  })();

  function openContents() {
    const book = $('#book'), R = A.R; if (!book) return;
    const hs = [...book.querySelectorAll('h2, h3')];
    const seenIds = new Set(), mine = [];
    book.querySelectorAll('mark.hl').forEach(mk => {
      if (seenIds.has(mk.dataset.hl)) return;
      seenIds.add(mk.dataset.hl);
      const own = m().highlights.find(x => x.id === mk.dataset.hl);
      const h = own ? { ...own, by: 'You' } : D.shared.highlights.find(x => x.id === mk.dataset.hl);
      if (h) mine.push(h);
    });
    const pg = el => settings.mode === 'pages' ? html`<span class="row-value">${pageIndexOf(el) + 1}</span>` : '';
    const contents = hs.length ? html`<div class="group">${hs.map(h => html`<button class="hn-row toc-row ${h.tagName === 'H3' ? 'sub' : ''}" type="button" data-go="${h.id}">
        <span class="row-main"><span class="row-title">${h.textContent}</span></span>${pg(h)}</button>`)}</div>` : html`<div class="empty">No Sections</div>`;
    const hls = mine.length ? html`<div class="group">${mine.map(h => html`<button class="nb-item hn-row block" type="button" data-hl="${h.id}" data-c="${h.color}">
        <div class="nb-quote">${h.quote.exact}</div>${h.note ? html`<div class="nb-note">${icon('i-note')}<span>${h.note}</span></div>` : ''}
        <div class="nb-date">${h.by} · ${fmtDate(h.created || h.updated)}${replyCount('highlight', h.id) ? ` · ${plural(replyCount('highlight', h.id), 'reply', 'replies')}` : ''}</div></button>`)}</div>` : html`<div class="empty">No Highlights</div>`;
    openSheet(html`<div class="sheet-head"><span></span><h2>${R.title}</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="seg gap-b" id="seg-pane"><button type="button" data-v="c" aria-pressed="true">Contents</button><button type="button" data-v="h" aria-pressed="false">Highlights${mine.length ? ` (${mine.length})` : ''}</button></div>
      <div id="pane-c">${contents}</div><div id="pane-h" hidden>${hls}</div>`, body => {
      body.querySelectorAll('#seg-pane button').forEach(b => b.onclick = () => {
        body.querySelectorAll('#seg-pane button').forEach(x => x.setAttribute('aria-pressed', x === b));
        $('#pane-c').hidden = b.dataset.v !== 'c'; $('#pane-h').hidden = b.dataset.v !== 'h';
      });
      body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeSheet(true); goToAnchor(b.dataset.go); });
      body.querySelectorAll('[data-hl]').forEach(b => b.onclick = () => { closeSheet(true); goToAnchor('hl-' + b.dataset.hl); });
    });
  }

  function openSettings() {
    const segBtn = (v, label, cur, cls) => html`<button type="button" class="${cls || ''}" data-v="${v}" aria-pressed="${v === cur}">${label}</button>`;
    openSheet(html`<div class="sheet-head"><span></span><h2>Themes &amp; Settings</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="size-ctl"><button class="smaller" type="button" data-step="-1" aria-label="Smaller text">A</button><output id="size-out">${settings.size} pt</output><button class="larger" type="button" data-step="1" aria-label="Larger text">A</button></div>
      <p class="sheet-sec">Font</p><div class="seg" id="seg-font">${segBtn('serif', 'Serif', settings.font, 'f-serif')}${segBtn('sans', 'Sans', settings.font, 'f-sans')}</div>
      <p class="sheet-sec">Page</p><div class="themes" id="themes">${THEMES.map(t => html`<button class="theme-btn" type="button" data-v="${t.id}" aria-pressed="${t.id === settings.paper}"><span class="tsw tsw-${t.id}">Aa</span>${t.name}</button>`)}</div>
      <p class="sheet-sec">Layout</p><div class="seg" id="seg-mode">${segBtn('pages', 'Pages', settings.mode)}${segBtn('scroll', 'Scroll', settings.mode)}</div>
      <p class="sheet-sec">Others' highlights &amp; notes</p><div class="seg" id="seg-others">${segBtn('show', 'Show', settings.others)}${segBtn('hide', 'Hide', settings.others)}</div>
      <p class="sheet-note">Auto follows the site's day and night setting (the Night / Day button at the top).</p>`, body => {
      const relayout = () => { const f = fraction(); applySettings(); if (A.R) requestAnimationFrame(() => layout(f)); };
      body.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
        const i = SIZES.indexOf(settings.size), j = clamp((i < 0 ? 3 : i) + +b.dataset.step, 0, SIZES.length - 1);
        settings.size = SIZES[j]; $('#size-out').textContent = settings.size + ' pt'; relayout();
      });
      const seg = (sel, keyName, after) => body.querySelectorAll(sel + ' button').forEach(b => b.onclick = () => {
        settings[keyName] = b.dataset.v;
        body.querySelectorAll(sel + ' button').forEach(x => x.setAttribute('aria-pressed', x === b));
        after();
      });
      seg('#seg-font', 'font', relayout);
      seg('#themes', 'paper', applySettings);
      seg('#seg-mode', 'mode', relayout);
      seg('#seg-others', 'others', () => { saveView(); refreshOthers(); renderSidebar(); });
    });
  }

  function notebookMarkdown() {
    const name = TAB[nbTab] ? TAB[nbTab].name : 'All notebooks';
    const lines = [`# ${SITE} · ${name}: highlights and notes`, '', `Exported ${fmtDate(new Date().toISOString())}`, ''];
    const order = TABS.map(t => t.id);
    const items = TAB[nbTab] ? notebookItems(nbTab) : null;
    const sorted = (items ? items.hl : [...m().highlights]).sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab) || (a.slug + a.created).localeCompare(b.slug + b.created));
    let cur = '';
    sorted.forEach(h => {
      const k = h.tab + '/' + h.slug;
      if (k !== cur) { cur = k; lines.push(`## ${TAB[h.tab] ? TAB[h.tab].name : h.tab}: ${h.title} (#/${k})`, ''); }
      lines.push(`> ${h.quote.exact.replace(/\n+/g, ' ')}`);
      if (items && items.all) lines.push('', `— ${h.by}`);
      if (h.note) lines.push('', `Note: ${h.note}`);
      lines.push('');
    });
    const cards = items ? items.cards : Object.entries(m().cardState).filter(([, v]) => v.note).map(([key, v]) => ({ key, ...v }));
    cards.sort((a, b) => a.key.localeCompare(b.key)).forEach(c => {
      lines.push(`## Card: ${c.title} (#/${c.key})`, '', `Note${items && items.all ? ` (${c.by})` : ''}: ${c.note}`, '');
    });
    return lines.join('\n');
  }

  function openExport() {
    const canShare = !!navigator.share;
    openSheet(html`<div class="sheet-head"><span></span><h2>Export</h2><button class="link-btn" type="button" data-close>Done</button></div>
      <div class="group">
        <button class="hn-row with-icon" type="button" data-act="copy"><span class="icon-tile">${icon('i-copy')}</span><span class="row-main"><span class="row-title">Copy as Text</span></span></button>
        ${canShare ? html`<button class="hn-row with-icon" type="button" data-act="share"><span class="icon-tile">${icon('i-share')}</span><span class="row-main"><span class="row-title">Share</span></span></button>` : ''}
      </div>
      <div class="group gap-t">
        <button class="hn-row with-icon" type="button" data-act="backup"><span class="icon-tile it-terms">${icon('i-download')}</span><span class="row-main"><span class="row-title">Back Up</span><span class="row-sub">Your highlights, card notes and reading positions, as a file</span></span></button>
        <label class="hn-row with-icon"><span class="icon-tile it-terms">${icon('i-library')}</span><span class="row-main"><span class="row-title">Restore</span><span class="row-sub">Adds what a backup file has and you do not, including one from the old site</span></span><input type="file" accept="application/json,.json" hidden id="restore"></label>
      </div>`, body => {
      body.querySelector('[data-act="copy"]').onclick = () => copyText(notebookMarkdown());
      const sh = body.querySelector('[data-act="share"]');
      if (sh) sh.onclick = () => navigator.share({ title: `${SITE} ${TAB[nbTab] ? TAB[nbTab].name + ' ' : ''}highlights`, text: notebookMarkdown() }).catch(() => { });
      body.querySelector('[data-act="backup"]').onclick = () => {
        const { highlights, positions, cardState } = m();
        const cards = {}; Object.entries(cardState).forEach(([k, v]) => { cards[k] = { title: v.title, color: v.color, note: v.note, updated: v.updated }; });
        const blob = new Blob([JSON.stringify({ v: 1, highlights, positions, cards }, null, 2)], { type: 'application/json' });
        Core.download(`hvac-notes-backup-${new Date().toISOString().slice(0, 10)}.json`, blob);
      };
      $('#restore').onchange = async e => {
        try {
          const data = JSON.parse(await e.target.files[0].text());
          const n = await D.importBackup({ highlights: data.highlights || [], cards: data.cards || {}, positions: data.positions || {} });
          await D.flush(); await D.loadMine(); A.bindMine();
          closeSheet(); toast(`Restored: ${n.highlights} highlights, ${n.cards} card notes, ${n.positions} positions`); route();
        } catch (er) { if (er && er.code) Core.showError(er); else toast('Could not restore: the file is not a backup'); }
      };
    });
  }


  /* ================= search ================= */

  const searchEl = $('#search'), searchInput = $('#search-input'), results = $('#search-results');
  let index = null, sel = -1;

  // Search entries from the index: one per page (title, summary, keywords, intro) and one per section.
  function entriesFrom(idx) {
    const out = [];
    idx.pages.forEach(p => p.sections.forEach(sec => {
      if (sec.heading && /^sources$/i.test(sec.heading)) return;
      const page = !sec.heading;
      out.push({
        tab: p.tab, slug: p.slug, title: p.title, heading: sec.heading, id: sec.id, card: p.layout === 'cards',
        t: p.title.toLowerCase(), h: (sec.heading || '').toLowerCase(),
        k: page ? `${p.summary} ${p.keywords.join(' ')}`.toLowerCase() : '', body: sec.text || '', b: (sec.text || '').toLowerCase()
      });
    }));
    return out;
  }
  function snippet(body, terms) {
    const low = body.toLowerCase();
    const at = Math.min(...terms.map(t => low.indexOf(t)).filter(i => i >= 0));
    if (!isFinite(at)) return '';
    const a = Math.max(0, body.lastIndexOf(' ', Math.max(0, at - 50)) + 1), b = Math.min(body.length, at + 110);
    return (a > 0 ? '… ' : '') + body.slice(a, b).trim() + (b < body.length ? ' …' : '');
  }
  // Names that mean the same thing, from the term cards ("FAHU (fresh air handling unit)") and from the text
  // ("chilled water (CHW)", "VFD (variable frequency drive)"): searching one finds the others.
  let SYN = new Map();
  const MINOR = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'on', 'a', 'an', '&']);
  function initialsFit(phrase, abbr) {
    const ws = phrase.toLowerCase().split(/[\s-]+/).filter(w => w && !MINOR.has(w)), ab = abbr.toLowerCase();
    if (!ws.length || ws[0][0] !== ab[0] || ws.length < Math.ceil(ab.length * 0.6)) return false;
    let k = 0; for (const w of ws) { k = ab.indexOf(w[0], k); if (k < 0) return false; k++; }
    return true;
  }
  function synonymsFrom(idx) {
    const map = new Map(), join = names => {
      names = names.map(n => n.toLowerCase().replace(/\s+/g, ' ').trim()).filter(n => n.length > 1);
      if (names.length < 2) return;
      const all = new Set(names); names.forEach(n => (map.get(n) || []).forEach(x => all.add(x)));
      all.forEach(n => map.set(n, all));
    };
    idx.pages.forEach(p => {
      p.terms.forEach(t => { const mm = String(t.title).match(/^(.*?)\s*\(([^)]+)\)\s*$/); if (mm) join([mm[1], mm[2]]); });
      p.sections.forEach(sec => {
        const tx = sec.text || '';
        for (const mm of tx.matchAll(/((?:[A-Za-z][\w-]*,?\s+){0,6}[A-Za-z][\w-]*)\s+\(([A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\)/g)) {
          const ws = mm[1].replace(/,/g, '').split(/\s+/);
          for (let k = Math.min(ws.length, 7); k >= 1; k--) { const ph = ws.slice(-k).join(' '); if (initialsFit(ph, mm[2]) && !MINOR.has(ws[ws.length - k].toLowerCase())) { join([ph, mm[2]]); break; } }
        }
        for (const mm of tx.matchAll(/\b([A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\s+\(([a-z][a-z -]{3,60})\)/g)) if (initialsFit(mm[2], mm[1])) join([mm[1], mm[2]]);
      });
    });
    return map;
  }
  // The query as terms, each with the words that satisfy it: "quoted phrases" exactly, names with their synonyms.
  function parseQuery(raw) {
    const terms = [];
    let rest = raw.replace(/["“”]([^"“”]+)["“”]/g, (_, ph) => { if (ph.trim()) terms.push({ alts: [ph.trim()], exact: true }); return ' '; });
    rest = ' ' + rest.replace(/\s+/g, ' ').trim() + ' ';
    [...SYN.keys()].filter(k => k.includes(' ')).sort((a, b) => b.length - a.length).forEach(k => {
      if (rest.includes(' ' + k + ' ')) { terms.push({ alts: [...SYN.get(k)] }); rest = rest.replace(' ' + k + ' ', ' '); }
    });
    let words = rest.trim().split(/\s+/).filter(Boolean);
    if (words.some(t => !STOP.has(t)) || terms.length) words = words.filter(t => !STOP.has(t));
    words.forEach(w => terms.push({ alts: SYN.has(w) ? [w, ...[...SYN.get(w)].filter(x => x !== w)] : [w] }));
    return terms;
  }
  let lastAlts = [];
  const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'is', 'are', 'why', 'how', 'what', 'when', 'does', 'do', 'not', 'with']);
  const stem = t => t.length > 4 ? t.replace(/(?<!s)(es|s)$/, '') : t;      // plurals only: trips → trip
  const has = (hay, t) => hay.includes(t) || (t.length > 4 && hay.includes(stem(t)));
  const hasT = (hay, q) => q.alts.some(a => q.exact ? hay.includes(a) : has(hay, a));
  function runSearch() {
    const raw = searchInput.value.trim().toLowerCase(); sel = -1;
    if (!raw || !index) { render(results); return; }
    const terms = parseQuery(raw);
    if (!terms.length) { render(results); return; }
    const scored = index.map(e => {
      const page = !e.heading, all = `${e.t} ${e.h} ${e.k} ${e.b}`;
      if (!terms.every(t => hasT(all, t))) return null;
      const inH = terms.filter(t => hasT(e.h, t)).length, inT = terms.filter(t => hasT(e.t, t)).length, inK = terms.filter(t => hasT(e.k, t)).length;
      const inHead = page ? terms.filter(t => hasT(`${e.t} ${e.k}`, t)).length : inH;
      let score = inH * 6 + (page ? inT * 4 + inK * 3 + 2 : inT) + terms.filter(t => hasT(e.b, t)).length;
      if (e.h && terms.some(t => t.alts.includes(e.h))) score += 8;
      if (e.card) score -= 3;
      return { e, inHead, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    const perPage = {}, hits = [];
    for (const x of scored) {
      const k = `${x.e.tab}/${x.e.slug}`;
      if ((perPage[k] = (perPage[k] || 0) + 1) > 3) continue;
      hits.push(x); if (hits.length >= 30) break;
    }
    const flat = terms.flatMap(t => t.alts), loose = terms.flatMap(t => t.exact ? t.alts : t.alts.map(stem));
    lastAlts = [...new Set(loose)];
    render(results, hits.length ? hits.map(({ e, inHead }) => {
      const snip = inHead < terms.length || !e.heading ? snippet(e.body || '', loose) : '';
      return html`<li data-tab="${e.tab}"><a href="#/${e.tab}/${e.slug}${e.id ? '/' + e.id : ''}">
        <span class="sr-main">${window.HN.marked(e.heading || e.title, flat)}</span>
        ${snip ? html`<span class="sr-snip">${window.HN.marked(snip, loose)}</span>` : ''}
        <span class="sr-sub"><span class="sr-tab">${TAB[e.tab] ? TAB[e.tab].name : e.tab}</span>${e.heading ? html`<span>${e.title}</span>` : ''}</span></a></li>`;
    }) : html`<li class="sr-hint">No Results for “${searchInput.value.trim()}”</li>`);
  }
  async function openSearch() {
    searchEl.hidden = false; document.body.classList.add('no-scroll');
    searchInput.value = ''; runSearch(); searchInput.focus();
    if (!index) { const idx = await getIndex(); SYN = synonymsFrom(idx); index = entriesFrom(idx); runSearch(); }
  }
  function closeSearch() { if (searchEl.hidden) return; searchEl.hidden = true; if (!sheetOpen) document.body.classList.remove('no-scroll'); }
  searchInput.addEventListener('input', runSearch);
  // A result remembers what matched, so the page opens at that paragraph.
  results.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/"]'); if (!a) return;
    const href = a.getAttribute('href'), mm = href.match(/^#\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([\w-]+))?$/);
    if (!mm) return;
    FIND = { href, id: mm[3] || null, alts: lastAlts };
    if (href === location.hash && A.R && $('#book')) { e.preventDefault(); const f = FIND; FIND = null; closeSearch(); runFind(f); }
  });
  searchInput.addEventListener('keydown', e => {
    const items = results.querySelectorAll('a');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.classList.toggle('sel', i === sel)); items[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && items.length) { e.preventDefault(); items[Math.max(sel, 0)].click(); }
  });
  $('#search-close').addEventListener('click', closeSearch);
  searchEl.addEventListener('click', e => { if (e.target === searchEl) closeSearch(); });

  /* ================= global events ================= */

  navbar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'btn-search') openSearch();
    else if (b.id === 'btn-contents') openContents();
    else if (b.id === 'btn-aa') openSettings();
    else if (b.id === 'btn-export') openExport();
    else if (b.id === 'btn-focus') startFocus();
  });

  document.addEventListener('keydown', e => {
    if (FX) { focusKey(e); return; }
    if (document.querySelector('.sheet-back')) return;     // a core dialog is open
    const typing = /input|textarea/i.test(document.activeElement.tagName);
    if (e.key === 'Escape') { if (closeViewer()) return; if (sheetOpen) closeSheet(); else if (!searchEl.hidden) closeSearch(); else exitImmersive(); return; }
    if (typing || sheetOpen || !searchEl.hidden) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); return; }
    const R = A.R;
    if (R && settings.mode === 'pages') {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goTo(R.page + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); goTo(R.page - 1); }
    }
  });

  let lastY = 0;
  window.addEventListener('scroll', () => {
    if (!A.R || settings.mode === 'pages') return;
    const y = scrollY;
    if (y > lastY + 8 && y > 120) root.classList.add('chrome-hidden');
    else if (y < lastY - 8) root.classList.remove('chrome-hidden');
    lastY = y; updateFoot(); savePos(); updateRail();
  }, { passive: true });

  window.addEventListener('resize', debounce(() => { if (A.R) { layout(fraction()); const b = $('#book'); if (b) markWide(b); } }, 150));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);
  new MutationObserver(updateThemeColor).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-paper'] });

  /* ================= router ================= */

  async function route() {
    const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    closeSearch();
    const wasFocus = !!FX; if (FX) { FX.from = 'link'; closeFocus(); }       // a link inside a focused card leaves focus mode
    const R = A.R;
    if (a && TAB[a] && b && R && R.tab === a && R.slug === b && $('#book')) {
      closeSheet(true);
      const f = FIND && FIND.href === location.hash ? FIND : null; FIND = null;
      if (f) runFind(f); else if (c) goToAnchor(c, wasFocus);
      return;
    }
    D.flush();
    closeSheet(true); closeViewer(); hlBar.hidden = true; lastRange = null;
    root.classList.remove('pages-mode', 'chrome-hidden'); A.R = null; delete root.dataset.layout;
    const stayFull = immersive() && a && TAB[a] && b;           // full-screen reading carries on to the next page
    try {
      if ((a && TAB[a] && D.closed(a)) || (['notebook', 'review', 'symptoms', 'field'].includes(a) && b && D.closed(b))) viewMissing();
      else if (!a) await viewLibrary();
      else if (a === 'notebook') viewNotebook(b);
      else if (a === 'review') await viewReview(b);
      else if (a === 'symptoms') await viewSymptoms(b || where.tab || TABS[0].id);
      else if (a === 'field') await viewField(b || where.tab || TABS[0].id);
      else if (a === 'terms') await viewTerms();
      else if (a === 'timeline') await viewTimeline();
      else if (a === 'discussions') viewDiscussions();
      else if (a === 'publish') await viewPublish();
      else if (a === 'standards') await viewStandards();
      else if (!TAB[a]) viewMissing();
      else if (!b) await viewSection(a);
      else await viewReader(a, b, c);
    } catch (err) {
      if (err && err.code === 'SIGNED_OUT') { Core.showError(err); return; }
      render(main, html`<div class="hn-page"><div class="empty tall"><strong>Cannot Load</strong><span>${Api.errorMessage(err)}</span>
        <div class="empty-actions"><button class="btn primary" type="button" data-act="retry">Try again</button></div></div></div>`);
      main.querySelector('[data-act="retry"]').onclick = () => route();
    }
    if (immersive() && (!stayFull || where.view !== 'reader')) exitImmersive();
    if (where.view !== 'reader') window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    updateThemeColor();
  }

  Object.assign(A, { openSheet, closeSheet, goToAnchor, openSearch, layout, fraction });

  async function start() {
    D.onSaveError(err => Core.showError(err));
    render(main, html`<div class="loading-veil"><span class="spin"></span>Loading</div>`);
    try { await Promise.all([D.library(), D.loadMine(), D.loadShared().catch(() => false)]); }
    catch (err) {
      if (err && err.code === 'SIGNED_OUT') { Core.showError(err); return; }
      Core.showState('Cannot load', Api.errorMessage(err), { href: location.pathname, label: 'Try again' }); return;
    }
    A.bindMine();
    document.querySelectorAll('[data-shell]').forEach(x => { x.hidden = false; });
    applySettings();
    renderTabbar();
    window.addEventListener('hashchange', route);
    await route();
    getIndex().then(x => { IDXC = x; }, () => { });
    migrateAliases().catch(() => { });
    // Everyone else's notes: reloaded at most once a minute, when a page opens or the tab comes back.
    const fresh = () => D.loadShared(60000).then(changed => { if (changed) { refreshOthers(); renderSidebar(); } }, () => { });
    window.addEventListener('hashchange', fresh);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fresh(); });
  }

  Core.requireLogin({ tile: 'hvac-notes' }).then(start);
})();
