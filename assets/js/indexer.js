/*
 * HVAC Notes — the knowledge index, shared by the browser (assets/js/app.js) and tools/seal.mjs.
 *
 * seal.mjs builds it from the plain pages and encrypts it as content/index.json.enc, so the reader downloads
 * one file instead of decrypting every page to search. The browser builds the same index itself if that file
 * is missing. Both sides use the same slugify(), so heading ids always match.
 *
 * Index shape:
 *   { v: 1, pages: [ { tab, slug, title, summary, keywords, layout, group, words,
 *                      links: ["tab/slug", …],               pages this page links to
 *                      sections: [ { id, heading, level, text, deep } ],   id null = text before the first heading;
 *                                                         deep = the heading ends in {.deeper} (hidden in Essentials)
 *                      checks: [ { key, id, q, a } ],      Check yourself: question, answer (Markdown), section id
 *                      terms: [ { id, title, meaning, type } ],  cards (pages with layout "cards"); on standards
 *                                                         pages (kind "standards") meaning comes from **Covers:**
 *                      symptoms: [ { id, title } ],        "### Symptom: …" headings
 *                      field: [ { url, title, src, date, kind, note } ] } ] }   "## In the field" items (fieldItems)
 */
(function (root) {
  'use strict';

  function slugify(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  }

  // Plain text of Markdown, for searching: no images, link targets, maths markup or formatting.
  function plainText(md) {
    return md.replace(/\[\^[\d\s,]+\]/g, '').replace(/\\\$/g, '$').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ').replace(/^\s*>\s*\[!\w+\]/gm, ' ')
      .replace(/\\(?:[a-z]+|.)/gi, ' ').replace(/[*_`>#|${}^\\]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // A heading ending in {.deeper} marks a section a first reading can skip.
  const DEEP = /\s*\{\.deeper\}\s*$/;
  // Heading text as the reader shows it (formatting, link targets and the {.deeper} marker removed).
  const headingText = s => s.replace(DEEP, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

  // A short, stable key for a Check yourself question, so its review history survives edits elsewhere on the page.
  function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

  // Links written as [text](slug), [text](../tab/slug), with optional #heading.
  function linksOf(md, tab) {
    const out = new Set();
    for (const m of md.matchAll(/\]\((?:\.\/)?(?:\.\.\/([a-z]+)\/)?([a-z0-9-]+)(?:\.md)?(?:#[\w-]+)?\)/gi)) out.add(`${m[1] || tab}/${m[2]}`);
    return [...out];
  }

  // "## In the field": recent research, articles, market reports, regulations, case studies and products, one per item:
  //   - [Title](https://…) · Publisher · 2026-05 · Research
  //     One or two sentences: what it found or did, and what it means here.
  const FIELD_KINDS = ['Research', 'Article', 'Market', 'Regulation', 'Case study', 'Product'];
  const FIELD_ITEM = /^[-*]\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*·\s*(.+?)\s*·\s*(\d{4}-\d{2}(?:-\d{2})?)\s*·\s*([A-Za-z ]+?)\s*$/;
  function fieldItems(raw) {
    const out = [], bad = [];
    let cur = null;
    for (const line of raw.split('\n')) {
      if (/^[-*]\s/.test(line)) {
        const m = line.match(FIELD_ITEM);
        if (m) { cur = { title: m[1].trim(), url: m[2], src: m[3].trim(), date: m[4], kind: m[5].trim(), note: '' }; out.push(cur); }
        else { cur = null; bad.push(line.trim()); }
      } else if (cur && /^\s+\S/.test(line)) cur.note = (cur.note + ' ' + line.trim()).trim();
      else if (line.trim()) cur = null;
    }
    return { items: out, bad };
  }

  function buildPage(meta, tab, md) {
    const body = md.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g, '\n');
    const page = {
      tab, slug: meta.slug, title: meta.title, summary: meta.summary || '',
      keywords: Array.isArray(meta.keywords) ? meta.keywords : (meta.keywords ? [meta.keywords] : []),
      layout: meta.layout || '', kind: meta.kind || '', group: meta.group || '', words: (plainText(body).match(/\S+/g) || []).length,
      links: linksOf(body, tab).filter(r => r !== `${tab}/${meta.slug}`),
      sections: [], checks: [], terms: [], symptoms: [], field: []
    };
    const seen = new Set();
    let cur = { id: null, heading: null, level: 1, deep: false, lines: [] };
    let h2 = '';
    const flush = () => {
      const raw = cur.lines.join('\n');
      const skip = /^sources$/i.test(cur.heading || '') || /^sources$/i.test(h2) && cur.level > 2;
      page.sections.push({ id: cur.id, heading: cur.heading, level: cur.level, text: skip ? '' : plainText(raw), ...(cur.deep ? { deep: true } : {}) });
      if (page.layout === 'cards' && cur.level === 3) {
        const m = raw.match(/\*\*(?:Meaning|Covers):\*\*\s*([^\n]+)/i), ty = raw.match(/\*\*Type:\*\*\s*([^\n]+)/i);
        page.terms.push({ id: cur.id, title: cur.heading, meaning: m ? plainText(m[1]) : '', type: ty ? plainText(ty[1]) : '' });
      }
      if (/^symptom:/i.test(cur.heading || '')) page.symptoms.push({ id: cur.id, title: cur.heading.replace(/^symptom:\s*/i, '') });
      if (cur.level === 2 && /^in the field$/i.test(cur.heading || '')) page.field = fieldItems(raw).items.map(x => ({ ...x, note: plainText(x.note) }));
      // Check yourself: "> [!check] Question" then "> answer" lines.
      const lines = cur.lines;
      for (let i = 0; i < lines.length; i++) {
        const q = lines[i].match(/^>\s*\[!check\][ \t]*(.*)$/i);
        if (!q) continue;
        const a = [];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) a.push(lines[++i].replace(/^>\s?/, ''));
        const question = q[1].trim();
        if (question) page.checks.push({ key: hash(question), id: cur.id, q: question, a: a.join('\n').trim() });
      }
    };
    for (const line of body.split('\n')) {
      const m = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (!m) { cur.lines.push(line); continue; }
      if (m[1].length === 1) continue;                 // the page title
      flush();
      const text = headingText(m[2]);
      let id = slugify(text), n = 2;
      while (seen.has(id)) id = slugify(text) + '-' + n++;
      seen.add(id);
      if (m[1].length === 2) h2 = text;
      const deep = DEEP.test(m[2]) || (cur.deep && cur.level < m[1].length && cur.deepRoot);
      cur = { id, heading: text, level: m[1].length, deep: !!deep, deepRoot: DEEP.test(m[2]) ? m[1].length : (deep ? cur.deepRoot : 0), lines: [] };
    }
    flush();
    return page;
  }

  // pages: [{ tab, meta, md }] in reading order.
  function build(pages) {
    return { v: 1, pages: pages.map(p => buildPage(p.meta, p.tab, p.md)) };
  }

  /* ---- growth: what changed between two versions of the index ---- */

  // A fingerprint of each section (the Sources section is left out), keyed by heading id ('_' = the intro).
  function fingerprint(p) {
    const out = {};
    p.sections.forEach(sec => { if (!/^sources$/i.test(sec.heading || '')) out[sec.id || '_'] = hash((sec.heading || '') + '\n' + sec.text); });
    return out;
  }
  const routeOf = p => `${p.tab}/${p.slug}`;
  const sec = s => ({ id: s.id, h: s.heading });
  // A changed section keeps its previous text (up to a limit), so the reader can show what changed.
  const WAS_MAX = 6000;
  const was = (s, o) => { const t = o.text || ''; return t.length <= WAS_MAX ? { ...sec(s), was: t } : sec(s); };

  // Items for the knowledge timeline: pages that are new, and pages that gained or changed sections, cards,
  // symptoms or Check yourself questions. On card pages only the cards count (each card is also a section).
  function diff(before, after) {
    const old = new Map(((before && before.pages) || []).map(p => [routeOf(p), p]));
    const out = [];
    for (const p of after.pages) {
      const r = routeOf(p), o = old.get(r), cards = p.layout === 'cards';
      const base = { route: r, title: p.title, cards, std: p.kind === 'standards' };
      if (!o) {
        out.push({ ...base, kind: 'new', sections: cards ? 0 : p.sections.filter(s => s.heading && !/^sources$/i.test(s.heading)).length,
          terms: p.terms.map(t => ({ id: t.id, h: t.title })), symptoms: p.symptoms.length, checks: p.checks.length, words: p.words });
        continue;
      }
      const fo = fingerprint(o), fn = fingerprint(p), added = [], changed = [];
      const olds = new Map(o.sections.map(x => [x.id || '_', x]));
      if (!cards) p.sections.forEach(s => {
        const k = s.id || '_';
        if (!(k in fn)) return;
        if (!(k in fo)) added.push(sec(s)); else if (fo[k] !== fn[k]) changed.push(was(s, olds.get(k)));
      });
      const had = new Set(o.terms.map(t => t.id)), terms = p.terms.filter(t => !had.has(t.id)).map(t => ({ id: t.id, h: t.title }));
      const hadS = new Set(o.symptoms.map(t => t.id)), symptoms = p.symptoms.filter(t => !hadS.has(t.id)).length;
      const hadC = new Set(o.checks.map(t => t.key)), checks = p.checks.filter(t => !hadC.has(t.key)).length;
      if (added.length || changed.length || terms.length || symptoms || checks)
        out.push({ ...base, kind: 'grew', added, changed, terms, symptoms, checks });
    }
    return out;
  }

  // Adds a day's items to the log ({ v, days: [{ date, items }] }, oldest first), merging with what that day already has.
  function addToLog(log, date, items) {
    log = log && Array.isArray(log.days) ? log : { v: 1, days: [] };
    if (!items.length) return log;
    let day = log.days.find(d => d.date === date);
    if (!day) { day = { date, items: [] }; log.days.push(day); log.days.sort((a, b) => a.date.localeCompare(b.date)); }
    const uniq = list => { const seen = new Set(); return list.filter(x => { const k = x.id || x.h; if (seen.has(k)) return false; seen.add(k); return true; }); };
    for (const it of items) {
      const cur = day.items.find(x => x.route === it.route);
      if (!cur) { day.items.push(it); continue; }
      cur.title = it.title;
      if (cur.kind === 'new') {                       // new today: keep it new, with the latest counts
        if (it.kind === 'new') Object.assign(cur, it);
        else {
          cur.terms = uniq([...(cur.terms || []), ...it.terms]); cur.symptoms = (cur.symptoms || 0) + it.symptoms; cur.checks = (cur.checks || 0) + it.checks; cur.sections = (cur.sections || 0) + (it.added || []).length;
          // Sections edited again on the day they were published: keep their earlier text, for "changed since you read it".
          const rev = (it.changed || []).filter(x => typeof x.was === 'string');
          if (rev.length) cur.revised = uniq([...(cur.revised || []), ...rev]);
        }
        continue;
      }
      const addedIds = new Set((cur.added || []).map(x => x.id));
      cur.added = uniq([...(cur.added || []), ...(it.added || [])]);
      cur.changed = uniq([...(cur.changed || []), ...(it.changed || [])]).filter(x => !addedIds.has(x.id) && !(it.added || []).some(a => a.id === x.id));
      cur.terms = uniq([...(cur.terms || []), ...(it.terms || [])]);
      cur.symptoms = (cur.symptoms || 0) + (it.symptoms || 0);
      cur.checks = (cur.checks || 0) + (it.checks || 0);
    }
    return log;
  }

  const api = { slugify, plainText, build, buildPage, hash, fingerprint, diff, addToLog, fieldItems, FIELD_KINDS };
  root.HVACIndex = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
