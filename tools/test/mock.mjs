// Test harness only (not part of the delivery): serves /dame-hub/ and /hvac-notes/ like GitHub Pages and mimics
// Supabase Auth, PostgREST rpc and Storage on the same origin, backed by the local Postgres test database
// (tools/test/db.sh). Storage rows go into storage.objects as the signed-in user, so the bucket's real RLS policies
// decide; the bytes are kept in a temporary folder.
//   DAME=../dame-hub PGARGS="-h /tmp -p 5499 -U postgres -d hvac" node tools/test/mock.mjs [port]
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const tile = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hub = resolve(process.env.DAME || join(tile, '..', 'dame-hub'));
const port = Number(process.argv[2] || 8080);
const store = join(process.env.STORE || tmpdir(), 'hvac-notes-mock-store');
const PG = [...(process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d hvac').split(' '), '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };
const sessions = new Map();

function sql(q) {
  try { return { ok: true, out: execFileSync('psql', PG, { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim() }; }
  catch (e) {
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(e.stderr || '');
    return { ok: false, code: m ? m[1] : '?', message: m ? m[2].trim() : (e.stderr || '').trim() };
  }
}
const Q = '$hnmock7q$';
const lit = s => { const t = String(s); if (t.includes(Q)) throw new Error('quote tag in data'); return Q + t + Q; };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(user_id, session_id) { return 'x.' + b64({ sub: user_id, session_id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x'; }
function claims(req) {
  const m = /^Bearer x\.([^.]+)\.x$/.exec(req.headers.authorization || '');
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64url').toString()); } catch { return null; }
}
function session(user_id) {
  const session_id = randomUUID(), refresh_token = randomUUID();
  sessions.set(refresh_token, { user_id, session_id });
  sql(`insert into auth.sessions (id, user_id) values (${lit(session_id)}, ${lit(user_id)})`);   // as Supabase Auth (core 008)
  return { access_token: token(user_id, session_id), refresh_token, expires_in: 3600, token_type: 'bearer', user: { id: user_id } };
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); }
async function raw(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
async function body(req) { const t = (await raw(req)).toString(); try { return t ? JSON.parse(t) : {}; } catch { return {}; } }
const asUser = (c, q) => sql(`begin;\ndo $do$ begin perform set_config('request.jwt.claims', ${lit(c ? JSON.stringify(c) : '')}, true); end $do$;\nset local role ${c ? 'authenticated' : 'anon'};\n${q};\ncommit;`);
const lastLine = out => { const l = out.split('\n').filter(x => !/^(BEGIN|SET|COMMIT)$/.test(x)); return l; };

const fnCache = new Map();
function fnInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const r = sql(`select proretset, prorettype::regtype, coalesce(array_to_string(proargnames, ','), ''), array_to_string(proargtypes::regtype[], ',') from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace`);
  if (!r.ok || !r.out) return null;
  const [retset, rettype, names, argtypes] = r.out.split('|');
  const info = { retset: retset === 't', rettype, names: names ? names.split(',') : [], argtypes: argtypes ? argtypes.split(',') : [] };
  fnCache.set(name, info); return info;
}
function argExpr(j, name, type) {
  if (j[name] === null) return `${name} := null::${type}`;
  const v = `(${lit(JSON.stringify(j))}::jsonb -> ${lit(name)})`;
  if (type.endsWith('[]')) return `${name} := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${v}) x)::${type}`;
  if (type === 'jsonb') return `${name} := ${v}`;
  return `${name} := (${lit(JSON.stringify(j))}::jsonb ->> ${lit(name)})::${type}`;
}

async function auth(req, res, path, url) {
  if (path === '/auth/v1/token') {
    const b = await body(req);
    if (url.searchParams.get('grant_type') === 'password') {
      const r = sql(`select id from auth.users where email = ${lit(b.email)} and encrypted_password = extensions.crypt(${lit(b.password)}, encrypted_password)`);
      if (!r.ok || !r.out) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials' });
      return json(res, 200, session(r.out));
    }
    const s = sessions.get(b.refresh_token);
    if (!s) return json(res, 400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
    sessions.delete(b.refresh_token); const rt = randomUUID(); sessions.set(rt, s);
    return json(res, 200, { access_token: token(s.user_id, s.session_id), refresh_token: rt, expires_in: 3600, user: { id: s.user_id } });
  }
  if (path === '/auth/v1/logout') return json(res, 204);
  return json(res, 404, { message: 'no route' });
}

async function rpc(req, res, name) {
  const b = await body(req), c = claims(req);
  if (req.headers.authorization && !c) return json(res, 401, { message: 'JWT invalid', code: 'PGRST301' });
  const info = fnInfo(name);
  if (!info) return json(res, 404, { code: 'PGRST202', message: 'Could not find the function public.' + name });
  const args = info.names.map((n, i) => b[n] !== undefined ? argExpr(b, n, info.argtypes[i]) : null).filter(Boolean).join(', ');
  const call = `public.${name}(${args})`;
  const select = info.retset ? `select coalesce(jsonb_agg(r), '[]') from ${call} r` : info.rettype === 'void' ? `select ${call}` : `select to_jsonb(${call})`;
  const r = asUser(c, select);
  if (!r.ok) { if (process.env.MOCK_LOG) console.error('rpc', name, r.code, r.message.slice(0, 300)); return json(res, r.code === '42501' ? 403 : 400, { code: r.code, message: r.message, details: null, hint: null }); }
  const out = lastLine(r.out).pop() || 'null';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(info.rettype === 'void' ? '' : out);
}

const file = (bucket, name) => join(store, bucket, ...name.split('/'));
async function storage(req, res, path) {
  const c = claims(req);
  if (!c) return json(res, 401, { message: 'unauthorized' });
  let m;
  if ((m = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(path))) {
    const b = await body(req), prefix = b.prefix || '';
    const r = asUser(c, `select coalesce(jsonb_agg(name order by name), '[]') from storage.objects where bucket_id = ${lit(m[1])} and name like ${lit(prefix.replace(/[%_\\]/g, '\\$&') + '%')}`);
    if (!r.ok) return json(res, 400, { message: r.message });
    const names = JSON.parse(lastLine(r.out).pop() || '[]').map(n => n.slice(prefix.length)).filter(n => n && !n.includes('/'));
    return json(res, 200, names.map(n => ({ name: n, id: randomUUID(), metadata: {} })));
  }
  if ((m = /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/.exec(path)) && req.method === 'GET') {
    const [, bucket, name] = m;
    const r = asUser(c, `select count(*) from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(decodeURIComponent(name))}`);
    if (!r.ok || lastLine(r.out).pop() !== '1') return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const f = file(bucket, decodeURIComponent(name));
    const meta = JSON.parse(await readFile(f + '.meta', 'utf8').catch(() => '{}'));
    res.writeHead(200, { 'Content-Type': meta.type || 'application/octet-stream' }); return res.end(await readFile(f));
  }
  if ((m = /^\/storage\/v1\/object\/([^/]+)$/.exec(path)) && req.method === 'DELETE') {
    const b = await body(req), bucket = m[1], out = [];
    for (const p of b.prefixes || []) {
      const r = asUser(c, `delete from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(p)} returning name`);
      if (r.ok && lastLine(r.out).length) { out.push({ name: p }); await rm(file(bucket, p), { force: true }); await rm(file(bucket, p) + '.meta', { force: true }); }
    }
    return json(res, 200, out);
  }
  if ((m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path)) && (req.method === 'POST' || req.method === 'PUT')) {
    const [, bucket, enc] = m, name = decodeURIComponent(enc);
    const bytes = await raw(req);
    const exists = asUser(c, `select count(*) from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(name)}`);
    const has = exists.ok && lastLine(exists.out).pop() === '1';
    if (has && req.headers['x-upsert'] !== 'true') return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    const r = has ? asUser(c, `update storage.objects set metadata = '{}' where bucket_id = ${lit(bucket)} and name = ${lit(name)} returning name`)
      : asUser(c, `insert into storage.objects (bucket_id, name, owner) values (${lit(bucket)}, ${lit(name)}, ${lit(c.sub)}) returning name`);
    if (!r.ok || !lastLine(r.out).length) return json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    await mkdir(dirname(file(bucket, name)), { recursive: true });
    await writeFile(file(bucket, name), bytes);
    await writeFile(file(bucket, name) + '.meta', JSON.stringify({ type: req.headers['content-type'] || 'application/octet-stream', sha: createHash('sha256').update(bytes).digest('hex') }));
    return json(res, 200, { Key: `${bucket}/${name}` });
  }
  return json(res, 404, { message: 'no storage route' });
}

function root(id) {
  if (id === 'dame-hub') return hub;
  if (id === 'hvac-notes') return tile;
  return null;
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (path.startsWith('/auth/')) return await auth(req, res, path, url);
    const r = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
    if (r) return await rpc(req, res, r[1]);
    if (path.startsWith('/storage/')) return await storage(req, res, path);
    if (path === '/dame-hub/core/v1/config.js') {
      let src = await readFile(join(hub, 'core/v1/config.js'), 'utf8');
      src = src.replace(/url: 'https:\/\/[^']+'/, `url: 'http://localhost:${port}'`).replace(/key: 'sb_publishable_[^']+'/, "key: 'test'");
      res.writeHead(200, { 'Content-Type': types['.js'] }); return res.end(src);
    }
    const [, id, ...rest] = path.split('/');
    const base = root(id);
    if (!base) { res.writeHead(404); return res.end('404'); }
    let f = resolve(base, rest.join('/'));
    if (!f.startsWith(base)) { res.writeHead(404); return res.end('404'); }
    let info = await stat(f).catch(() => null);
    if (info && info.isDirectory()) { f = join(f, 'index.html'); info = await stat(f).catch(() => null); }
    if (!info) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(port, () => console.log(`mock on ${port}; dame-hub at ${hub}; store ${store}; ${existsSync(store) ? 'existing' : 'new'} store`));
