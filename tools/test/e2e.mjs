// Browser test for HVAC Notes (test harness only). Needs tools/test/mock.mjs running on :8080 over a database built by
// tools/test/db.sh, and the invented library zipped at $FIXTURE (tools/test/run.sh does all of it).
// Publishes the invented library as demo_admin, reads it as demo_user, checks refusals for demo_none and for a reader on
// the Publish page, and fails on any console error or Content Security Policy report.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_ROOT ? process.env.PLAYWRIGHT_ROOT.replace(/\/?$/, '/') : import.meta.url);
const { chromium } = require('playwright');

const BASE = 'http://localhost:8080';
const FIXTURE = process.env.FIXTURE;
const PG = (process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d hvac').split(' ');
const sql = q => execFileSync('psql', [...PG, '-At', '-c', q], { encoding: 'utf8' }).trim();
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? '  ok ' : '  FAIL'} ${what}`); if (!cond) failed++; };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function session(user, scheme = 'light', width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.problems = [];
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.error('CSP ' + e.violatedDirective)));
  page.on('console', m => { if (m.type() === 'error' && !/status of 400|status of 401|status of 403/.test(m.text())) page.problems.push(m.text()); });
  page.on('pageerror', e => page.problems.push(e.message));
  await page.goto(BASE + '/dame-hub/');
  await page.fill('#si-email', user + '@example.com'); await page.fill('#si-pass', 'DemoPass2026');
  await Promise.all([page.waitForURL(/dashboard/), page.click('#signin button[type=submit]')]);
  return page;
}
const text = async (page, sel) => (await page.textContent(sel) || '').replace(/\s+/g, ' ');

// 1. the editor publishes the invented library
const admin = await session('demo_admin');
await admin.goto(BASE + '/hvac-notes/#/publish');          // Publish lives inside the reader
await admin.waitForSelector('#lib .badge');
await admin.setInputFiles('#zip', FIXTURE);
await admin.waitForSelector('#publish');
ok(/Pages added \(4\)/i.test(await text(admin, '#review')), 'publish plan lists 4 new pages');
ok(/No errors/.test(await text(admin, '#review')), 'invented library passes the check');
await admin.click('#publish'); await admin.click('.sheet .actions button.primary');
await admin.waitForFunction(() => /Version 1/.test(document.querySelector('#lib').textContent), null, { timeout: 20000 });
ok(sql("select version from hvac_notes.library") === '1', 'library is at version 1');
ok(sql("select count(*) from storage.objects where bucket_id = 'hvac-notes'") === '3', 'bucket holds the image, the index and the timeline');
// export, then the same zip again: nothing to publish
const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#export')]);
const back = FIXTURE.replace(/\.zip$/, '-export.zip'); await dl.saveAs(back);
await admin.setInputFiles('#zip', back);
await admin.waitForSelector('#review .notice');
ok(/Nothing to publish/.test(await text(admin, '#review')), 'the export uploaded again changes nothing');
ok(admin.problems.length === 0, 'Publish page: no console errors or CSP reports' + (admin.problems.length ? ': ' + admin.problems.join(' | ') : ''));

// 2. a reader
const user = await session('demo_user', 'dark');
await user.goto(BASE + '/hvac-notes/');
await user.waitForSelector('.shelf .book-item');
ok((await user.$$('.shelf .book-item')).length === 6, 'home shows the six notebook covers');
await user.goto(BASE + '/hvac-notes/#/theory/test-basics');
await user.waitForSelector('#book .katex');
await user.waitForFunction(() => { const i = document.querySelector('#book figure img'); return i && i.src.startsWith('blob:') && i.complete; }, null, { timeout: 10000 });
ok(true, 'page renders maths and loads its image from the private bucket');
ok(await user.$eval('#book', b => !b.querySelector('[style*="url("], script, iframe')), 'no script, iframe or style url in the page');
await user.fill('.w-prac input', '6'); await user.click('.w-prac ~ .w-bar .w-primary');
ok((await text(user, '.w-mark')).includes('✓'), 'practice problem: formula evaluated without eval, answer marked right');
ok((await user.$$('details.hn-check')).length === 1, 'Check yourself question shown');
await user.click('.src-ref button'); await user.waitForSelector('#sheet:not([hidden]) .src-peek');
ok(/Invented for testing/.test(await text(user, '.src-peek')), 'source reference opens its Sources item');
await user.click('#sheet [data-close]');
// a highlight
await user.evaluate(() => { const p = document.querySelector('#book > p:not(.page-meta)'); const t = p.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 14); getSelection().removeAllRanges(); getSelection().addRange(r); });
await user.waitForSelector('#hl-bar:not([hidden])'); await user.click('#hl-bar .swatch[data-c="blue"]');
await user.waitForTimeout(800);
ok(sql("select count(*) from hvac_notes.highlights h join core.profiles p on p.id = h.user_id where p.username = 'demo_user' and h.color = 'blue'") === '1', 'highlight saved for this reader');
await user.click('#book mark.hl'); await user.waitForSelector('#sheet:not([hidden]) #note-input');
ok(/seen by everyone/i.test(await text(user, '#sheet')), 'the highlight sheet says notes are shared');
await user.fill('#note-input', 'Invented note from the reader'); await user.waitForTimeout(1200);
await user.click('#sheet [data-close]');
ok(sql("select author || '|' || note from hvac_notes.highlights h join core.profiles p on p.id = h.user_id where p.username = 'demo_user'") === 'Demo User|Invented note from the reader', 'note saved with the author name');
// the second page: video card, prereq link
await user.goto(BASE + '/hvac-notes/#/theory/test-second');
await user.waitForSelector('#book .video-card');
ok(await user.$eval('#book .video-link', a => a.target === '_blank' && /^https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaaa&t=90s$/.test(a.href)), 'video card has a "Watch on YouTube" link');
ok(!(await user.$('iframe')), 'nothing loads from YouTube before the tap');
await user.route('https://www.youtube-nocookie.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' }));
await user.click('#book .video-card'); await user.waitForSelector('#book iframe');
ok(await user.$eval('#book iframe', f => f.src === 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?rel=0&playsinline=1&autoplay=1&start=90' && f.getAttribute('sandbox') === 'allow-scripts allow-same-origin allow-presentation allow-popups' && f.getAttribute('referrerpolicy') === 'strict-origin-when-cross-origin'), 'the tap loads the privacy-mode player with the checked id, sandboxed');
// explore widget with figures from the page
await user.goto(BASE + '/hvac-notes/#/chillers/test-wall');
await user.waitForSelector('.w-readout');
ok(/Invented rule when the wall is lower/.test(await text(user, '.widget')), 'explore widget is tile code and reads its figures from the page');
await user.click('#book a[href="#/chillers/terms/zeta-unit"]');
await user.waitForSelector('#sheet:not([hidden]) .kcard');
ok(/invented unit/.test(await text(user, '#sheet')), 'a link to a card opens the card in place');
await user.click('#sheet [data-close]');
// a card note
await user.goto(BASE + '/hvac-notes/#/chillers/terms');
await user.waitForSelector('.kcard[data-k="chillers/terms/zeta-unit"] .kcard-edit');
await user.click('.kcard[data-k="chillers/terms/zeta-unit"] .kcard-edit'); await user.waitForSelector('.fx .fx-note');
ok(/Zeta unit/.test(await text(user, '.fx .fx-title')), 'the card button opens focus mode on that card');
await user.click('.fx .fx-swatches [data-c="sage"]');
await user.fill('.fx .fx-note', 'Invented card note'); await user.waitForTimeout(1200);
await user.click('.fx [data-fx="done"]');
await user.waitForFunction(() => !document.querySelector('.fx'));
ok(sql("select author || '|' || note from hvac_notes.cards c join core.profiles p on p.id = c.user_id where p.username = 'demo_user'") === 'Demo User|Invented card note', 'card note saved with the author name');
// search
await user.keyboard.press('/'); await user.fill('#search-input', 'tqx');
await user.waitForSelector('#search-results a');
ok(/Test basics/.test(await text(user, '#search-results')), 'search finds a page by its keyword');
await user.keyboard.press('Escape');
await user.goto(BASE + '/hvac-notes/#/symptoms/chillers'); await user.waitForSelector('.large-title');
ok(/Troubleshooting/.test(await text(user, '.large-title')) && /Chillers/.test(await text(user, '.subtitle')), 'Troubleshooting is per notebook');
await user.goto(BASE + '/hvac-notes/#/terms');
await user.waitForSelector('.az-tiles li');
ok((await user.$$('.az-tiles li')).length === 2, 'All Terms lists the dictionary cards');
await user.goto(BASE + '/hvac-notes/#/timeline');
await user.waitForSelector('.tl-stats');
ok(true, 'timeline view opens');
await user.waitForTimeout(3000);
ok(+sql("select count(*) from hvac_notes.positions x join core.profiles p on p.id = x.user_id where p.username = 'demo_user'") >= 2, 'reading positions saved');
const wide = await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
ok(wide, 'no sideways scroll');
// a reader cannot publish
await user.goto(BASE + '/hvac-notes/publish.html');
await user.waitForSelector('.state h2');
ok(/Nothing here/.test(await text(user, 'main')), 'a reader gets "Nothing here" on the Publish page');
await user.goto(BASE + '/hvac-notes/#/publish'); await user.waitForSelector('main .empty');
ok(/Not Found/.test(await text(user, 'main')) && !(await user.$('#pub-host')), 'a reader gets nothing at #/publish in the reader');
const refused = await user.evaluate(async () => { try { await Api.rpc('hvac_notes_publish_export'); return 'allowed'; } catch (e) { return e.code; } });
ok(refused === 'NO_RIGHT', 'publish functions refuse a reader (NO_RIGHT)');
ok(user.problems.length === 0, 'reader: no console errors or CSP reports' + (user.problems.length ? ': ' + user.problems.join(' | ') : ''));

// 3. the editor sees the reader's highlight, note and card note with his name, and removes the highlight
await admin.goto(BASE + '/hvac-notes/#/theory/test-basics'); await admin.reload();
await admin.waitForSelector('#book mark.hl.other.has-note');
await admin.click('#book mark.hl.other'); await admin.waitForSelector('#sheet:not([hidden]) .sheet-by');
ok(/Demo User/.test(await text(admin, '#sheet .sheet-by')) && /Invented note from the reader/.test(await text(admin, '#sheet')), "another user's highlight shows its author and note");
// the editor answers; the reader sees the answer with the editor's name
await admin.fill('#sheet .reply-input', 'Invented answer from the admin'); await admin.click('#sheet .reply-form button');
await admin.waitForSelector('#sheet .reply');
ok(/Demo Admin/.test(await text(admin, '#sheet .reply')) && sql("select count(*) from hvac_notes.replies") === '1', 'reply saved with the author name');
ok(await admin.$eval('#book mark.hl.other', m => m.dataset.replies === '1'), 'the mark shows the reply count');
await admin.click('#sheet [data-close]');
await admin.goto(BASE + '/hvac-notes/#/discussions'); await admin.waitForSelector('#seg-ds');
await admin.click('#seg-ds [data-v="all"]');
ok(/Answered/.test(await text(admin, 'main')) && /Demo Admin/.test(await text(admin, 'main')), 'Discussions lists the thread as answered');
await user.goto(BASE + '/hvac-notes/#/theory/test-basics'); await user.reload(); await user.waitForSelector('#book mark.hl');
await user.click('#book mark.hl'); await user.waitForSelector('#sheet:not([hidden]) .reply');
ok(/Demo Admin\s*·.*Invented answer from the admin/.test(await text(user, '#sheet .reply')), "the reader sees the editor's answer under his highlight");
const noDel = await user.evaluate(async () => { try { await Api.rpc('hvac_notes_reply_delete', { p_id: 1 }); return 'allowed'; } catch (e) { return e.code; } });
ok(noDel === 'NOT_FOUND', "a reader cannot delete someone else's reply");
await user.click('#sheet [data-close]');
await admin.goto(BASE + '/hvac-notes/#/theory/test-basics'); await admin.waitForSelector('#book mark.hl.other');
await admin.click('#book mark.hl.other'); await admin.waitForSelector('#sheet:not([hidden]) .sheet-by');
await admin.click('#sheet [data-act="remove"]'); await admin.click('.sheet .actions button.danger');
await admin.waitForFunction(() => !document.querySelector('#book mark.hl.other'));
ok(sql("select count(*) from hvac_notes.highlights h join core.profiles p on p.id = h.user_id where p.username = 'demo_user'") === '0', "the editor removed the reader's highlight");
await admin.goto(BASE + '/hvac-notes/#/chillers/terms');
await admin.waitForSelector('.kcard[data-k="chillers/terms/zeta-unit"] .kcard-note.other');
ok(/Demo User\s*Invented card note/.test(await text(admin, '.kcard[data-k="chillers/terms/zeta-unit"] .kcard-note.other')), 'card note shows its author on the card');
await admin.goto(BASE + '/hvac-notes/#/notebook/chillers');
await admin.waitForSelector('#seg-who');
ok(/Demo User/.test(await text(admin, 'main')), 'notebook "Everyone" lists notes with names');
ok(admin.problems.length === 0, 'editor reading: no console errors or CSP reports' + (admin.problems.length ? ': ' + admin.problems.join(' | ') : ''));

// 4. phone width
const phone = await session('demo_user', 'light', 390);
await phone.goto(BASE + '/hvac-notes/#/theory/test-basics');
await phone.waitForSelector('#book .katex');
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone width 390 px: no sideways scroll');

// 5. no tile
const none = await session('demo_none');
await none.goto(BASE + '/hvac-notes/');
await none.waitForSelector('.state h2');
ok(/Nothing here/.test(await text(none, 'main')), 'a user without the tile gets "Nothing here"');
const r1 = await none.evaluate(async () => { try { await Api.rpc('hvac_notes_page', { p_tab: 'theory', p_slug: 'test-basics' }); return 'allowed'; } catch (e) { return e.code; } });
const r2 = await none.evaluate(async () => { try { await Api.file.download('hvac-notes', 'theory/images/test-diagram.svg'); return 'allowed'; } catch (e) { return e.code; } });
ok(r1 === 'NO_ACCESS' && r2 !== 'allowed', `a user without the tile cannot read pages (${r1}) or images (${r2})`);

await browser.close();
await fs.rm(back, { force: true });
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL BROWSER CHECKS PASSED');
process.exit(failed ? 1 : 0);
