/*
 * HVAC Notes: building the page safely.
 *
 *   HN.html`<p class="x">${text}</p>`   markup written in this code, with values put in as text or attribute values.
 *       A value never becomes markup: strings and numbers become text nodes, nodes and arrays of nodes are inserted
 *       as they are, and a value inside an attribute is set with setAttribute (links checked, no event handlers).
 *       Only the literal parts of the template, which are code, are parsed as HTML.
 *   HN.svg`<path d="${d}"/>`             the same for SVG children (charts, cover art).
 *   HN.content(htmlString)               rendered Markdown and KaTeX: sanitized by DOMPurify (vendor/dompurify),
 *       returned as nodes. Images lose their src (data-src keeps it; the page loads them from the private bucket),
 *       inline styles are filtered and applied through the CSS object model (the CSP blocks style attributes).
 *   HN.clone(node)                       a deep copy that keeps inline styles.
 *   HN.icon(id)                          an icon from the page's sprite.
 *
 * No innerHTML, insertAdjacentHTML or document.write with data anywhere in this tile.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const URL_ATTR = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite']);
  const SAFE_URL = /^(?:#|\/(?!\/)|\.{1,2}\/|https?:|mailto:|tel:|blob:|[^:/?#]*(?:[/?#]|$))/i;
  const BOOL_KEEP = /^(aria-|data-)/;

  // ---------- styles: the CSP allows the CSS object model, not style attributes ----------
  const BAD_VALUE = /url\s*\(|image\s*\(|expression|javascript:|@import|\\|<|>/i;
  const BAD_PROP = /^(?:position|behavio[u]?r|-moz-binding|content|cursor|background-image|list-style-image|mask|mask-image|-webkit-mask|-webkit-mask-image|filter|src)$/i;
  function cssText(value, strict) {
    if (!strict) return value;
    return String(value).split(';').map(d => {
      const i = d.indexOf(':');
      if (i < 1) return '';
      const p = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
      if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(p) || BAD_PROP.test(p) || BAD_VALUE.test(v)) return '';
      return p + ':' + v;
    }).filter(Boolean).join(';');
  }
  // Moves style="" (or data-hn-style="" left by the sanitizer) onto element.style.
  function applyStyles(root, strict) {
    const list = [];
    if (root.nodeType === 1) list.push(root);
    if (root.querySelectorAll) list.push(...root.querySelectorAll('[style], [data-hn-style]'));
    list.forEach(el => {
      const raw = el.getAttribute('data-hn-style') != null ? el.getAttribute('data-hn-style') : el.getAttribute('style');
      if (raw == null) return;
      el.removeAttribute('data-hn-style'); el.removeAttribute('style');
      const t = cssText(raw, strict || el.hasAttribute('data-hn-strict'));
      el.removeAttribute('data-hn-strict');
      if (t && el.style) el.style.cssText = t;
    });
    return root;
  }

  // ---------- tagged templates ----------
  const cache = new Map();
  const MARK = i => `hn-slot-${i}-x`;
  const SLOT = /hn-slot-(\d+)-x/g;

  function prepare(strings, svg) {
    const key = (svg ? 's' : 'h') + strings.raw.join('\u0001');
    let t = cache.get(key);
    if (t) return t;
    let s = '';
    strings.forEach((str, i) => {
      s += str;
      if (i === strings.length - 1) return;
      const lt = s.lastIndexOf('<'), gt = s.lastIndexOf('>');
      s += lt > gt ? MARK(i) : `<!--hn:${i}-->`;
    });
    // Attributes that take a value, and style attributes, are parsed under a neutral name (data-hn-a-<name>), so the
    // browser never reads a placeholder as SVG geometry or a style attribute (the CSP reports those even when inert).
    s = s.replace(/(\s)([a-zA-Z_][\w:.-]*)=("([^"]*)"|'([^']*)')/g, (m, sp, name, q, d, sq) => {
      const v = d !== undefined ? d : sq;
      return name.toLowerCase() === 'style' || v.includes('hn-slot-') ? `${sp}data-hn-a-${name}=${q}` : m;
    });
    const tpl = document.createElement('template');
    tpl.innerHTML = svg ? `<svg xmlns="${SVG_NS}">${s}</svg>` : s;     // code only: values are not in this string
    t = { tpl, svg };
    cache.set(key, t);
    return t;
  }

  function insertValue(ref, v) {
    if (v === null || v === undefined || v === false || v === '') return;
    if (Array.isArray(v)) { v.forEach(x => insertValue(ref, x)); return; }
    if (v instanceof Node) { ref.parentNode.insertBefore(v, ref); return; }
    ref.parentNode.insertBefore(document.createTextNode(String(v)), ref);
  }

  function fill(root, vals) {
    // comments mark text slots
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT);
    const comments = [], elements = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 8) { if (/^hn:\d+$/.test(n.data)) comments.push(n); }
      else elements.push(n);
    }
    comments.forEach(c => { insertValue(c, vals[+c.data.slice(3)]); c.remove(); });
    elements.forEach(el => {
      for (const a of [...el.attributes]) {
        if (!a.name.startsWith('data-hn-a-')) continue;
        const real = a.name.slice(10), name = real.toLowerCase();
        el.removeAttribute(a.name);
        if (name.startsWith('on')) throw new Error('HN.html: no values in event handler attributes');
        const whole = /^hn-slot-(\d+)-x$/.exec(a.value);
        if (whole) {
          const v = vals[+whole[1]];
          if (v === null || v === undefined || (v === false && !BOOL_KEEP.test(name))) continue;
          if (v === true && !BOOL_KEEP.test(name)) { el.setAttribute(real, ''); continue; }
        }
        let value = a.value.replace(SLOT, (_, i) => { const v = vals[+i]; return v === null || v === undefined ? '' : String(v); });
        if (URL_ATTR.has(name) && !SAFE_URL.test(value.trim())) value = '#';
        if (name === 'style') { el.style.cssText = value; continue; }
        el.setAttribute(real, value);
      }
    });
    return root;
  }

  function build(strings, vals, svg) {
    const t = prepare(strings, svg);
    const frag = document.importNode(t.tpl.content, true);
    const wrap = svg ? frag.firstElementChild : frag;
    fill(wrap, vals);
    applyStyles(wrap);
    if (!svg) return frag;
    const out = document.createDocumentFragment();
    while (wrap.firstChild) out.appendChild(wrap.firstChild);
    return out;
  }
  const html = (strings, ...vals) => build(strings, vals, false);
  const svg = (strings, ...vals) => build(strings, vals, true);

  // ---------- sanitized content (rendered Markdown + KaTeX) ----------
  let hooked = false;
  // style="" becomes data-hn-style="" before parsing (applied later through the CSS object model, filtered).
  // Inside text and attribute values a quote is always escaped, so only real attributes match.
  const neutral = t => String(t).replace(/(<[^<>]*?\s)style=(["'])/g, '$1data-hn-style=$2');
  function hook() {
    if (hooked || !window.DOMPurify) return;
    hooked = true;
    window.DOMPurify.addHook('afterSanitizeAttributes', node => {
      if (node.hasAttribute && node.hasAttribute('style')) {
        node.setAttribute('data-hn-style', node.getAttribute('style'));
        node.removeAttribute('style');
      }
      if (node.hasAttribute && node.hasAttribute('data-hn-style')) node.setAttribute('data-hn-strict', '');
      if (node.tagName === 'IMG') {
        const s = node.getAttribute('src');
        node.removeAttribute('src');
        if (s) node.setAttribute('data-src', s);
      }
      if (node.tagName === 'A' && node.hasAttribute('target')) node.removeAttribute('target');
    });
  }
  const CONTENT_CFG = {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'audio', 'video', 'source', 'track', 'dialog', 'template', 'slot', 'foreignObject'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'autofocus', 'tabindex', 'contenteditable', 'id'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  };
  function content(htmlString, extra) {
    hook();
    if (!window.DOMPurify || !window.DOMPurify.isSupported) throw new Error('Sanitizer missing');
    const clean = window.DOMPurify.sanitize(neutral(htmlString), Object.assign({}, CONTENT_CFG, extra || {}));
    const out = document.createDocumentFragment();
    out.append(...clean.childNodes);                 // adopted into this document; images have no src
    applyStyles(out, true);
    return out;
  }
  // An SVG file from the content (draw widgets): sanitized with the SVG profile, returned as one <svg> element.
  function contentSvg(text) {
    hook();
    const clean = window.DOMPurify.sanitize(neutral(text), { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['style', 'script', 'foreignObject', 'a', 'image', 'use', 'animate', 'set'] });
    const el = [...clean.childNodes].find(x => x.nodeName.toLowerCase() === 'svg');
    if (!el) return null;
    const out = document.importNode(el, true);
    applyStyles(out, true);
    return out;
  }

  function clone(node) {
    const c = node.cloneNode(true);
    applyStyles(c);
    return c;
  }
  function render(host, ...children) {
    while (host.firstChild) host.removeChild(host.firstChild);
    children.forEach(c => insertInto(host, c));
    return host;
  }
  function insertInto(host, c) {
    if (c === null || c === undefined || c === false || c === '') return;
    if (Array.isArray(c)) { c.forEach(x => insertInto(host, x)); return; }
    host.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function icon(id) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG_NS, 'use'); u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }
  // Text with every occurrence of the terms wrapped in <mark>.
  function marked(text, terms) {
    const frag = document.createDocumentFragment();
    const list = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!list.length) { frag.append(text); return frag; }
    const re = new RegExp(`(${list.join('|')})`, 'ig');
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const k = document.createElement('mark'); k.textContent = m[0]; frag.append(k);
      last = m.index + m[0].length;
      if (!m[0].length) re.lastIndex++;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  window.HN = { html, svg, content, contentSvg, clone, render, icon, marked, applyStyles };
})();
