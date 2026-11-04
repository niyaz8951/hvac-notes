#!/usr/bin/env node
/*
 * The quality check for HVAC Notes pages, run on a folder of pages before they are zipped for the Publish page.
 * Same rules as the Publish page (assets/js/lint.js, assets/js/indexer.js). Nothing is read from or sent to the site.
 *
 *   node tools/lint.mjs <folder>                 <folder> holds <notebook>/nav.json, <notebook>/<slug>.md,
 *                                                <notebook>/images/… and CREDITS.md (an export zip, unpacked)
 *   node tools/lint.mjs <folder> --before <index.json>   also compare with a published index (pages that vanished)
 *
 * Exit code 1 when there is an error. The page template is tools/page-template.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HVACIndex = require('../assets/js/indexer.js');
globalThis.HVACIndex = HVACIndex;
const { lint, split, TABS } = require('../assets/js/lint.js');

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) { console.log('Usage: node tools/lint.mjs <folder> [--before index.json]'); process.exit(2); }
const beforeAt = args.indexOf('--before');

async function walk(d) {
  const out = [];
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
const rel = p => path.relative(dir, p).split(path.sep).join('/');

const all = await walk(dir);
const files = new Set(), sizes = {}, navs = {}, mds = {};
let credits = '';
for (const f of all) {
  const r = rel(f), st = await fs.stat(f);
  if (r === 'CREDITS.md') { credits = await fs.readFile(f, 'utf8'); continue; }
  files.add(r); sizes[r] = st.size;
  if (/^[a-z0-9-]+\/nav\.json$/.test(r)) {
    try { const list = JSON.parse(await fs.readFile(f, 'utf8')); navs[r.split('/')[0]] = Array.isArray(list) ? list : []; }
    catch (e) { console.log(`✗ ${r}: not valid JSON (${e.message})`); process.exitCode = 1; }
  }
  if (/^[a-z0-9-]+\/[a-z0-9-]+\.md$/.test(r)) mds[r.replace(/\.md$/, '')] = await fs.readFile(f, 'utf8');
}
const order = [...TABS, ...Object.keys(navs).filter(t => !TABS.includes(t)).sort()];
const pages = [];
for (const tab of order) for (const meta of navs[tab] || []) if (meta && meta.slug && mds[`${tab}/${meta.slug}`] != null) pages.push({ tab, meta, md: mds[`${tab}/${meta.slug}`] });
const index = HVACIndex.build(pages);
const widgets = (await fs.readdir(path.join(ROOT, 'assets/js/widgets'))).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
let before = null;
if (beforeAt > 0) before = JSON.parse(await fs.readFile(args[beforeAt + 1], 'utf8'));

const issues = lint({ pages, navs, index, files, sizes, credits, before, widgets });
const { blocking, warnings } = split(issues, null);
for (const x of blocking) console.log(`✗ ${x.route}: ${x.msg}`);
for (const x of warnings) console.log(`· ${x.route}: ${x.msg}`);
console.log(`${index.pages.length} pages checked: ${blocking.length} error(s), ${warnings.length} warning(s).`);
if (blocking.length) process.exitCode = 1;
