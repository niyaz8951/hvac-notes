-- HVAC Notes tile: schema hvac_notes, tables, private bucket hvac-notes, functions public.hvac_notes_*.
-- Run as the owner in the Supabase SQL editor after the tile 'hvac-notes' is registered in the admin page
-- (the security check accepts the hvac_notes_ prefix only for a registered tile). Read it first.
-- Touches only: schema hvac_notes, functions public.hvac_notes_*, bucket 'hvac-notes' and its storage policies.
--
-- Rights: reading = having the tile. 'edit' = publish pages (Publish page) and remove anyone's highlight or card note.
-- Content: one row per notebook (its nav.json as published), one row per page (Markdown), one row per image
-- (the bytes are in the bucket at <tab>/images/<file>), and one library row (version, credits, and the paths of
-- the search index and the growth timeline, which are JSON files in the bucket under _library/).
-- Shared notes: highlights (with their notes) and card notes are seen by everyone with the tile, with the name of
-- who made them; only the author changes them. Card colours, reading positions and reading state (review schedule,
-- practice questions, sections seen) are private: each user reads and writes only his own rows.

create schema if not exists hvac_notes;
revoke all on schema hvac_notes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies: only the security definer functions below read them)
-- ---------------------------------------------------------------------------

-- The published library: exactly one row.
create table hvac_notes.library (
  id           integer primary key default 1 check (id = 1),
  version      integer not null default 0,
  index_path   text check (index_path ~ '^_library/index-[a-z0-9-]{1,40}\.json$'),
  growth_path  text check (growth_path ~ '^_library/growth-[a-z0-9-]{1,40}\.json$'),
  credits      text not null default '' check (char_length(credits) <= 100000),
  published_at timestamptz,
  published_by uuid
);
alter table hvac_notes.library enable row level security;
insert into hvac_notes.library (id) values (1);

-- One row per notebook: its nav.json exactly as published (pages in reading order and their metadata).
create table hvac_notes.sections (
  tab        text primary key check (tab ~ '^[a-z0-9-]{1,30}$'),
  nav        text not null check (char_length(nav) <= 200000),
  updated_at timestamptz not null default now()
);
alter table hvac_notes.sections enable row level security;

-- One row per page: the Markdown as published.
create table hvac_notes.pages (
  tab        text not null check (tab ~ '^[a-z0-9-]{1,30}$'),
  slug       text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  md         text not null check (char_length(md) <= 400000),
  updated_at timestamptz not null default now(),
  primary key (tab, slug)
);
alter table hvac_notes.pages enable row level security;

-- One row per image in the bucket (<tab>/images/<file>): what is published, for change detection and export.
create table hvac_notes.files (
  path       text primary key check (path ~ '^[a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}$'),
  size       integer not null check (size between 0 and 5242880),
  sha        text not null check (sha ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);
alter table hvac_notes.files enable row level security;

-- Highlights in pages, shared. author = the author's display name when he last saved or opened the tile.
create table hvac_notes.highlights (
  id         text primary key check (id ~ '^[a-z0-9]{4,32}$'),
  user_id    uuid not null,
  author     text not null default '' check (char_length(author) <= 60),
  tab        text not null check (tab ~ '^[a-z0-9-]{1,30}$'),
  slug       text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  title      text not null default '' check (char_length(title) <= 200),
  color      text not null check (color in ('yellow', 'green', 'blue', 'pink', 'purple')),
  note       text not null default '' check (char_length(note) <= 5000),
  quote      jsonb not null check (jsonb_typeof(quote) = 'object' and octet_length(quote::text) <= 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table hvac_notes.highlights enable row level security;
create index on hvac_notes.highlights (user_id);

-- Colour and note on a term or standards card, one row per user and card. key = <tab>/<slug>/<card id>.
-- The note is shared (with author); the colour is the user's own.
create table hvac_notes.cards (
  id         bigint generated always as identity unique,
  user_id    uuid not null,
  author     text not null default '' check (char_length(author) <= 60),
  key        text not null check (key ~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}/[a-z0-9-]{1,120}$'),
  title      text not null default '' check (char_length(title) <= 200),
  color      text check (color in ('coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay')),
  note       text not null default '' check (char_length(note) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table hvac_notes.cards enable row level security;

-- Per user: how far into each page he has read (0..1).
create table hvac_notes.positions (
  user_id    uuid not null,
  route      text not null check (route ~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}$'),
  f          real not null check (f >= 0 and f <= 1),
  title      text not null default '' check (char_length(title) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, route)
);
alter table hvac_notes.positions enable row level security;

-- Per user: reading state the reader keeps as one document per kind:
--   review   Check yourself schedule  { "<route>#<key>": { box, due } }
--   practice missed practice problems { "<route>": [ { id, q, a } ] }
--   seen     sections as last read    { "<route>": { t, s: { <section id>: <fingerprint> } } }
create table hvac_notes.state (
  user_id    uuid not null,
  kind       text not null check (kind in ('review', 'practice', 'seen')),
  data       jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table hvac_notes.state enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Reading (anyone with the tile)
-- ---------------------------------------------------------------------------

-- The library: version, every notebook's nav.json (as text, parsed by the page) and where the index and timeline are.
create or replace function public.hvac_notes_library()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library;
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_lib from hvac_notes.library l where l.id = 1;
  return jsonb_build_object(
    'version', v_lib.version, 'published_at', v_lib.published_at,
    'index_path', v_lib.index_path, 'growth_path', v_lib.growth_path,
    'navs', coalesce((select jsonb_object_agg(s.tab, s.nav) from hvac_notes.sections s), '{}'::jsonb));
end $$;
revoke execute on function public.hvac_notes_library() from public, anon;
grant execute on function public.hvac_notes_library() to authenticated;

-- One page's Markdown.
create or replace function public.hvac_notes_page(p_tab text, p_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_page hvac_notes.pages;
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_page from hvac_notes.pages p where p.tab = p_tab and p.slug = p_slug;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('md', v_page.md, 'updated_at', v_page.updated_at);
end $$;
revoke execute on function public.hvac_notes_page(text, text) from public, anon;
grant execute on function public.hvac_notes_page(text, text) to authenticated;

-- Several pages at once (routes "tab/slug"; null = every page), for card focus mode and source peeks.
create or replace function public.hvac_notes_pages(p_routes text[])
returns table (tab text, slug text, md text)
language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_routes is not null and cardinality(p_routes) > 300 then raise exception 'INVALID:routes'; end if;
  return query
    select p.tab, p.slug, p.md from hvac_notes.pages p
    where p_routes is null or (p.tab || '/' || p.slug) = any (p_routes)
    order by p.tab, p.slug;
end $$;
revoke execute on function public.hvac_notes_pages(text[]) from public, anon;
grant execute on function public.hvac_notes_pages(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-user data (anyone with the tile; own rows, plus the shared notes of others)
-- ---------------------------------------------------------------------------

-- Everything the reader keeps for the caller, in one call. Also brings the author name on his notes up to date.
create or replace function public.hvac_notes_my_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  update hvac_notes.highlights h set author = v_user.display_name where h.user_id = v_user.id and h.author <> v_user.display_name;
  update hvac_notes.cards c set author = v_user.display_name where c.user_id = v_user.id and c.author <> v_user.display_name;
  return jsonb_build_object(
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'tab', h.tab, 'slug', h.slug, 'title', h.title,
        'color', h.color, 'note', h.note, 'quote', h.quote, 'created', h.created_at, 'updated', h.updated_at) order by h.created_at)
      from hvac_notes.highlights h where h.user_id = v_user.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('title', c.title, 'color', c.color, 'note', c.note, 'updated', c.updated_at))
      from hvac_notes.cards c where c.user_id = v_user.id), '{}'::jsonb),
    'positions', coalesce((select jsonb_object_agg(p.route, jsonb_build_object('f', p.f, 'title', p.title,
        't', floor(extract(epoch from p.updated_at) * 1000)))
      from hvac_notes.positions p where p.user_id = v_user.id), '{}'::jsonb),
    'state', coalesce((select jsonb_object_agg(s.kind, s.data) from hvac_notes.state s where s.user_id = v_user.id), '{}'::jsonb));
end $$;
revoke execute on function public.hvac_notes_my_data() from public, anon;
grant execute on function public.hvac_notes_my_data() to authenticated;

-- The notes of everyone else: highlights (with or without a note) and card notes, newest first, with the author's
-- name. Card colours are not included (they are each user's own). At most 5000 of each.
create or replace function public.hvac_notes_shared()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  return jsonb_build_object(
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tab', x.tab, 'slug', x.slug, 'title', x.title,
        'color', x.color, 'note', x.note, 'quote', x.quote, 'by', x.author, 'created', x.created_at, 'updated', x.updated_at))
      from (select * from hvac_notes.highlights h where h.user_id <> v_user.id order by h.updated_at desc limit 5000) x), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'key', x.key, 'title', x.title, 'note', x.note,
        'by', x.author, 'updated', x.updated_at))
      from (select * from hvac_notes.cards c where c.user_id <> v_user.id and c.note <> '' order by c.updated_at desc limit 5000) x), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_shared() from public, anon;
grant execute on function public.hvac_notes_shared() to authenticated;

-- Add or change one of the caller's highlights (an id that belongs to another user: INVALID:id).
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

-- Delete a highlight: the caller's own, or anyone's with the right 'edit' (audited). Otherwise NOT_FOUND.
create or replace function public.hvac_notes_highlight_delete(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.highlights;
begin
  v_user := core.require_tile('hvac-notes', null);
  delete from hvac_notes.highlights h
  where h.id = p_id and (h.user_id = v_user.id or core.has_tile(v_user.id, 'hvac-notes', 'edit'))
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.user_id <> v_user.id then
    perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'highlight', 'author', v_row.author,
      'page', v_row.tab || '/' || v_row.slug, 'quote', left(v_row.quote ->> 'exact', 200), 'note', left(v_row.note, 500)));
  end if;
end $$;
revoke execute on function public.hvac_notes_highlight_delete(text) from public, anon;
grant execute on function public.hvac_notes_highlight_delete(text) to authenticated;

-- Colour and note on a card. No colour and no note: the row is removed.
create or replace function public.hvac_notes_card_save(p_key text, p_title text, p_color text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_note text := coalesce(p_note, '');
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_key is null or p_key !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}/[a-z0-9-]{1,120}$' then raise exception 'INVALID:key'; end if;
  if p_color is not null and p_color not in ('coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay') then
    raise exception 'INVALID:color';
  end if;
  if char_length(v_note) > 5000 then raise exception 'INVALID:note'; end if;
  if p_color is null and v_note = '' then
    delete from hvac_notes.cards c where c.user_id = v_user.id and c.key = p_key;
    return;
  end if;
  if (select count(*) from hvac_notes.cards c where c.user_id = v_user.id) >= 5000
     and not exists (select 1 from hvac_notes.cards c where c.user_id = v_user.id and c.key = p_key) then
    raise exception 'INVALID:cards';
  end if;
  insert into hvac_notes.cards (user_id, author, key, title, color, note)
  values (v_user.id, v_user.display_name, p_key, left(coalesce(p_title, ''), 200), p_color, v_note)
  on conflict (user_id, key) do update
    set author = excluded.author, title = excluded.title, color = excluded.color, note = excluded.note, updated_at = now();
end $$;
revoke execute on function public.hvac_notes_card_save(text, text, text, text) from public, anon;
grant execute on function public.hvac_notes_card_save(text, text, text, text) to authenticated;

-- Remove another user's card note (right 'edit', audited). His colour on the card stays. The id comes from hvac_notes_shared().
create or replace function public.hvac_notes_card_remove(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.cards;
begin
  v_user := core.require_tile('hvac-notes', 'edit');
  select * into v_row from hvac_notes.cards c where c.id = p_id and c.note <> '';
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.color is null then delete from hvac_notes.cards c where c.id = p_id;
  else update hvac_notes.cards c set note = '', updated_at = now() where c.id = p_id; end if;
  perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'card', 'author', v_row.author,
    'card', v_row.key, 'note', left(v_row.note, 500)));
end $$;
revoke execute on function public.hvac_notes_card_remove(bigint) from public, anon;
grant execute on function public.hvac_notes_card_remove(bigint) to authenticated;

-- How far into a page the caller has read.
create or replace function public.hvac_notes_position_save(p_route text, p_f real, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_route is null or p_route !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}$' then raise exception 'INVALID:route'; end if;
  if p_f is null or p_f = 'NaN'::real or p_f < 0 or p_f > 1 then raise exception 'INVALID:f'; end if;
  if (select count(*) from hvac_notes.positions p where p.user_id = v_user.id) >= 5000
     and not exists (select 1 from hvac_notes.positions p where p.user_id = v_user.id and p.route = p_route) then
    raise exception 'INVALID:positions';
  end if;
  insert into hvac_notes.positions (user_id, route, f, title)
  values (v_user.id, p_route, p_f, left(coalesce(p_title, ''), 200))
  on conflict (user_id, route) do update set f = excluded.f, title = excluded.title, updated_at = now();
end $$;
revoke execute on function public.hvac_notes_position_save(text, real, text) from public, anon;
grant execute on function public.hvac_notes_position_save(text, real, text) to authenticated;

-- One reading-state document (review, practice, seen), replaced whole.
create or replace function public.hvac_notes_state_save(p_kind text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_kind is null or p_kind not in ('review', 'practice', 'seen') then raise exception 'INVALID:kind'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 1000000 then raise exception 'INVALID:data'; end if;
  insert into hvac_notes.state (user_id, kind, data) values (v_user.id, p_kind, p_data)
  on conflict (user_id, kind) do update set data = excluded.data, updated_at = now();
end $$;
revoke execute on function public.hvac_notes_state_save(text, jsonb) from public, anon;
grant execute on function public.hvac_notes_state_save(text, jsonb) to authenticated;

-- Restore from a backup file (the old site's "Back Up", or this tile's): adds highlights, card notes and positions
-- the caller does not have yet. Invalid items are skipped. Returns how many of each were added.
create or replace function public.hvac_notes_my_import(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_h jsonb; v_k text; v_v jsonb; n_h integer := 0; n_c integer := 0; n_p integer := 0;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 5000000 then raise exception 'INVALID:data'; end if;
  if jsonb_typeof(p_data -> 'highlights') = 'array' then
    for v_h in select * from jsonb_array_elements(p_data -> 'highlights') limit 5000 loop
      if jsonb_typeof(v_h) <> 'object' then continue; end if;
      if coalesce(v_h ->> 'id', '') !~ '^[a-z0-9]{4,32}$' or coalesce(v_h ->> 'tab', '') !~ '^[a-z0-9-]{1,30}$'
         or coalesce(v_h ->> 'slug', '') !~ '^[a-z0-9-]{1,80}$'
         or coalesce(v_h ->> 'color', '') not in ('yellow', 'green', 'blue', 'pink', 'purple')
         or jsonb_typeof(v_h -> 'quote') is distinct from 'object'
         or char_length(coalesce(v_h -> 'quote' ->> 'exact', '')) not between 1 and 5000
         or char_length(coalesce(v_h ->> 'note', '')) > 5000 then continue; end if;
      insert into hvac_notes.highlights (user_id, author, id, tab, slug, title, color, note, quote)
      values (v_user.id, v_user.display_name, v_h ->> 'id', v_h ->> 'tab', v_h ->> 'slug', left(coalesce(v_h ->> 'title', ''), 200), v_h ->> 'color',
              coalesce(v_h ->> 'note', ''),
              jsonb_build_object('exact', v_h -> 'quote' ->> 'exact', 'prefix', left(coalesce(v_h -> 'quote' ->> 'prefix', ''), 200),
                                 'suffix', left(coalesce(v_h -> 'quote' ->> 'suffix', ''), 200)))
      on conflict (id) do nothing;
      if found then n_h := n_h + 1; end if;
    end loop;
  end if;
  if jsonb_typeof(p_data -> 'cards') = 'object' then
    for v_k, v_v in select * from jsonb_each(p_data -> 'cards') limit 5000 loop
      if jsonb_typeof(v_v) <> 'object' or v_k !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}/[a-z0-9-]{1,120}$' then continue; end if;
      if (v_v ->> 'color') is not null and (v_v ->> 'color') not in ('coral', 'peach', 'sand', 'mint', 'sage', 'fog', 'storm', 'dusk', 'blossom', 'clay') then continue; end if;
      if char_length(coalesce(v_v ->> 'note', '')) > 5000 or ((v_v ->> 'color') is null and coalesce(v_v ->> 'note', '') = '') then continue; end if;
      insert into hvac_notes.cards (user_id, author, key, title, color, note)
      values (v_user.id, v_user.display_name, v_k, left(coalesce(v_v ->> 'title', ''), 200), v_v ->> 'color', coalesce(v_v ->> 'note', ''))
      on conflict (user_id, key) do nothing;
      if found then n_c := n_c + 1; end if;
    end loop;
  end if;
  if jsonb_typeof(p_data -> 'positions') = 'object' then
    for v_k, v_v in select * from jsonb_each(p_data -> 'positions') limit 5000 loop
      if jsonb_typeof(v_v) <> 'object' or v_k !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}$' or jsonb_typeof(v_v -> 'f') <> 'number' then continue; end if;
      if (v_v ->> 'f')::real < 0 or (v_v ->> 'f')::real > 1 then continue; end if;
      insert into hvac_notes.positions (user_id, route, f, title)
      values (v_user.id, v_k, (v_v ->> 'f')::real, left(coalesce(v_v ->> 'title', ''), 200))
      on conflict (user_id, route) do nothing;
      if found then n_p := n_p + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('highlights', n_h, 'cards', n_c, 'positions', n_p);
end $$;
revoke execute on function public.hvac_notes_my_import(jsonb) from public, anon;
grant execute on function public.hvac_notes_my_import(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Publishing (right 'edit')
-- ---------------------------------------------------------------------------

-- Everything as published: the Publish page merges an upload over it, and exports it as a zip.
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
      from hvac_notes.files f), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_publish_export() from public, anon;
grant execute on function public.hvac_notes_publish_export() to authenticated;

-- One publish, all or nothing. The images and the new index and timeline files are uploaded to the bucket first;
-- this records them and the pages. p_base is the version the Publish page started from: if someone published in
-- between, nothing is written (INVALID:version) and the page starts again from the new version.
--   p_navs   { "<tab>": "<nav.json text>" | null }   null removes the notebook
--   p_pages  [ { tab, slug, md } ]                    added or changed pages
--   p_remove [ "<tab>/<slug>" ]                       pages removed
--   p_files  [ { path, size, sha } ]                  added or changed images
--   p_remove_files [ "<tab>/images/<file>" ]          images removed (the page deletes the bytes after this succeeds)
--   p_credits      CREDITS.md text, or null to keep it
create or replace function public.hvac_notes_publish_commit(p_base integer, p_navs jsonb, p_pages jsonb, p_remove text[],
  p_files jsonb, p_remove_files text[], p_credits text, p_index_path text, p_growth_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library; v_k text; v_v jsonb; v_p jsonb; v_r text;
  n_pages integer := 0; n_removed integer := 0; n_files integer := 0;
begin
  v_user := core.require_tile('hvac-notes', 'edit');
  select * into v_lib from hvac_notes.library l where l.id = 1 for update;
  if p_base is null or p_base <> v_lib.version then raise exception 'INVALID:version'; end if;
  if p_index_path is null or p_index_path !~ '^_library/index-[a-z0-9-]{1,40}\.json$' then raise exception 'INVALID:index_path'; end if;
  if p_growth_path is null or p_growth_path !~ '^_library/growth-[a-z0-9-]{1,40}\.json$' then raise exception 'INVALID:growth_path'; end if;
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

  -- pages
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
     set version = l.version + 1, index_path = p_index_path, growth_path = p_growth_path,
         credits = coalesce(p_credits, l.credits), published_at = now(), published_by = v_user.id
   where l.id = 1
  returning * into v_lib;

  perform core.audit('hvac-notes', 'publish', jsonb_build_object('version', v_lib.version, 'pages', n_pages,
    'removed', n_removed, 'images', n_files, 'images_removed', coalesce(cardinality(p_remove_files), 0)));
  return jsonb_build_object('version', v_lib.version, 'published_at', v_lib.published_at);
end $$;
revoke execute on function public.hvac_notes_publish_commit(integer, jsonb, jsonb, text[], jsonb, text[], text, text, text) from public, anon;
grant execute on function public.hvac_notes_publish_commit(integer, jsonb, jsonb, text[], jsonb, text[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Private bucket 'hvac-notes'
--    <tab>/images/<file>   images of the pages
--    _library/<file>.json  the search index and the growth timeline
--    Read: anyone with the tile. Write, replace, delete: right 'edit', and only those two kinds of path.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('hvac-notes', 'hvac-notes', false) on conflict (id) do nothing;

-- Size and type limits where this Supabase version has them.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'hvac-notes'$q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set allowed_mime_types = array['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/json']
      where id = 'hvac-notes'$q$;
  end if;
end $$;

create policy hvac_notes_read on storage.objects for select to authenticated
  using (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', null));
create policy hvac_notes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit')
              and name ~ '^([a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}|_library/(index|growth)-[a-z0-9-]{1,40}\.json)$');
create policy hvac_notes_update on storage.objects for update to authenticated
  using (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit'))
  with check (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit')
              and name ~ '^([a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}|_library/(index|growth)-[a-z0-9-]{1,40}\.json)$');
create policy hvac_notes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hvac-notes' and core.has_tile(auth.uid(), 'hvac-notes', 'edit'));

select core.applied('hvac-notes', '001_init');
