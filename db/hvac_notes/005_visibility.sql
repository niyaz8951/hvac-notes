-- HVAC Notes tile: who sees which notebook and page (owner decision 2026-11-06).
-- Run as the owner in the Supabase SQL editor after 004_names_no_temp.sql. Read it first.
-- Touches only: schema hvac_notes (new table notebooks; new columns on pages and library; helper functions),
-- functions public.hvac_notes_* (replaces library, page, pages, shared, highlight_save, card_save, reply_save,
-- publish_export, publish_commit; adds index, growth, page_status, notebook_set, file_open), the bucket's policies.
--
-- Notebook level: a notebook is open to everyone with the tile ('all', the default) or to selected users ('selected'):
--   those who hold the tile right nb_<notebook> (nb_chillers, nb_ahu, ...), given on the DAME admin page.
--   Selected with nobody given the right = hidden. Images of a closed notebook are not served either.
-- Page level: a page is 'draft' or 'approved'. A new page arrives as a draft; the tile admin (or the super user)
--   approves it and it opens to everyone who can see its notebook. Hide sends it back to draft. A change to an
--   approved page goes live at once (no second approval). All pages published before this file stay approved.
-- Who sees everything (drafts and closed notebooks): the right 'edit', tile admins and the super user.
-- Links: a page's home decides. A linked chapter, prereq, related page, search entry, card, symptom, check question,
--   timeline item, highlight, card note or reply of a page the caller cannot see is not sent to him.
-- The search index and the timeline move from the bucket (_library/*.json, readable by anyone with the tile) into the
--   database, where every read is filtered. Until the owner presses "Move now" on the Publish page (or publishes),
--   readers get no stored index (the reader builds it from the pages it may read) and no timeline; the old files
--   become readable by 'edit' only from this file on.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Notebooks open to selected users only. No row = everyone with the tile.
create table hvac_notes.notebooks (
  tab        text primary key check (tab ~ '^[a-z0-9-]{1,30}$'),
  audience   text not null check (audience in ('all', 'selected')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table hvac_notes.notebooks enable row level security;

-- Page status (every existing page: approved), its index entry and its place in the index.
alter table hvac_notes.pages add column status text not null default 'approved' check (status in ('draft', 'approved'));
alter table hvac_notes.pages alter column status set default 'draft';
alter table hvac_notes.pages add column approved_at timestamptz;
alter table hvac_notes.pages add column approved_by uuid;
alter table hvac_notes.pages add column idx jsonb check (idx is null or (jsonb_typeof(idx) = 'object' and octet_length(idx::text) <= 2000000));
alter table hvac_notes.pages add column ord integer;
update hvac_notes.pages set approved_at = now() where status = 'approved' and approved_at is null;

-- The growth timeline, in the database.
alter table hvac_notes.library add column growth jsonb check (growth is null or jsonb_typeof(growth) = 'object');

-- ---------------------------------------------------------------------------
-- 2. Helpers (schema hvac_notes: not reachable through the API; used by the functions below, which run as the owner)
-- ---------------------------------------------------------------------------

-- The tile right that opens a 'selected' notebook: nb_<notebook>, hyphens as underscores.
create or replace function hvac_notes.tab_right(p_tab text)
returns text language sql immutable set search_path = '' as $$ select 'nb_' || replace(p_tab, '-', '_') $$;

-- Sees every notebook and every draft: the right 'edit', a tile admin, the super user.
create or replace function hvac_notes.sees_all(p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select core.is_tile_admin(p_user, 'hvac-notes') or core.has_tile(p_user, 'hvac-notes', 'edit') $$;

create or replace function hvac_notes.tab_open(p_user uuid, p_tab text)
returns boolean language sql stable set search_path = '' as $$
  select hvac_notes.sees_all(p_user)
      or coalesce((select n.audience from hvac_notes.notebooks n where n.tab = p_tab), 'all') = 'all'
      or core.has_tile(p_user, 'hvac-notes', hvac_notes.tab_right(p_tab)) $$;

create or replace function hvac_notes.open_tabs(p_user uuid)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(t.tab order by t.tab), '{}') from (
    select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p union select n.tab from hvac_notes.notebooks n) t
  where hvac_notes.tab_open(p_user, t.tab) $$;

-- Routes ("tab/slug") of the pages the user may read.
create or replace function hvac_notes.visible_routes(p_user uuid)
returns text[] language sql stable set search_path = '' as $$
  with a as materialized (select hvac_notes.sees_all(p_user) as all_, hvac_notes.open_tabs(p_user) as tabs)
  select coalesce(array_agg(p.tab || '/' || p.slug order by p.tab, p.slug), '{}')
  from hvac_notes.pages p cross join a
  where a.all_ or (p.status = 'approved' and p.tab = any (a.tabs)) $$;

create or replace function hvac_notes.can_see(p_user uuid, p_tab text, p_slug text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from hvac_notes.pages p where p.tab = p_tab and p.slug = p_slug
    and (hvac_notes.sees_all(p_user) or (p.status = 'approved' and hvac_notes.tab_open(p_user, p.tab)))) $$;

-- A JSON list of routes, keeping only those in p_vis.
create or replace function hvac_notes.keep_routes(p jsonb, p_vis text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) from jsonb_array_elements(p) with ordinality x(v, o)
  where jsonb_typeof(x.v) = 'string' and (x.v #>> '{}') = any (p_vis) $$;

-- A notebook's nav.json for a reader: entries of pages he cannot read (own pages and linked chapters) left out,
-- and prereq / related lists cut to the pages he can read.
create or replace function hvac_notes.nav_for(p_tab text, p_nav text, p_vis text[])
returns text language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x.e || jsonb_strip_nulls(jsonb_build_object(
      'prereq', case when jsonb_typeof(x.e -> 'prereq') = 'array' then hvac_notes.keep_routes(x.e -> 'prereq', p_vis) end,
      'related', case when jsonb_typeof(x.e -> 'related') = 'array' then hvac_notes.keep_routes(x.e -> 'related', p_vis) end))
    order by x.o), '[]'::jsonb)::text
  from jsonb_array_elements(p_nav::jsonb) with ordinality x(e, o)
  where jsonb_typeof(x.e) = 'object'
    and case when jsonb_typeof(x.e -> 'link') = 'string' then (x.e ->> 'link') = any (p_vis)
             when jsonb_typeof(x.e -> 'slug') = 'string' then (p_tab || '/' || (x.e ->> 'slug')) = any (p_vis)
             else false end $$;

-- A page's index entry for a reader: "links" cut to the pages he can read.
create or replace function hvac_notes.idx_for(p_idx jsonb, p_vis text[])
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_set(p_idx, '{links}', case when jsonb_typeof(p_idx -> 'links') = 'array' then hvac_notes.keep_routes(p_idx -> 'links', p_vis) else '[]'::jsonb end) $$;

revoke execute on function hvac_notes.tab_right(text), hvac_notes.sees_all(uuid), hvac_notes.tab_open(uuid, text),
  hvac_notes.open_tabs(uuid), hvac_notes.visible_routes(uuid), hvac_notes.can_see(uuid, text, text),
  hvac_notes.keep_routes(jsonb, text[]), hvac_notes.nav_for(text, text, text[]), hvac_notes.idx_for(jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reading
-- ---------------------------------------------------------------------------

-- The library: version and every notebook's nav the caller may read.
--   editor   sees drafts and closed notebooks (nav as published);   approver  may approve, hide and set notebooks
--   drafts   routes of draft pages (editors only);                  audience  { "<tab>": "selected" } (editors only)
--   closed   notebooks closed to this caller (readers only), so the reader leaves them off the shelf
create or replace function public.hvac_notes_library()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library; v_tabs text[]; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_lib from hvac_notes.library l where l.id = 1;
  if hvac_notes.sees_all(v_user.id) then
    return jsonb_build_object(
      'version', v_lib.version, 'published_at', v_lib.published_at,
      'navs', coalesce((select jsonb_object_agg(s.tab, s.nav) from hvac_notes.sections s), '{}'::jsonb),
      'editor', true, 'approver', core.is_tile_admin(v_user.id, 'hvac-notes'),
      'drafts', coalesce((select jsonb_agg(p.tab || '/' || p.slug order by p.tab, p.slug) from hvac_notes.pages p where p.status = 'draft'), '[]'::jsonb),
      'audience', coalesce((select jsonb_object_agg(n.tab, n.audience) from hvac_notes.notebooks n where n.audience <> 'all'), '{}'::jsonb),
      'closed', '[]'::jsonb);
  end if;
  v_tabs := hvac_notes.open_tabs(v_user.id);
  v_vis := hvac_notes.visible_routes(v_user.id);
  return jsonb_build_object(
    'version', v_lib.version, 'published_at', v_lib.published_at,
    'navs', coalesce((select jsonb_object_agg(s.tab, hvac_notes.nav_for(s.tab, s.nav, v_vis)) from hvac_notes.sections s
      where s.tab = any (v_tabs)), '{}'::jsonb),
    'editor', false, 'approver', false, 'drafts', '[]'::jsonb, 'audience', '{}'::jsonb,
    'closed', coalesce((select jsonb_agg(n.tab order by n.tab) from hvac_notes.notebooks n
      where n.audience = 'selected' and not (n.tab = any (v_tabs))), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_library() from public, anon;
grant execute on function public.hvac_notes_library() to authenticated;

-- One page's Markdown (NOT_FOUND for a page the caller cannot read). status: 'draft' or 'approved'.
create or replace function public.hvac_notes_page(p_tab text, p_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_page hvac_notes.pages;
begin
  v_user := core.require_tile('hvac-notes', null);
  if not hvac_notes.can_see(v_user.id, p_tab, p_slug) then raise exception 'NOT_FOUND'; end if;
  select * into v_page from hvac_notes.pages p where p.tab = p_tab and p.slug = p_slug;
  return jsonb_build_object('md', v_page.md, 'updated_at', v_page.updated_at, 'status', v_page.status);
end $$;
revoke execute on function public.hvac_notes_page(text, text) from public, anon;
grant execute on function public.hvac_notes_page(text, text) to authenticated;

-- Several pages at once (routes "tab/slug"; null = every page the caller may read).
create or replace function public.hvac_notes_pages(p_routes text[])
returns table (tab text, slug text, md text)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_routes is not null and cardinality(p_routes) > 300 then raise exception 'INVALID:routes'; end if;
  v_vis := hvac_notes.visible_routes(v_user.id);
  return query
    select p.tab, p.slug, p.md from hvac_notes.pages p
    where (p.tab || '/' || p.slug) = any (v_vis)
      and (p_routes is null or (p.tab || '/' || p.slug) = any (p_routes))
    order by p.tab, p.slug;
end $$;
revoke execute on function public.hvac_notes_pages(text[]) from public, anon;
grant execute on function public.hvac_notes_pages(text[]) to authenticated;

-- The search index of the pages the caller may read ({ v, pages: [...] } in reading order), or null while the index
-- is still in the old bucket file (before the move; the reader then builds it from the pages).
create or replace function public.hvac_notes_index()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_all boolean; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  if (select l.index_path from hvac_notes.library l where l.id = 1) is not null then return null; end if;
  v_all := hvac_notes.sees_all(v_user.id);
  v_vis := hvac_notes.visible_routes(v_user.id);
  return jsonb_build_object('v', 1, 'pages', coalesce((
    select jsonb_agg(case when v_all then p.idx else hvac_notes.idx_for(p.idx, v_vis) end order by p.ord nulls last, p.tab, p.slug)
    from hvac_notes.pages p where p.idx is not null and (p.tab || '/' || p.slug) = any (v_vis)), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_index() from public, anon;
grant execute on function public.hvac_notes_index() to authenticated;

-- The growth timeline ({ v, days: [{ date, items }] }) with only the items of pages the caller may read (and their old
-- names); days left empty are dropped. Null until the timeline is in the database.
create or replace function public.hvac_notes_growth()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_g jsonb; v_vis text[]; v_ok text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  select l.growth into v_g from hvac_notes.library l where l.id = 1;
  if v_g is null then return null; end if;
  if hvac_notes.sees_all(v_user.id) then return v_g; end if;
  v_vis := hvac_notes.visible_routes(v_user.id);
  v_ok := v_vis || coalesce((
    select array_agg(case when position('/' in a.a) > 0 then a.a else s.tab || '/' || a.a end)
    from hvac_notes.sections s
    cross join lateral jsonb_array_elements(s.nav::jsonb) e(e)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(e.e) = 'object' and jsonb_typeof(e.e -> 'aliases') = 'array'
                                                      then e.e -> 'aliases' else '[]'::jsonb end) a(a)
    where (s.tab || '/' || (e.e ->> 'slug')) = any (v_vis)), '{}');
  return jsonb_build_object('v', 1, 'days', coalesce((
    select jsonb_agg(d.day order by d.o) from (
      select jsonb_set(x.e, '{items}', (select jsonb_agg(y.i order by y.io) from jsonb_array_elements(x.e -> 'items') with ordinality y(i, io)
                                         where jsonb_typeof(y.i) = 'object' and (y.i ->> 'route') = any (v_ok))) as day, x.o
      from jsonb_array_elements(v_g -> 'days') with ordinality x(e, o)
      where jsonb_typeof(x.e) = 'object' and jsonb_typeof(x.e -> 'items') = 'array') d
    where d.day is not null), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_growth() from public, anon;
grant execute on function public.hvac_notes_growth() to authenticated;

-- Everyone else's highlights and card notes and the replies, as in 004, but only on pages the caller may read.
create or replace function public.hvac_notes_shared()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  v_vis := hvac_notes.visible_routes(v_user.id);
  return (
    with names as materialized (
      -- the 500 most recently active authors (the core's limit); anyone beyond keeps the saved name
      select d.id, d.display_name from core.display_names('hvac-notes', (
        select array_agg(u.id) from (
          select x.user_id as id from (
            select h.user_id, h.updated_at as at from hvac_notes.highlights h
            union all select c.user_id, c.updated_at from hvac_notes.cards c where c.note <> ''
            union all select r.user_id, r.created_at from hvac_notes.replies r) x
          group by x.user_id order by max(x.at) desc limit 500) u)) d),
    hl as materialized (
      select h.id from hvac_notes.highlights h where (h.tab || '/' || h.slug) = any (v_vis)),
    cd as materialized (
      select c.id::text as id from hvac_notes.cards c
      where c.note <> '' and (split_part(c.key, '/', 1) || '/' || split_part(c.key, '/', 2)) = any (v_vis))
    select jsonb_build_object(
      'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tab', x.tab, 'slug', x.slug, 'title', x.title,
          'color', x.color, 'note', x.note, 'quote', x.quote, 'by', coalesce(n.display_name, x.author),
          'created', x.created_at, 'updated', x.updated_at) order by x.updated_at desc)
        from (select * from hvac_notes.highlights h where h.user_id <> v_user.id and h.id in (select hl.id from hl)
              order by h.updated_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'key', x.key, 'title', x.title, 'note', x.note,
          'by', coalesce(n.display_name, x.author), 'updated', x.updated_at) order by x.updated_at desc)
        from (select * from hvac_notes.cards c where c.user_id <> v_user.id and c.id::text in (select cd.id from cd)
              order by c.updated_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb),
      'replies', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'ref', x.ref, 'body', x.body,
          'by', coalesce(n.display_name, x.author), 'mine', x.user_id = v_user.id, 'created', x.created_at) order by x.created_at desc)
        from (select * from hvac_notes.replies r
              where (r.kind = 'highlight' and r.ref in (select hl.id from hl)) or (r.kind = 'card' and r.ref in (select cd.id from cd))
              order by r.created_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb)));
end $$;
revoke execute on function public.hvac_notes_shared() from public, anon;
grant execute on function public.hvac_notes_shared() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Writing notes: only on pages the caller may read (otherwise NOT_FOUND). Bodies otherwise as in 001 / 002.
-- ---------------------------------------------------------------------------

create or replace function public.hvac_notes_highlight_save(p_id text, p_tab text, p_slug text, p_title text,
  p_color text, p_note text, p_quote jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_n integer;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_id is null or p_id !~ '^[a-z0-9]{4,32}$' then raise exception 'INVALID:id'; end if;
  if p_tab is null or p_tab !~ '^[a-z0-9-]{1,30}$' or p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then raise exception 'INVALID:route'; end if;
  if p_color is null or p_color not in ('yellow', 'green', 'blue', 'pink', 'purple') then raise exception 'INVALID:color'; end if;
  if char_length(coalesce(p_note, '')) > 5000 then raise exception 'INVALID:note'; end if;
  if p_quote is null or jsonb_typeof(p_quote) <> 'object' or char_length(coalesce(p_quote ->> 'exact', '')) not between 1 and 5000
     or octet_length(p_quote::text) > 12000 then raise exception 'INVALID:quote'; end if;
  if not hvac_notes.can_see(v_user.id, p_tab, p_slug) then raise exception 'NOT_FOUND'; end if;
  select count(*) into v_n from hvac_notes.highlights h where h.user_id = v_user.id;
  if v_n >= 5000 and not exists (select 1 from hvac_notes.highlights h where h.user_id = v_user.id and h.id = p_id) then
    raise exception 'INVALID:highlights';
  end if;
  insert into hvac_notes.highlights (id, user_id, author, tab, slug, title, color, note, quote)
  values (p_id, v_user.id, v_user.display_name, p_tab, p_slug, left(coalesce(p_title, ''), 200), p_color, coalesce(p_note, ''),
          jsonb_build_object('exact', p_quote ->> 'exact', 'prefix', left(coalesce(p_quote ->> 'prefix', ''), 200),
                             'suffix', left(coalesce(p_quote ->> 'suffix', ''), 200)))
  on conflict (id) do update
    set author = excluded.author, tab = excluded.tab, slug = excluded.slug, title = excluded.title, color = excluded.color,
        note = excluded.note, quote = excluded.quote, updated_at = now()
    where hvac_notes.highlights.user_id = v_user.id;
  if not found then raise exception 'INVALID:id'; end if;
end $$;
revoke execute on function public.hvac_notes_highlight_save(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.hvac_notes_highlight_save(text, text, text, text, text, text, jsonb) to authenticated;

-- Colour and note on a card (as in 002). Clearing both removes the row, wherever its page is.
create or replace function public.hvac_notes_card_save(p_key text, p_title text, p_color text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_note text := trim(coalesce(p_note, '')); v_id bigint;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_key is null or p_key !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}/[a-z0-9-]{1,120}$' then raise exception 'INVALID:key'; end if;
  if p_color is not null and p_color not in ('coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay') then
    raise exception 'INVALID:color';
  end if;
  if char_length(v_note) > 5000 then raise exception 'INVALID:note'; end if;
  select c.id into v_id from hvac_notes.cards c where c.user_id = v_user.id and c.key = p_key;
  if v_note = '' and v_id is not null then delete from hvac_notes.replies r where r.kind = 'card' and r.ref = v_id::text; end if;
  if p_color is null and v_note = '' then
    delete from hvac_notes.cards c where c.user_id = v_user.id and c.key = p_key;
    return jsonb_build_object('id', null);
  end if;
  if not hvac_notes.can_see(v_user.id, split_part(p_key, '/', 1), split_part(p_key, '/', 2)) then raise exception 'NOT_FOUND'; end if;
  if v_id is null and (select count(*) from hvac_notes.cards c where c.user_id = v_user.id) >= 5000 then raise exception 'INVALID:cards'; end if;
  insert into hvac_notes.cards (user_id, author, key, title, color, note)
  values (v_user.id, v_user.display_name, p_key, left(coalesce(p_title, ''), 200), p_color, v_note)
  on conflict (user_id, key) do update
    set author = excluded.author, title = excluded.title, color = excluded.color, note = excluded.note, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.hvac_notes_card_save(text, text, text, text) from public, anon;
grant execute on function public.hvac_notes_card_save(text, text, text, text) to authenticated;

-- Reply under a highlight or card note on a page the caller may read.
create or replace function public.hvac_notes_reply_save(p_kind text, p_ref text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_body text := trim(coalesce(p_body, '')); v_id bigint;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_kind is null or p_kind not in ('highlight', 'card') then raise exception 'INVALID:kind'; end if;
  if p_ref is null or p_ref !~ '^[a-z0-9]{1,32}$' then raise exception 'INVALID:ref'; end if;
  if char_length(v_body) not between 1 and 5000 then raise exception 'INVALID:body'; end if;
  if p_kind = 'highlight' and not exists (select 1 from hvac_notes.highlights h where h.id = p_ref
       and hvac_notes.can_see(v_user.id, h.tab, h.slug)) then raise exception 'NOT_FOUND'; end if;
  if p_kind = 'card' and (p_ref !~ '^[0-9]{1,18}$' or not exists (select 1 from hvac_notes.cards c where c.id = p_ref::bigint and c.note <> ''
       and hvac_notes.can_see(v_user.id, split_part(c.key, '/', 1), split_part(c.key, '/', 2)))) then
    raise exception 'NOT_FOUND';
  end if;
  if (select count(*) from hvac_notes.replies r where r.user_id = v_user.id) >= 20000 then raise exception 'INVALID:replies'; end if;
  insert into hvac_notes.replies (kind, ref, user_id, author, body) values (p_kind, p_ref, v_user.id, v_user.display_name, v_body)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'by', v_user.display_name, 'created', now());
end $$;
revoke execute on function public.hvac_notes_reply_save(text, text, text) from public, anon;
grant execute on function public.hvac_notes_reply_save(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Approving pages and opening notebooks (tile admin or super user, audited)
-- ---------------------------------------------------------------------------

-- Approve pages (they open to everyone who can see their notebook) or hide them again (back to draft).
-- Returns how many changed. An unknown page: NOT_FOUND (nothing changes).
create or replace function public.hvac_notes_page_status(p_routes text[], p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r text; v_n integer := 0; v_changed text[] := '{}';
begin
  v_user := core.require_tile('hvac-notes', null);
  if not core.is_tile_admin(v_user.id, 'hvac-notes') then raise exception 'NO_RIGHT'; end if;
  if p_status is null or p_status not in ('draft', 'approved') then raise exception 'INVALID:status'; end if;
  if p_routes is null or cardinality(p_routes) not between 1 and 300 then raise exception 'INVALID:routes'; end if;
  foreach v_r in array p_routes loop
    if v_r is null or not exists (select 1 from hvac_notes.pages p where (p.tab || '/' || p.slug) = v_r) then raise exception 'NOT_FOUND'; end if;
  end loop;
  update hvac_notes.pages p
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() end,
         approved_by = case when p_status = 'approved' then v_user.id end
   where (p.tab || '/' || p.slug) = any (p_routes) and p.status <> p_status;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform core.audit('hvac-notes', case when p_status = 'approved' then 'page_approved' else 'page_hidden' end,
      jsonb_build_object('pages', to_jsonb(p_routes), 'changed', v_n));
  end if;
  return jsonb_build_object('status', p_status, 'changed', v_n);
end $$;
revoke execute on function public.hvac_notes_page_status(text[], text) from public, anon;
grant execute on function public.hvac_notes_page_status(text[], text) to authenticated;

-- A notebook for everyone with the tile ('all') or for selected users ('selected': the right nb_<notebook>).
-- Returns the right's name, which the super user lists on the tile in the admin page.
create or replace function public.hvac_notes_notebook_set(p_tab text, p_audience text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_right text;
begin
  v_user := core.require_tile('hvac-notes', null);
  if not core.is_tile_admin(v_user.id, 'hvac-notes') then raise exception 'NO_RIGHT'; end if;
  if p_tab is null or p_tab !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:tab'; end if;
  v_right := hvac_notes.tab_right(p_tab);
  if v_right !~ '^[a-z][a-z0-9_]{1,19}$' then raise exception 'INVALID:tab'; end if;   -- the core's rule for right names
  if p_audience is null or p_audience not in ('all', 'selected') then raise exception 'INVALID:audience'; end if;
  if p_audience = 'all' then
    delete from hvac_notes.notebooks n where n.tab = p_tab;
  else
    insert into hvac_notes.notebooks (tab, audience, updated_by) values (p_tab, p_audience, v_user.id)
    on conflict (tab) do update set audience = excluded.audience, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  perform core.audit('hvac-notes', 'notebook_audience', jsonb_build_object('notebook', p_tab, 'audience', p_audience, 'right', v_right));
  return jsonb_build_object('tab', p_tab, 'audience', p_audience, 'right', v_right);
end $$;
revoke execute on function public.hvac_notes_notebook_set(text, text) from public, anon;
grant execute on function public.hvac_notes_notebook_set(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Publishing (right 'edit'): the index and timeline now come with the commit
-- ---------------------------------------------------------------------------

-- Everything as published, for the Publish page and the export zip.
--   index   { v, pages } of every page, or null while it is still in the old bucket file (index_path) or nothing is published
--   growth  the timeline, or null while it is still in the old bucket file (growth_path)
--   status  { "<tab>/<slug>": "draft" } for drafts;  audience  { "<tab>": "selected" }
create or replace function public.hvac_notes_publish_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library;
begin
  v_user := core.require_tile('hvac-notes', 'edit');
  select * into v_lib from hvac_notes.library l where l.id = 1;
  return jsonb_build_object(
    'version', v_lib.version, 'published_at', v_lib.published_at, 'credits', v_lib.credits,
    'index_path', v_lib.index_path, 'growth_path', v_lib.growth_path,
    'navs', coalesce((select jsonb_object_agg(s.tab, s.nav) from hvac_notes.sections s), '{}'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('tab', p.tab, 'slug', p.slug, 'md', p.md) order by p.tab, p.slug)
      from hvac_notes.pages p), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'size', f.size, 'sha', f.sha) order by f.path)
      from hvac_notes.files f), '[]'::jsonb),
    'index', case when v_lib.index_path is null and exists (select 1 from hvac_notes.pages p where p.idx is not null)
      then jsonb_build_object('v', 1, 'pages', (select jsonb_agg(p.idx order by p.ord nulls last, p.tab, p.slug)
        from hvac_notes.pages p where p.idx is not null)) end,
    'growth', v_lib.growth,
    'status', coalesce((select jsonb_object_agg(p.tab || '/' || p.slug, p.status) from hvac_notes.pages p where p.status = 'draft'), '{}'::jsonb),
    'audience', coalesce((select jsonb_object_agg(n.tab, n.audience) from hvac_notes.notebooks n where n.audience <> 'all'), '{}'::jsonb),
    'approver', core.is_tile_admin(v_user.id, 'hvac-notes'));
end $$;
revoke execute on function public.hvac_notes_publish_export() from public, anon;
grant execute on function public.hvac_notes_publish_export() to authenticated;

-- One publish, all or nothing (as in 001), now carrying the whole index and timeline:
--   p_index  { v, pages: [ { tab, slug, ... } ] }   every page's index entry, in reading order
--   p_growth { v, days: [...] }                      the whole timeline
-- New pages arrive as drafts; changed pages keep their status. The old bucket paths are cleared (the Publish page
-- deletes those files after this succeeds). A commit with no page changes is how the index and timeline are moved.
drop function public.hvac_notes_publish_commit(integer, jsonb, jsonb, text[], jsonb, text[], text, text, text);
create function public.hvac_notes_publish_commit(p_base integer, p_navs jsonb, p_pages jsonb, p_remove text[],
  p_files jsonb, p_remove_files text[], p_credits text, p_index jsonb, p_growth jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library; v_k text; v_v jsonb; v_p jsonb; v_o bigint; v_r text;
  n_pages integer := 0; n_removed integer := 0; n_files integer := 0; n_drafts integer;
begin
  v_user := core.require_tile('hvac-notes', 'edit');
  select * into v_lib from hvac_notes.library l where l.id = 1 for update;
  if p_base is null or p_base <> v_lib.version then raise exception 'INVALID:version'; end if;
  if p_index is null or jsonb_typeof(p_index) <> 'object' or jsonb_typeof(p_index -> 'pages') is distinct from 'array'
     or jsonb_array_length(p_index -> 'pages') > 2000 then raise exception 'INVALID:index'; end if;
  if p_growth is null or jsonb_typeof(p_growth) <> 'object' or jsonb_typeof(p_growth -> 'days') is distinct from 'array'
     or octet_length(p_growth::text) > 20000000 then raise exception 'INVALID:growth'; end if;
  if p_credits is not null and char_length(p_credits) > 100000 then raise exception 'INVALID:credits'; end if;

  -- notebooks (nav.json)
  if p_navs is not null then
    if jsonb_typeof(p_navs) <> 'object' then raise exception 'INVALID:navs'; end if;
    for v_k, v_v in select * from jsonb_each(p_navs) loop
      if v_k !~ '^[a-z0-9-]{1,30}$' then raise exception 'INVALID:navs'; end if;
      if jsonb_typeof(v_v) = 'null' then
        delete from hvac_notes.sections s where s.tab = v_k;
        continue;
      end if;
      if jsonb_typeof(v_v) <> 'string' or char_length(v_v #>> '{}') > 200000 then raise exception 'INVALID:navs'; end if;
      begin
        if jsonb_typeof((v_v #>> '{}')::jsonb) <> 'array' then raise exception 'INVALID:navs'; end if;
      exception when invalid_text_representation then raise exception 'INVALID:navs';
      end;
      insert into hvac_notes.sections (tab, nav) values (v_k, v_v #>> '{}')
      on conflict (tab) do update set nav = excluded.nav, updated_at = now()
      where hvac_notes.sections.nav is distinct from excluded.nav;
    end loop;
  end if;

  -- pages (a new page is a draft; a changed page keeps its status)
  if p_pages is not null then
    if jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) > 1000 then raise exception 'INVALID:pages'; end if;
    for v_p in select * from jsonb_array_elements(p_pages) loop
      if coalesce(v_p ->> 'tab', '') !~ '^[a-z0-9-]{1,30}$' or coalesce(v_p ->> 'slug', '') !~ '^[a-z0-9-]{1,80}$'
         or jsonb_typeof(v_p -> 'md') is distinct from 'string' or char_length(v_p ->> 'md') > 400000 then
        raise exception 'INVALID:pages';
      end if;
      insert into hvac_notes.pages (tab, slug, md) values (v_p ->> 'tab', v_p ->> 'slug', v_p ->> 'md')
      on conflict (tab, slug) do update set md = excluded.md, updated_at = now()
      where hvac_notes.pages.md is distinct from excluded.md;
      n_pages := n_pages + 1;
    end loop;
  end if;
  foreach v_r in array coalesce(p_remove, '{}'::text[]) loop
    delete from hvac_notes.pages p where (p.tab || '/' || p.slug) = v_r;
    if found then n_removed := n_removed + 1; end if;
  end loop;

  -- the index: one entry per page, in reading order
  update hvac_notes.pages p set idx = null, ord = null where p.idx is not null or p.ord is not null;
  for v_p, v_o in select x.e, x.o from jsonb_array_elements(p_index -> 'pages') with ordinality x(e, o) loop
    if jsonb_typeof(v_p) <> 'object' or coalesce(v_p ->> 'tab', '') !~ '^[a-z0-9-]{1,30}$' or coalesce(v_p ->> 'slug', '') !~ '^[a-z0-9-]{1,80}$'
       or octet_length(v_p::text) > 2000000 then raise exception 'INVALID:index'; end if;
    update hvac_notes.pages p set idx = v_p, ord = v_o where p.tab = v_p ->> 'tab' and p.slug = v_p ->> 'slug';
  end loop;

  -- images
  if p_files is not null then
    if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 2000 then raise exception 'INVALID:files'; end if;
    for v_p in select * from jsonb_array_elements(p_files) loop
      if coalesce(v_p ->> 'path', '') !~ '^[a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}$'
         or coalesce(v_p ->> 'sha', '') !~ '^[a-f0-9]{64}$' or jsonb_typeof(v_p -> 'size') is distinct from 'number'
         or (v_p ->> 'size')::numeric not between 0 and 5242880 then
        raise exception 'INVALID:files';
      end if;
      insert into hvac_notes.files (path, size, sha) values (v_p ->> 'path', (v_p ->> 'size')::integer, v_p ->> 'sha')
      on conflict (path) do update set size = excluded.size, sha = excluded.sha, updated_at = now();
      n_files := n_files + 1;
    end loop;
  end if;
  delete from hvac_notes.files f where f.path = any (coalesce(p_remove_files, '{}'::text[]));

  update hvac_notes.library l
     set version = l.version + 1, index_path = null, growth_path = null, growth = p_growth,
         credits = coalesce(p_credits, l.credits), published_at = now(), published_by = v_user.id
   where l.id = 1
  returning * into v_lib;
  select count(*) into n_drafts from hvac_notes.pages p where p.status = 'draft';

  perform core.audit('hvac-notes', 'publish', jsonb_build_object('version', v_lib.version, 'pages', n_pages,
    'removed', n_removed, 'images', n_files, 'images_removed', coalesce(cardinality(p_remove_files), 0), 'drafts', n_drafts));
  return jsonb_build_object('version', v_lib.version, 'published_at', v_lib.published_at, 'drafts', n_drafts);
end $$;
revoke execute on function public.hvac_notes_publish_commit(integer, jsonb, jsonb, text[], jsonb, text[], text, jsonb, jsonb) from public, anon;
grant execute on function public.hvac_notes_publish_commit(integer, jsonb, jsonb, text[], jsonb, text[], text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Bucket 'hvac-notes'
--    <tab>/images/<file>  read: anyone who can see that notebook.  _library/*.json (old index and timeline): 'edit' only.
--    Write: 'edit', images only (the index and timeline are no longer files). Delete: 'edit' (unchanged).
-- ---------------------------------------------------------------------------

-- For the read policy (Storage runs it as the signed-in user): may the caller read this object of the bucket?
create or replace function public.hvac_notes_file_open(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_name is null or not core.has_tile(v_uid, 'hvac-notes', null) then return false; end if;
  if left(p_name, 9) = '_library/' then return core.has_tile(v_uid, 'hvac-notes', 'edit'); end if;
  return hvac_notes.tab_open(v_uid, split_part(p_name, '/', 1));
end $$;
revoke execute on function public.hvac_notes_file_open(text) from public, anon;
grant execute on function public.hvac_notes_file_open(text) to authenticated;

drop policy hvac_notes_read on storage.objects;
create policy hvac_notes_read on storage.objects for select to authenticated
  using (bucket_id = 'hvac-notes' and public.hvac_notes_file_open(name));
drop policy hvac_notes_insert on storage.objects;
create policy hvac_notes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit')
              and name ~ '^[a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}$');
drop policy hvac_notes_update on storage.objects;
create policy hvac_notes_update on storage.objects for update to authenticated
  using (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit'))
  with check (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit')
              and name ~ '^[a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}$');

select core.applied('hvac-notes', '005_visibility');
