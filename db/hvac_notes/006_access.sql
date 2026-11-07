-- HVAC Notes tile: the core's access model (core 011; admin repo docs/TILE-CHANGES.md, 2026-11-06, "hvac-notes first").
-- Run as the owner in the Supabase SQL editor after 005_visibility.sql and the core's 011_access.sql. Read it first.
-- Touches only: schema hvac_notes (drops table notebooks and the helpers that read it; new helpers), functions
-- public.hvac_notes_* (replaces library, index, growth, highlight_save, highlight_delete, card_save, card_remove,
-- reply_save, reply_delete, my_import, page_status, publish_export, publish_commit, file_open; adds file_write,
-- file_remove; drops notebook_set), the bucket's policies, the core rows for this tile only (core.tile_declare,
-- core.container_put, core.shares_from_right for 'hvac-notes').
--
-- Notebooks become containers of kind 'notebook' (id = the notebook id: theory, chillers ...). Each is shared from the
-- core's Access panel (Share on the notebook page, managers): everyone in the tile (the default, as today), or only the
-- people and groups listed. A notebook set to Selected users keeps exactly its readers: whoever held nb_<notebook>
-- gets a "Can edit" share of it. Then the nb_* rights go and hvac_notes.notebooks is dropped.
--
-- What each level may do in a notebook (the person's tile level, capped by how the notebook is shared with him):
--   read        read its approved pages; his own reading position, review and practice state, card colours
--   contribute  + highlights, card notes and replies (shared with everyone who can read the page)
--   edit        + see its drafts.  Publishing (and Download all pages) needs edit on EVERY notebook: one publish
--               carries the whole library's search index and timeline.
--   approve     + approve and hide its pages; remove anyone's highlight, card note or reply on its pages
--   manage      every notebook (private ones too), Share, "This is the whole library" (removing pages a notebook still
--               lists, removing notebooks and images), people and access of the tile (only the super user names managers)
-- Who could do what before keeps it: 011 gave every user the level matching his rights (edit -> edit, tile admin -> manage,
-- anyone else -> contribute). Two changes, as decided: removing others' notes is now approve (was the right 'edit'),
-- and approving pages is approve (was the tile admin only).

-- ---------------------------------------------------------------------------
-- 1. The tile's declaration with the notebook kind. The nb_* rights are still declared here so that step 2 can turn
--    them into shares; step 3 declares the tile without them.
-- ---------------------------------------------------------------------------
create or replace function hvac_notes.declaration(p_rights jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'levels', jsonb_build_object(
      'read', 'Read the approved pages of the notebooks open to him',
      'contribute', 'Read; his own highlights, card notes and replies (everyone who can read the page sees them)',
      'edit', 'See drafts; publish pages (they arrive as drafts) and download all pages, with edit on every notebook',
      'approve', 'Approve and hide pages; remove anyone''s highlights, card notes and replies',
      'manage', 'Every notebook and who can open it (Share); publish as the whole library; people and access of the tile'),
    'aliases', '{}'::jsonb,
    'rights', coalesce(p_rights, '{}'::jsonb),
    'kinds', jsonb_build_object('notebook', 'Notebook'),
    'default', 'contribute') $$;
revoke execute on function hvac_notes.declaration(jsonb) from public, anon, authenticated;

select core.tile_declare('hvac-notes', hvac_notes.declaration((
  select coalesce(jsonb_object_agg(r, 'Read the ' || replace(substr(r, 4), '_', ' ') || ' notebook when it is set to Selected users'), '{}'::jsonb)
  from core.tiles t, unnest(t.rights) r where t.id = 'hvac-notes' and r like 'nb\_%')));

-- ---------------------------------------------------------------------------
-- 2. Every notebook becomes a container. All users -> everyone in the tile (can edit, i.e. works at his tile level).
--    Selected users -> only those listed: each holder of nb_<notebook> (person or group) gets "Can edit".
--    The owner of a registered notebook is nobody: managers share it. (A notebook first published later is owned by
--    whoever publishes it, as the core does for any new container.)
-- ---------------------------------------------------------------------------
create or replace function hvac_notes.tab_name(p_tab text)
returns text language sql immutable set search_path = '' as $$
  select case p_tab when 'theory' then 'Theory' when 'refrigeration' then 'Refrigeration' when 'chillers' then 'Chillers'
    when 'ahu' then 'AHU' when 'fcu' then 'FCU' when 'systems' then 'Systems' when 'ashrae' then 'ASHRAE Handbook'
    else initcap(replace(p_tab, '-', ' ')) end $$;
revoke execute on function hvac_notes.tab_name(text) from public, anon, authenticated;

--    Under 005 the right 'edit' saw every notebook: people and groups at edit or approve also get "Can edit" of each
--    selected notebook, so nobody loses a notebook he could open (managers open every notebook anyway).
do $$
declare v_tab text; v_sel boolean; v_n integer; v_id uuid;
begin
  for v_tab in select t.tab from (select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p
                                  union select n.tab from hvac_notes.notebooks n) t order by t.tab loop
    v_sel := exists (select 1 from hvac_notes.notebooks n where n.tab = v_tab and n.audience = 'selected');
    perform core.container_put('hvac-notes', 'notebook', v_tab, hvac_notes.tab_name(v_tab), case when v_sel then null else 'edit' end, null);
    if v_sel then
      v_n := core.shares_from_right('hvac-notes', 'nb_' || replace(v_tab, '-', '_'), 'notebook', v_tab, 'edit');
      for v_id in select a.user_id from core.tile_access a where a.tile_id = 'hvac-notes' and a.level in ('edit', 'approve') loop
        perform core.share_put('hvac-notes', 'notebook', v_tab, v_id, null, 'edit');
      end loop;
      for v_id in select g.group_id from core.tile_group_access g where g.tile_id = 'hvac-notes' and g.level in ('edit', 'approve') loop
        perform core.share_put('hvac-notes', 'notebook', v_tab, null, v_id, 'edit');
      end loop;
      raise notice 'notebook % (selected users): % share(s) from nb_%, plus editors', v_tab, v_n, replace(v_tab, '-', '_');
    else
      raise notice 'notebook %: everyone in the tile', v_tab;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Declared again without the nb_* rights (they leave every person and group). The old notebook setting goes.
-- ---------------------------------------------------------------------------
select core.tile_declare('hvac-notes', hvac_notes.declaration('{}'::jsonb));

drop function public.hvac_notes_notebook_set(text, text);

-- ---------------------------------------------------------------------------
-- 4. Helpers (schema hvac_notes: not reachable through the API; used by the functions below, which run as the owner).
--    Same names as in 005 where the meaning stays (visible_routes, can_see), so 005's page, pages and shared keep working.
-- ---------------------------------------------------------------------------

-- The user's level on one notebook (null = he may not open it): the core decides.
create or replace function hvac_notes.tab_level(p_user uuid, p_tab text)
returns text language sql stable set search_path = '' as $$
  select core.container_level(p_user, 'hvac-notes', 'notebook', p_tab) $$;

-- { "<notebook>": "<level>" } for every notebook with content the user may open.
create or replace function hvac_notes.levels(p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.tab, x.l), '{}'::jsonb) from (
    select t.tab, hvac_notes.tab_level(p_user, t.tab) l
    from (select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p) t) x
  where x.l is not null $$;

-- Publishing changes the whole library (its index and timeline): edit in the tile and on every notebook.
create or replace function hvac_notes.can_publish(p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select core.has_tile(p_user, 'hvac-notes', 'edit')
     and not exists (select 1 from (select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p) t
                     where core.level_rank(hvac_notes.tab_level(p_user, t.tab)) < 3) $$;

-- Routes ("tab/slug") of the pages the user may read: approved pages of the notebooks he may open, and drafts of the
-- notebooks where he has at least edit.
create or replace function hvac_notes.visible_routes(p_user uuid)
returns text[] language sql stable set search_path = '' as $$
  with lv as materialized (select e.key as tab, e.value #>> '{}' as l from jsonb_each(hvac_notes.levels(p_user)) e)
  select coalesce(array_agg(p.tab || '/' || p.slug order by p.tab, p.slug), '{}')
  from hvac_notes.pages p join lv on lv.tab = p.tab
  where p.status = 'approved' or core.level_rank(lv.l) >= 3 $$;

create or replace function hvac_notes.can_see(p_user uuid, p_tab text, p_slug text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from hvac_notes.pages p cross join lateral (select hvac_notes.tab_level(p_user, p.tab) l) x
    where p.tab = p_tab and p.slug = p_slug and x.l is not null and (p.status = 'approved' or core.level_rank(x.l) >= 3)) $$;

-- The page is open to him (else the caller answers NOT_FOUND) and his level there is at least p_level (else NO_RIGHT).
create or replace function hvac_notes.require_page(p_user uuid, p_tab text, p_slug text, p_level text)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not hvac_notes.can_see(p_user, p_tab, p_slug) then raise exception 'NOT_FOUND'; end if;
  if core.level_rank(hvac_notes.tab_level(p_user, p_tab)) < core.level_rank(p_level) then raise exception 'NO_RIGHT'; end if;
end $$;

-- The page a reply hangs under ("tab/slug"), or null when its note is gone.
create or replace function hvac_notes.reply_route(p_kind text, p_ref text)
returns text language sql stable set search_path = '' as $$
  select case p_kind
    when 'highlight' then (select h.tab || '/' || h.slug from hvac_notes.highlights h where h.id = p_ref)
    when 'card' then (select split_part(c.key, '/', 1) || '/' || split_part(c.key, '/', 2) from hvac_notes.cards c
                      where p_ref ~ '^[0-9]{1,18}$' and c.id = p_ref::bigint and c.note <> '')
  end $$;

revoke execute on function hvac_notes.tab_level(uuid, text), hvac_notes.levels(uuid), hvac_notes.can_publish(uuid),
  hvac_notes.visible_routes(uuid), hvac_notes.can_see(uuid, text, text), hvac_notes.require_page(uuid, text, text, text),
  hvac_notes.reply_route(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading
-- ---------------------------------------------------------------------------

-- The library: version and every notebook's nav the caller may read.
--   levels    { "<notebook>": "<level>" } of the notebooks he may open (the page shows and hides with it)
--   editor    may publish (edit on every notebook): navs as published;   approver  approve on at least one notebook
--   manager   the tile's manager: sharing = { "<notebook>": { everyone, shared, owner } } for the Share row
--   drafts    routes of the draft pages he may see;   closed  notebooks he may not open, so the reader leaves them out
create or replace function public.hvac_notes_library()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library; v_levels jsonb; v_pub boolean; v_vis text[]; v_mgr boolean;
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_lib from hvac_notes.library l where l.id = 1;
  v_levels := hvac_notes.levels(v_user.id);
  v_pub := hvac_notes.can_publish(v_user.id);
  v_vis := hvac_notes.visible_routes(v_user.id);
  v_mgr := core.is_tile_admin(v_user.id, 'hvac-notes');
  return jsonb_build_object(
    'version', v_lib.version, 'published_at', v_lib.published_at,
    'navs', coalesce((select jsonb_object_agg(s.tab, case when v_pub then s.nav else hvac_notes.nav_for(s.tab, s.nav, v_vis) end)
      from hvac_notes.sections s where v_levels ? s.tab), '{}'::jsonb),
    'levels', v_levels,
    'editor', v_pub,
    'approver', exists (select 1 from jsonb_each_text(v_levels) e where core.level_rank(e.value) >= 4),
    'manager', v_mgr,
    'sharing', case when v_mgr then coalesce((select jsonb_object_agg(x.tab, jsonb_build_object('everyone', x.i -> 'everyone',
        'shared', x.i -> 'shared', 'owner', x.i -> 'owner_name'))
      from (select e.key as tab, core.container_info('hvac-notes', 'notebook', e.key) i from jsonb_each(v_levels) e) x
      where x.i is not null), '{}'::jsonb) else '{}'::jsonb end,
    'drafts', coalesce((select jsonb_agg(p.tab || '/' || p.slug order by p.tab, p.slug) from hvac_notes.pages p
      where p.status = 'draft' and (p.tab || '/' || p.slug) = any (v_vis)), '[]'::jsonb),
    'closed', coalesce((select jsonb_agg(t.tab order by t.tab) from (select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p) t
      where not (v_levels ? t.tab)), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_library() from public, anon;
grant execute on function public.hvac_notes_library() to authenticated;

-- The search index of the pages the caller may read (as in 005; "everything" now means: may publish).
create or replace function public.hvac_notes_index()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_all boolean; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  if (select l.index_path from hvac_notes.library l where l.id = 1) is not null then return null; end if;
  v_all := hvac_notes.can_publish(v_user.id);
  v_vis := hvac_notes.visible_routes(v_user.id);
  return jsonb_build_object('v', 1, 'pages', coalesce((
    select jsonb_agg(case when v_all then p.idx else hvac_notes.idx_for(p.idx, v_vis) end order by p.ord nulls last, p.tab, p.slug)
    from hvac_notes.pages p where p.idx is not null and (p.tab || '/' || p.slug) = any (v_vis)), '[]'::jsonb));
end $$;
revoke execute on function public.hvac_notes_index() from public, anon;
grant execute on function public.hvac_notes_index() to authenticated;

-- The growth timeline with only the items of pages the caller may read (as in 005).
create or replace function public.hvac_notes_growth()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_g jsonb; v_vis text[]; v_ok text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  select l.growth into v_g from hvac_notes.library l where l.id = 1;
  if v_g is null then return null; end if;
  if hvac_notes.can_publish(v_user.id) then return v_g; end if;
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

-- ---------------------------------------------------------------------------
-- 6. Notes: writing needs contribute on the page's notebook; removing someone else's needs approve there.
--    Removing your own needs nothing more than the tile. Bodies otherwise as in 005.
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
  perform hvac_notes.require_page(v_user.id, p_tab, p_slug, 'contribute');
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

-- His own highlight; anyone's with approve on the page's notebook (audited). Otherwise NOT_FOUND.
create or replace function public.hvac_notes_highlight_delete(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.highlights;
begin
  v_user := core.require_tile('hvac-notes', null);
  delete from hvac_notes.highlights h
  where h.id = p_id and (h.user_id = v_user.id
        or (hvac_notes.can_see(v_user.id, h.tab, h.slug) and core.level_rank(hvac_notes.tab_level(v_user.id, h.tab)) >= 4))
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from hvac_notes.replies r where r.kind = 'highlight' and r.ref = p_id;
  if v_row.user_id <> v_user.id then
    perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'highlight', 'author', v_row.author,
      'page', v_row.tab || '/' || v_row.slug, 'quote', left(v_row.quote ->> 'exact', 200), 'note', left(v_row.note, 500)));
  end if;
end $$;
revoke execute on function public.hvac_notes_highlight_delete(text) from public, anon;
grant execute on function public.hvac_notes_highlight_delete(text) to authenticated;

-- Colour and note on a card. The colour is private (read is enough); a note is shared (contribute).
-- Clearing both removes the row, wherever its page is.
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
  perform hvac_notes.require_page(v_user.id, split_part(p_key, '/', 1), split_part(p_key, '/', 2),
                                  case when v_note = '' then 'read' else 'contribute' end);
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

-- Someone else's card note (approve on its notebook, audited). The note goes; his private colour stays.
create or replace function public.hvac_notes_card_remove(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.cards;
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_row from hvac_notes.cards c where c.id = p_id and c.note <> '';
  if not found then raise exception 'NOT_FOUND'; end if;
  perform hvac_notes.require_page(v_user.id, split_part(v_row.key, '/', 1), split_part(v_row.key, '/', 2), 'approve');
  delete from hvac_notes.replies r where r.kind = 'card' and r.ref = p_id::text;
  if v_row.color is null then delete from hvac_notes.cards c where c.id = p_id;
  else update hvac_notes.cards c set note = '', updated_at = now() where c.id = p_id; end if;
  perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'card', 'author', v_row.author,
    'card', v_row.key, 'note', left(v_row.note, 500)));
end $$;
revoke execute on function public.hvac_notes_card_remove(bigint) from public, anon;
grant execute on function public.hvac_notes_card_remove(bigint) to authenticated;

-- A reply under a highlight or card note on a page the caller may read, with contribute there.
create or replace function public.hvac_notes_reply_save(p_kind text, p_ref text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_body text := trim(coalesce(p_body, '')); v_id bigint; v_route text;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_kind is null or p_kind not in ('highlight', 'card') then raise exception 'INVALID:kind'; end if;
  if p_ref is null or p_ref !~ '^[a-z0-9]{1,32}$' then raise exception 'INVALID:ref'; end if;
  if char_length(v_body) not between 1 and 5000 then raise exception 'INVALID:body'; end if;
  v_route := hvac_notes.reply_route(p_kind, p_ref);
  if v_route is null then raise exception 'NOT_FOUND'; end if;
  perform hvac_notes.require_page(v_user.id, split_part(v_route, '/', 1), split_part(v_route, '/', 2), 'contribute');
  if (select count(*) from hvac_notes.replies r where r.user_id = v_user.id) >= 20000 then raise exception 'INVALID:replies'; end if;
  insert into hvac_notes.replies (kind, ref, user_id, author, body) values (p_kind, p_ref, v_user.id, v_user.display_name, v_body)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'by', v_user.display_name, 'created', now());
end $$;
revoke execute on function public.hvac_notes_reply_save(text, text, text) from public, anon;
grant execute on function public.hvac_notes_reply_save(text, text, text) to authenticated;

-- His own reply; anyone's with approve on the notebook of the note it answers (audited). Otherwise NOT_FOUND.
create or replace function public.hvac_notes_reply_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.replies; v_route text;
begin
  v_user := core.require_tile('hvac-notes', null);
  select * into v_row from hvac_notes.replies r where r.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.user_id <> v_user.id then
    v_route := hvac_notes.reply_route(v_row.kind, v_row.ref);
    if v_route is null or not hvac_notes.can_see(v_user.id, split_part(v_route, '/', 1), split_part(v_route, '/', 2))
       or core.level_rank(hvac_notes.tab_level(v_user.id, split_part(v_route, '/', 1))) < 4 then
      raise exception 'NOT_FOUND';
    end if;
  end if;
  delete from hvac_notes.replies r where r.id = p_id;
  if v_row.user_id <> v_user.id then
    perform core.audit('hvac-notes', 'reply_removed', jsonb_build_object('author', v_row.author, 'kind', v_row.kind, 'ref', v_row.ref,
      'page', v_route, 'body', left(v_row.body, 500)));
  end if;
end $$;
revoke execute on function public.hvac_notes_reply_delete(bigint) from public, anon;
grant execute on function public.hvac_notes_reply_delete(bigint) to authenticated;

-- Restore from a backup file: as in 001, but highlights and card notes only on pages where he may contribute, and card
-- colours only on pages he may read (others are skipped). Positions are private and kept as before.
create or replace function public.hvac_notes_my_import(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_h jsonb; v_k text; v_v jsonb; n_h integer := 0; n_c integer := 0; n_p integer := 0; v_lv jsonb; v_vis text[];
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 5000000 then raise exception 'INVALID:data'; end if;
  v_lv := hvac_notes.levels(v_user.id);
  v_vis := hvac_notes.visible_routes(v_user.id);
  if jsonb_typeof(p_data -> 'highlights') = 'array' then
    for v_h in select * from jsonb_array_elements(p_data -> 'highlights') limit 5000 loop
      if jsonb_typeof(v_h) <> 'object' then continue; end if;
      if coalesce(v_h ->> 'id', '') !~ '^[a-z0-9]{4,32}$' or coalesce(v_h ->> 'tab', '') !~ '^[a-z0-9-]{1,30}$'
         or coalesce(v_h ->> 'slug', '') !~ '^[a-z0-9-]{1,80}$'
         or coalesce(v_h ->> 'color', '') not in ('yellow', 'green', 'blue', 'pink', 'purple')
         or jsonb_typeof(v_h -> 'quote') is distinct from 'object'
         or char_length(coalesce(v_h -> 'quote' ->> 'exact', '')) not between 1 and 5000
         or char_length(coalesce(v_h ->> 'note', '')) > 5000 then continue; end if;
      if not ((v_h ->> 'tab') || '/' || (v_h ->> 'slug')) = any (v_vis) or core.level_rank(v_lv ->> (v_h ->> 'tab')) < 2 then continue; end if;
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
      if not (split_part(v_k, '/', 1) || '/' || split_part(v_k, '/', 2)) = any (v_vis) then continue; end if;
      if coalesce(v_v ->> 'note', '') <> '' and core.level_rank(v_lv ->> split_part(v_k, '/', 1)) < 2 then continue; end if;
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
-- 7. Approving pages: approve on each page's notebook (audited). A page he may not see: NOT_FOUND; one he may see
--    without approve there: NO_RIGHT. Nothing changes unless every page passes.
-- ---------------------------------------------------------------------------
create or replace function public.hvac_notes_page_status(p_routes text[], p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_r text; v_n integer := 0;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_status is null or p_status not in ('draft', 'approved') then raise exception 'INVALID:status'; end if;
  if p_routes is null or cardinality(p_routes) not between 1 and 300 then raise exception 'INVALID:routes'; end if;
  foreach v_r in array p_routes loop
    if v_r is null or v_r !~ '^[a-z0-9-]{1,30}/[a-z0-9-]{1,80}$' then raise exception 'NOT_FOUND'; end if;
    perform hvac_notes.require_page(v_user.id, split_part(v_r, '/', 1), split_part(v_r, '/', 2), 'approve');
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

-- ---------------------------------------------------------------------------
-- 8. Publishing: edit on every notebook. Removing what the upload does not change ("This is the whole library":
--    a page its notebook still lists, a whole notebook, an image) is the manager's.
-- ---------------------------------------------------------------------------

-- Everything as published, for the Publish page and the export zip (as in 005, without the old notebook setting).
create or replace function public.hvac_notes_publish_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library;
begin
  v_user := core.require_tile('hvac-notes', null);
  if not hvac_notes.can_publish(v_user.id) then raise exception 'NO_RIGHT'; end if;
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
    'manager', core.is_tile_admin(v_user.id, 'hvac-notes'));
end $$;
revoke execute on function public.hvac_notes_publish_export() from public, anon;
grant execute on function public.hvac_notes_publish_export() to authenticated;

-- One publish, all or nothing (as in 005). New: the level checks above, and a notebook published for the first time is
-- registered as a container (everyone in the tile; the publisher is its owner).
create or replace function public.hvac_notes_publish_commit(p_base integer, p_navs jsonb, p_pages jsonb, p_remove text[],
  p_files jsonb, p_remove_files text[], p_credits text, p_index jsonb, p_growth jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_lib hvac_notes.library; v_k text; v_v jsonb; v_p jsonb; v_o bigint; v_r text; v_mgr boolean;
  n_pages integer := 0; n_removed integer := 0; n_files integer := 0; n_drafts integer;
begin
  v_user := core.require_tile('hvac-notes', null);
  if not hvac_notes.can_publish(v_user.id) then raise exception 'NO_RIGHT'; end if;
  v_mgr := core.is_tile_admin(v_user.id, 'hvac-notes');
  select * into v_lib from hvac_notes.library l where l.id = 1 for update;
  if p_base is null or p_base <> v_lib.version then raise exception 'INVALID:version'; end if;
  if p_index is null or jsonb_typeof(p_index) <> 'object' or jsonb_typeof(p_index -> 'pages') is distinct from 'array'
     or jsonb_array_length(p_index -> 'pages') > 2000 then raise exception 'INVALID:index'; end if;
  if p_growth is null or jsonb_typeof(p_growth) <> 'object' or jsonb_typeof(p_growth -> 'days') is distinct from 'array'
     or octet_length(p_growth::text) > 20000000 then raise exception 'INVALID:growth'; end if;
  if p_credits is not null and char_length(p_credits) > 100000 then raise exception 'INVALID:credits'; end if;
  if p_navs is not null and jsonb_typeof(p_navs) <> 'object' then raise exception 'INVALID:navs'; end if;

  -- the whole-library parts are the manager's: removing a notebook, a page its (new) nav.json still lists, an image
  if not v_mgr then
    if exists (select 1 from jsonb_each(coalesce(p_navs, '{}'::jsonb)) e where jsonb_typeof(e.value) = 'null') then raise exception 'NO_RIGHT'; end if;
    if cardinality(coalesce(p_remove_files, '{}'::text[])) > 0 then raise exception 'NO_RIGHT'; end if;
    foreach v_r in array coalesce(p_remove, '{}'::text[]) loop
      v_k := split_part(v_r, '/', 1);
      if jsonb_typeof(coalesce(p_navs, '{}'::jsonb) -> v_k) is distinct from 'string' then raise exception 'NO_RIGHT'; end if;
      begin
        if exists (select 1 from jsonb_array_elements((p_navs ->> v_k)::jsonb) e
                   where jsonb_typeof(e) = 'object' and e ->> 'slug' = split_part(v_r, '/', 2)) then raise exception 'NO_RIGHT'; end if;
      exception when invalid_text_representation or data_exception then raise exception 'INVALID:navs';
      end;
    end loop;
  end if;

  -- notebooks (nav.json)
  for v_k, v_v in select * from jsonb_each(coalesce(p_navs, '{}'::jsonb)) loop
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

  -- a notebook seen for the first time becomes a container (everyone in the tile, as every notebook starts). If it was
  -- already registered and he may not edit it (a private notebook with no content), the check below refuses all of it.
  for v_k in select t.tab from (select s.tab from hvac_notes.sections s union select p.tab from hvac_notes.pages p) t
             where hvac_notes.tab_level(v_user.id, t.tab) is null loop
    perform core.container_put('hvac-notes', 'notebook', v_k, hvac_notes.tab_name(v_k), 'edit', v_user.id);
  end loop;
  if not hvac_notes.can_publish(v_user.id) then raise exception 'NO_RIGHT'; end if;

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
-- 9. Bucket 'hvac-notes'. Storage runs the policies as the signed-in user, so they call public functions:
--    read   <tab>/images/<file>: anyone who may open that notebook (and, for a notebook not published yet, whoever may
--           publish: the upload reads its images back).  _library/*.json (before the move): may publish.
--    write  images only, by those who may publish (the Publish page uploads before its commit).
--    delete _library/*.json: may publish (Move now).  An image: the manager (only "whole library" removes images).
-- ---------------------------------------------------------------------------
create or replace function public.hvac_notes_file_open(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tab text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_uid is null or p_name is null or not core.has_tile(v_uid, 'hvac-notes', null) then return false; end if;
  if left(p_name, 9) = '_library/' then return hvac_notes.can_publish(v_uid); end if;
  if hvac_notes.tab_level(v_uid, v_tab) is not null then return true; end if;
  -- a new notebook's images are uploaded before the publish that registers it: whoever may publish reads them back
  return hvac_notes.can_publish(v_uid)
     and not exists (select 1 from hvac_notes.sections s where s.tab = v_tab)
     and not exists (select 1 from hvac_notes.pages p where p.tab = v_tab);
end $$;
revoke execute on function public.hvac_notes_file_open(text) from public, anon;
grant execute on function public.hvac_notes_file_open(text) to authenticated;

create or replace function public.hvac_notes_file_write(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_name is null or p_name !~ '^[a-z0-9-]{1,30}/images/[A-Za-z0-9._-]{1,120}$' then return false; end if;
  return hvac_notes.can_publish(v_uid);
end $$;
revoke execute on function public.hvac_notes_file_write(text) from public, anon;
grant execute on function public.hvac_notes_file_write(text) to authenticated;

create or replace function public.hvac_notes_file_remove(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_name is null or not hvac_notes.can_publish(v_uid) then return false; end if;
  if left(p_name, 9) = '_library/' then return true; end if;
  return core.is_tile_admin(v_uid, 'hvac-notes');
end $$;
revoke execute on function public.hvac_notes_file_remove(text) from public, anon;
grant execute on function public.hvac_notes_file_remove(text) to authenticated;

drop policy hvac_notes_insert on storage.objects;
create policy hvac_notes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hvac-notes' and public.hvac_notes_file_write(name));
drop policy hvac_notes_update on storage.objects;
create policy hvac_notes_update on storage.objects for update to authenticated
  using (bucket_id = 'hvac-notes' and public.hvac_notes_file_write(name))
  with check (bucket_id = 'hvac-notes' and public.hvac_notes_file_write(name));
drop policy hvac_notes_delete on storage.objects;
create policy hvac_notes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hvac-notes' and public.hvac_notes_file_remove(name));

-- ---------------------------------------------------------------------------
-- 10. What 005 kept and nothing reads any more
-- ---------------------------------------------------------------------------
drop function hvac_notes.tab_open(uuid, text);
drop function hvac_notes.open_tabs(uuid);
drop function hvac_notes.sees_all(uuid);
drop function hvac_notes.tab_right(text);
drop table hvac_notes.notebooks;

select core.applied('hvac-notes', '006_access');
