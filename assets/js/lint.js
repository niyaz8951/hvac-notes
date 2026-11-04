/*
 * HVAC Notes: the quality check for pages, shared by the Publish page (publish.js) and tools/lint.mjs.
 *
 * Errors (stop a publish when they are on a page changed in it):
 *   - a link to a page or section that does not exist, or a link the reader cannot follow
 *   - a page with no "## Sources" section, a source reference [^n] with no item n in the numbered Sources list
 *   - the same term card in two dictionaries, or the same standard in two standards chapters
 *   - prereq / related naming a page that does not exist; a prereq loop
 *   - a page removed or renamed without "aliases" on the page that replaced it; an alias used twice
 *   - nav.json entries without a page, bad slugs or dates; unknown callouts; widgets that do not parse;
 *     missing images; photos not listed in CREDITS.md
 *   - "## In the field" items not in the form  - [Title](https://…) · Source · YYYY-MM · Kind  with a note below,
 *     an unknown kind, a date in the future, the same link twice on a page
 *   - since the move to DAME: an image from outside the site (the CSP blocks it), an image outside <notebook>/images/
 *     or with a name the bucket refuses, a file too big, a notebook folder the reader does not show, an explore widget
 *     that is not tile code (assets/js/widgets/), or one without the figures it reads from the page ("data")
 * Warnings (never stop a publish): pages not listed in nav.json, links, prereq or related that use an old name (alias),
 * section ids that disappeared, Check yourself questions without an answer, pages without a summary.
 */
(function (root) {
  'use strict';
  const IDX = root.HVACIndex || (typeof require === 'function' ? require('./indexer.js') : null);
  const { fieldItems, FIELD_KINDS } = IDX;

  const CALLOUTS = ['general', 'daikin', 'example', 'note', 'tip', 'warning', 'key', 'check'];
  const RASTER = /\.(png|jpe?g|webp|gif|avif)$/i;
  const IMAGE = /\.(svg|png|jpe?g|webp|gif)$/i;
  const IMAGE_PATH = /^[a-z0-9-]{1,30}\/images\/[A-Za-z0-9._-]{1,120}$/;
  const CODE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
  const TABS = ['theory', 'chillers', 'ahu', 'fcu', 'systems', 'ashrae'];
  const LIMITS = { page: 400000, nav: 200000, image: 5 * 1024 * 1024, credits: 100000 };
  // The figures each explore widget reads from its page ("data" in the widget block).
  const WIDGET_DATA = {
    'clearance-explore': ['Hc', 'Lmin', 'above', 'ruleLow', 'ruleHigh'],
    'multi-chiller-explore': ['calm', 'wind', 'walls', 'aligned'],
    'bag-depth-explore': ['rated_m3h', 'depths', 'series'],
    'filter-wall-explore': ['rated_m3h', 'clean1', 'clean2', 'max']
  };

  // Names a card goes by: "FAHU (fresh air handling unit)" → ["fahu", "fresh air handling unit"].
  function cardNames(title) {
    const t = String(title).replace(/[*_`]/g, '').trim();
    const m = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const names = m ? [m[1], m[2]] : [t];
    return names.map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  // The aliases in every nav.json, as { "tab/old-slug": "tab/current-slug" }.
  function aliasMap(navs) {
    const out = {}, dup = [];
    for (const [tab, list] of Object.entries(navs)) for (const m of list) {
      for (const a of (m && m.aliases) || []) {
        const r = String(a).includes('/') ? String(a) : `${tab}/${a}`;
        if (out[r]) dup.push([r, out[r], `${tab}/${m.slug}`]);
        out[r] = `${tab}/${m.slug}`;
      }
    }
    return { map: out, dup };
  }

  /*
   * pages: [{ tab, meta, md }]   navs: { tab: [meta…] }   index: the built index
   * files: Set of paths in the upload ("ahu/images/x.svg")   sizes: { path: bytes }   credits: text of CREDITS.md
   * before: the published index or null   widgets: names of the explore widgets the tile has   tabs: notebooks the reader shows
   * Returns [{ route, level: 'error' | 'warn', msg }]. route "*" = not tied to one page.
   */
  function lint({ pages, navs, index, files, sizes = {}, credits = '', before = null, widgets = [], tabs = TABS }) {
    const out = [];
    const err = (route, msg) => out.push({ route, level: 'error', msg });
    const warn = (route, msg) => out.push({ route, level: 'warn', msg });
    const byRoute = new Map(index.pages.map(p => [`${p.tab}/${p.slug}`, p]));
    const ids = r => new Set((byRoute.get(r) || { sections: [] }).sections.map(s => s.id).filter(Boolean));
    const { map: alias, dup } = aliasMap(navs);
    dup.forEach(([a, x, y]) => err(y, `alias "${a}" is also used by ${x}`));
    for (const a of Object.keys(alias)) if (byRoute.has(a)) err(alias[a], `alias "${a}" is the name of an existing page`);

    // notebooks and files
    for (const tab of Object.keys(navs)) if (!tabs.includes(tab)) err(`${tab}/nav.json`, `"${tab}" is not a notebook the reader shows (${tabs.join(', ')})`);
    if (String(credits).length > LIMITS.credits) err('*', 'CREDITS.md is too long');
    for (const f of files) {
      const size = sizes[f] || 0;
      if (/\.md$/.test(f) && f.includes('/') && size > LIMITS.page * 4) err(f.replace(/\.md$/, ''), 'page is too big');
      if (/\/nav\.json$/.test(f) && size > LIMITS.nav) err(f, 'nav.json is too big');
      if (IMAGE.test(f)) {
        if (!IMAGE_PATH.test(f)) err(f, 'images go in <notebook>/images/ with a plain file name (letters, digits, . _ -)');
        else if (size > LIMITS.image) err(f, `image is ${(size / 1048576).toFixed(1)} MB; the limit is 5 MB (aim for 300 KB)`);
      }
    }

    // nav.json
    for (const [tab, list] of Object.entries(navs)) {
      const slugs = new Set();
      for (const m of list) {
        const r = `${tab}/${m && m.slug}`;
        if (!m || !m.slug || !/^[a-z0-9-]+$/.test(m.slug) || m.slug.length > 80) { err(`${tab}/nav.json`, `entry with a missing or invalid slug: ${JSON.stringify(m && m.slug)}`); continue; }
        if (slugs.has(m.slug)) err(r, 'listed twice in nav.json'); slugs.add(m.slug);
        if (!m.title) err(r, 'nav.json entry has no title');
        if (!files.has(`${tab}/${m.slug}.md`)) err(r, `nav.json lists it but ${tab}/${m.slug}.md is missing`);
        if (m.updated && !/^\d{4}-\d{2}-\d{2}$/.test(m.updated)) err(r, `"updated" must be YYYY-MM-DD, not "${m.updated}"`);
        if (m.layout && m.layout !== 'cards') err(r, `unknown layout "${m.layout}"`);
        if (m.kind && m.kind !== 'standards') err(r, `unknown kind "${m.kind}"`);
        if (!m.summary) warn(r, 'nav.json entry has no summary');
        for (const f of ['prereq', 'related']) for (const x of [].concat(m[f] || [])) {
          if (byRoute.has(x)) continue;
          if (alias[x]) warn(r, `${f} names "${x}", an old name; it now lives at ${alias[x]}`);
          else err(r, `${f} names "${x}", which is not a page`);
        }
      }
    }
    for (const f of files) {
      const m = f.match(/^([a-z0-9-]+)\/([a-z0-9-]+)\.md$/);
      if (m && navs[m[1]] && !navs[m[1]].some(x => x && x.slug === m[2])) warn(`${m[1]}/${m[2]}`, 'page is not listed in nav.json, so the site never shows it');
    }

    // prereq loops
    const pre = {};
    for (const [tab, list] of Object.entries(navs)) for (const m of list) if (m && m.slug) pre[`${tab}/${m.slug}`] = [].concat(m.prereq || []);
    const state = {};
    const visit = (r, trail) => {
      if (state[r] === 2) return; if (state[r] === 1) { err(r, `prereq loop: ${[...trail.slice(trail.indexOf(r)), r].join(' → ')}`); return; }
      state[r] = 1; for (const x of pre[r] || []) if (pre[x]) visit(x, [...trail, r]); state[r] = 2;
    };
    Object.keys(pre).forEach(r => visit(r, []));

    // pages
    const fieldSeen = {};
    for (const { tab, meta, md } of pages) {
      const r = `${tab}/${meta.slug}`, page = byRoute.get(r);
      if (md.length > LIMITS.page) err(r, `page has ${md.length} characters; the limit is ${LIMITS.page} (split the chapter)`);
      const body = md.replace(CODE, '\n');
      const mine = ids(r);
      // links and images
      for (const m of body.matchAll(/(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        const [, img, href] = m;
        if (img && /^(https?:|\/\/)/i.test(href)) { err(r, `image "${href}" is outside the site; the page cannot load it. Save it in ${tab}/images/ (with its licence in CREDITS.md)`); continue; }
        if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue;
        if (img) {
          const p = `${tab}/${href.replace(/^\.\//, '')}`;
          if (!files.has(p)) err(r, `image "${href}" is missing from ${tab}/`);
          else if (!IMAGE_PATH.test(p)) err(r, `image "${href}" must be in ${tab}/images/`);
          else if (RASTER.test(href) && !String(credits).includes(href.split('/').pop())) err(r, `photo "${href}" is not listed in CREDITS.md`);
          continue;
        }
        if (href.startsWith('#')) { if (!mine.has(href.slice(1))) err(r, `link "${href}" points to a section this page does not have`); continue; }
        const k = href.replace(/^\.\//, '').match(/^(?:\.\.\/([a-z0-9-]+)\/)?([a-z0-9-]+)(?:\.md)?(?:#([\w-]+))?$/i);
        if (!k) { if (!files.has(`${tab}/${href.replace(/^\.\//, '')}`)) err(r, `link "${href}" cannot be followed (write [text](slug), [text](../tab/slug) or add #section)`); continue; }
        let target = `${k[1] || tab}/${k[2]}`;
        if (!byRoute.has(target)) {
          if (alias[target]) { warn(r, `link "${href}" uses an old name; it now lives at ${alias[target]}`); target = alias[target]; }
          else { err(r, `link "${href}" points to a page that does not exist`); continue; }
        }
        if (k[3] && !ids(target).has(k[3])) err(r, `link "${href}" points to a section ${target} does not have`);
      }
      // callouts
      for (const m of body.matchAll(/^>\s*\[!(\w+)\]/gm)) if (!CALLOUTS.includes(m[1].toLowerCase())) err(r, `unknown callout [!${m[1]}] (use ${CALLOUTS.join(', ')})`);
      // widgets
      for (const m of md.matchAll(/(?:^|\n)```widget[^\n]*\n([\s\S]*?)\n```/g)) {
        let spec; try { spec = JSON.parse(m[1]); } catch (e) { err(r, `a widget block is not valid JSON (${e.message}); the site drops it`); continue; }
        const name = spec.title || spec.type;
        if (!['explore', 'practice', 'draw'].includes(spec.type)) { err(r, `widget "${name}" has an unknown type "${spec.type}"`); continue; }
        if (spec.type === 'explore') {
          const w = String(spec.src || '').replace(/^\.\//, '').match(/^widgets\/([a-z0-9-]+)\.js$/);
          if (!w || !widgets.includes(w[1])) err(r, `widget "${name}" names src "${spec.src}", which is not one of the tile's explorers (${widgets.join(', ')})`);
          else if (WIDGET_DATA[w[1]]) {
            const d = spec.data, miss = !d || typeof d !== 'object' ? WIDGET_DATA[w[1]] : WIDGET_DATA[w[1]].filter(x => d[x] === undefined || d[x] === null);
            if (miss.length) err(r, `widget "${name}" needs its figures in "data": ${miss.join(', ')}`);
          }
        }
        if (spec.type === 'draw') {
          const p = `${tab}/${String(spec.svg || '').replace(/^\.\//, '')}`;
          if (!spec.svg || !files.has(p)) err(r, `widget "${name}" names svg "${spec.svg}", which is missing`);
          if (!Array.isArray(spec.steps)) err(r, `widget "${name}" has no steps`);
        }
        if (spec.type === 'practice') {
          for (const P of spec.problems || [spec]) if (!Array.isArray(P.answers) || !P.prompt) { err(r, `widget "${name}": every problem needs a prompt and answers`); break; }
        }
      }
      // sources
      const sm = body.match(/(?:^|\n)##\s+Sources\s*\n([\s\S]*?)(?=\n##\s|$)/i);
      if (!sm) err(r, 'no "## Sources" section');
      const items = sm ? (sm[1].match(/^\d+\.\s/gm) || []).length : 0;
      const text = sm ? body.replace(sm[0], '\n') : body;
      for (const m of text.matchAll(/\[\^([\d\s,]+)\]/g)) for (const n of m[1].split(',').map(s => +s.trim()).filter(Boolean)) {
        if (!items) { err(r, `source reference [^${n}] but Sources is not a numbered list`); break; }
        if (n > items) err(r, `source reference [^${n}] but Sources has ${items} item${items === 1 ? '' : 's'}`);
      }
      // In the field
      const fm = body.match(/(?:^|\n)##\s+In the field\s*\n([\s\S]*?)(?=\n##\s|$)/i);
      if (fm) {
        const { items: list, bad } = fieldItems(fm[1]);
        bad.forEach(l => err(r, `In the field: "${l.slice(0, 70)}" is not "- [Title](https://…) · Source · YYYY-MM · Kind"`));
        const now = new Date().toISOString().slice(0, 7), urls = new Set();
        list.forEach(x => {
          if (!FIELD_KINDS.includes(x.kind)) err(r, `In the field: "${x.title}" has kind "${x.kind}" (use ${FIELD_KINDS.join(', ')})`);
          const [, mo, d] = x.date.split('-').map(Number);
          if (mo < 1 || mo > 12 || (d && (d < 1 || d > 31))) err(r, `In the field: "${x.title}" has an invalid date ${x.date}`);
          else if (x.date.slice(0, 7) > now) err(r, `In the field: "${x.title}" is dated in the future (${x.date})`);
          if (!/^https:/.test(x.url)) err(r, `In the field: "${x.title}" links over http; use the https address`);
          if (!x.note.trim()) err(r, `In the field: "${x.title}" has no note (one or two sentences on the next line, indented)`);
          if (urls.has(x.url)) err(r, `In the field: ${x.url} is listed twice`); urls.add(x.url);
          (fieldSeen[x.url] = fieldSeen[x.url] || []).push(r);
        });
        if (!list.length && !bad.length) warn(r, 'In the field has no items');
      }
      if (page) page.checks.forEach(c => { if (!c.a.trim()) warn(r, `Check yourself "${c.q.slice(0, 50)}" has no answer`); });
    }

    for (const [u, at] of Object.entries(fieldSeen)) if (new Set(at).size > 1) warn(at[at.length - 1], `In the field: ${u} is also on ${[...new Set(at)].filter(x => x !== at[at.length - 1]).join(', ')} (keep it on the page it fits best)`);

    // one card per term, one card per standard
    for (const std of [false, true]) {
      const seen = {};
      index.pages.filter(p => p.layout === 'cards' && (p.kind === 'standards') === std).forEach(p => p.terms.forEach(t => {
        for (const n of cardNames(t.title)) {
          const at = `${p.tab}/${p.slug}`;
          if (seen[n] && seen[n] !== at) err(at, `${std ? 'standard' : 'term'} "${t.title}" also has a card in ${seen[n]} (one card per ${std ? 'standard' : 'term'})`);
          else seen[n] = at;
        }
      }));
    }

    // compared with the published version: pages that vanished, sections that vanished
    if (before && Array.isArray(before.pages)) {
      for (const o of before.pages) {
        const r = `${o.tab}/${o.slug}`, now = byRoute.get(r);
        if (!now) { if (!alias[r]) err(r, `page was removed or renamed: add "aliases": ["${o.tab}/${o.slug}"] to the page that now holds it, so old links and readers' highlights follow`); continue; }
        const have = ids(r);
        const gone = o.sections.map(s => s.id).filter(id => id && !have.has(id));
        if (gone.length) warn(r, `section id${gone.length === 1 ? '' : 's'} no longer on the page: ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? '…' : ''} (links to them now open the nearest section)`);
      }
    }
    return out;
  }

  // Splits issues: errors on changed pages block; errors on pages not changed now are listed; warnings never block.
  function split(issues, affected) {
    return {
      blocking: issues.filter(x => x.level === 'error' && (!affected || affected(x.route))),
      older: issues.filter(x => x.level === 'error' && affected && !affected(x.route)),
      warnings: issues.filter(x => x.level === 'warn')
    };
  }

  const api = { lint, split, cardNames, aliasMap, CALLOUTS, TABS, LIMITS, WIDGET_DATA, IMAGE_PATH };
  root.HVACLint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
