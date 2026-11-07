// HTTP check (test harness only): every function 006 changed or added, called as the page calls it, through
// POST /rest/v1/rpc/<name> on dame-hub's dev/test/mock-supabase.mjs (PostgREST stand-in), as read, contribute, edit and
// manage. Run after tools/test/e2e.mjs (it needs the published invented library) with mock-supabase.mjs on :8080 over
// the same database:  (cd ../dame-hub && PGARGS="-h /tmp -p 5499 -U postgres -d hvac" node dev/test/mock-supabase.mjs) &
import { execFileSync } from 'node:child_process';
const BASE = 'http://localhost:8080';
const PG = (process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d hvac').split(' ');
const sql = q => execFileSync('psql', [...PG, '-At', '-c', q], { encoding: 'utf8' }).trim();
let failed = 0, n = 0;
const ok = (cond, what) => { n++; console.log(`${cond ? '  ok ' : '  FAIL'} ${what}`); if (!cond) failed++; };

async function signIn(user) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user + '@example.com', password: 'DemoPass2026' }) });
  const t = (await r.json()).access_token;
  const call = async (name, args = {}) => {
    const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) { try { const e = JSON.parse(text); return { err: e.message || e.code, status: res.status }; } catch { return { err: text, status: res.status }; } }
    return text ? JSON.parse(text) : null;
  };
  await call('core_session_start');
  return call;
}
const level = (u, l) => sql(`update core.tile_access set level = '${l}' where tile_id = 'hvac-notes' and user_id = (select id from core.profiles where username = '${u}')`);
const q = { exact: 'invented words', prefix: '', suffix: '' };

const admin = await signIn('demo_admin'), user = await signIn('demo_user'), viewer = await signIn('demo_viewer');
const route = sql("select tab || '/' || slug from hvac_notes.pages where tab = 'theory' and status = 'approved' order by slug limit 1");
const [tab, slug] = route.split('/');

// manage
let v = await admin('hvac_notes_library');
ok(v.manager === true && v.editor === true && v.levels[tab] === 'manage' && v.sharing[tab] && 'everyone' in v.sharing[tab], 'manage: library has levels, editor, manager and sharing');
await admin('hvac_notes_highlight_save', { p_id: 'http01', p_tab: tab, p_slug: slug, p_title: 'T', p_color: 'yellow', p_note: 'admin note', p_quote: q });
v = await admin('hvac_notes_publish_export');
ok(v.manager === true && !('audience' in v) && Array.isArray(v.pages), 'manage: publish_export');
ok((await admin('hvac_notes_notebook_set', { p_tab: tab, p_audience: 'selected' })).status === 404, 'notebook_set is gone (404)');
ok(await admin('hvac_notes_file_write', { p_name: `${tab}/images/x.svg` }) === true && await admin('hvac_notes_file_remove', { p_name: `${tab}/images/x.svg` }) === true, 'manage: file_write and file_remove');

// read
v = await viewer('hvac_notes_library');
ok(v.levels[tab] === 'read' && v.editor === false && v.manager === false && JSON.stringify(v.sharing) === '{}', 'read: library levels');
ok((await viewer('hvac_notes_highlight_save', { p_id: 'http02', p_tab: tab, p_slug: slug, p_title: '', p_color: 'blue', p_note: '', p_quote: q })).err === 'NO_RIGHT', 'read: highlight_save NO_RIGHT');
ok((await viewer('hvac_notes_card_save', { p_key: `${tab}/${slug}/k`, p_title: 'K', p_color: 'mint', p_note: 'a note' })).err === 'NO_RIGHT', 'read: card note NO_RIGHT');
ok(typeof (await viewer('hvac_notes_card_save', { p_key: `${tab}/${slug}/k`, p_title: 'K', p_color: 'mint', p_note: '' })).id === 'number', 'read: card colour (private) saved');
ok((await viewer('hvac_notes_reply_save', { p_kind: 'highlight', p_ref: 'http01', p_body: 'x' })).err === 'NO_RIGHT', 'read: reply_save NO_RIGHT');
ok((await viewer('hvac_notes_publish_export')).err === 'NO_RIGHT' && (await viewer('hvac_notes_page_status', { p_routes: [route], p_status: 'draft' })).err === 'NO_RIGHT', 'read: publish_export and page_status NO_RIGHT');
v = await viewer('hvac_notes_my_import', { p_data: { highlights: [{ id: 'http03', tab, slug, color: 'blue', quote: q }] } });
ok(v.highlights === 0, 'read: my_import skips shared highlights');
ok(Array.isArray((await viewer('hvac_notes_index')).pages) && Array.isArray((await viewer('hvac_notes_growth')).days), 'read: index and growth');
ok(await viewer('hvac_notes_file_write', { p_name: `${tab}/images/x.svg` }) === false && await viewer('hvac_notes_file_open', { p_name: `${tab}/images/x.svg` }) === true, 'read: file_write false, file_open true');

// contribute
await user('hvac_notes_highlight_save', { p_id: 'http04', p_tab: tab, p_slug: slug, p_title: 'T', p_color: 'green', p_note: 'n', p_quote: q });
ok(sql("select count(*) from hvac_notes.highlights where id = 'http04'") === '1', 'contribute: highlight_save');
v = await user('hvac_notes_reply_save', { p_kind: 'highlight', p_ref: 'http01', p_body: 'a question' });
ok(typeof v.id === 'number', 'contribute: reply_save');
ok((await user('hvac_notes_highlight_delete', { p_id: 'http01' })).err === 'NOT_FOUND', "contribute: cannot remove someone else's highlight");
const adminReply = (await admin('hvac_notes_reply_save', { p_kind: 'highlight', p_ref: 'http04', p_body: 'an answer' })).id;
ok((await user('hvac_notes_reply_delete', { p_id: adminReply })).err === 'NOT_FOUND', "contribute: cannot remove someone else's reply");
const card = (await admin('hvac_notes_card_save', { p_key: `${tab}/${slug}/k2`, p_title: 'K2', p_color: null, p_note: 'admin card note' })).id;
ok((await user('hvac_notes_card_remove', { p_id: card })).err === 'NO_RIGHT', "contribute: card_remove NO_RIGHT");

// approve (not manage)
level('demo_user', 'approve');
ok((await user('hvac_notes_reply_delete', { p_id: adminReply })) === null && (await user('hvac_notes_card_remove', { p_id: card })) === null, 'approve: removes a reply and a card note');
ok((await user('hvac_notes_page_status', { p_routes: [route], p_status: 'draft' })).changed === 1 && (await user('hvac_notes_page_status', { p_routes: [route], p_status: 'approved' })).changed === 1, 'approve: hides and approves a page');
v = await user('hvac_notes_publish_export');
ok(v.manager === false, 'approve: publish_export (manager false)');
ok((await user('hvac_notes_publish_commit', { p_base: v.version, p_navs: {}, p_pages: [], p_remove: [], p_files: [], p_remove_files: ['x/images/y.svg'], p_credits: null, p_index: v.index, p_growth: v.growth })).err === 'NO_RIGHT', 'approve: whole-library removal NO_RIGHT');
ok(await user('hvac_notes_file_remove', { p_name: `${tab}/images/x.svg` }) === false && await user('hvac_notes_file_remove', { p_name: '_library/index-x.json' }) === true, 'approve: file_remove only the old library files');
level('demo_user', 'contribute');

// sharing through the core: private notebook, then back
await admin('core_share_set', { p_tile: 'hvac-notes', p_kind: 'notebook', p_id: tab, p_everyone: null, p_shares: [] });
v = await viewer('hvac_notes_library');
ok(v.closed.includes(tab) && !(tab in v.levels) && (await viewer('hvac_notes_page', { p_tab: tab, p_slug: slug })).err === 'NOT_FOUND', 'private notebook: closed for read, page NOT_FOUND');
ok(await viewer('hvac_notes_file_open', { p_name: `${tab}/images/x.svg` }) === false, 'private notebook: images refused');
ok((await user('hvac_notes_shared')).highlights.every(h => h.tab !== tab), 'private notebook: shared notes cut');
await admin('core_share_set', { p_tile: 'hvac-notes', p_kind: 'notebook', p_id: tab, p_everyone: 'edit', p_shares: [] });
ok((await viewer('hvac_notes_library')).levels[tab] === 'read', 'back to everyone');

// tidy what this check wrote
sql("delete from hvac_notes.highlights where id like 'http%'; delete from hvac_notes.cards where key like '%/k' or key like '%/k2'; delete from hvac_notes.replies where body in ('a question', 'an answer')");
console.log(failed ? `${failed} OF ${n} HTTP CHECK(S) FAILED` : `ALL ${n} HTTP CHECKS PASSED`);
process.exit(failed ? 1 : 0);
