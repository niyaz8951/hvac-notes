-- HVAC Notes tile: replies under highlights and card notes (questions and answers).
-- Run as the owner in the Supabase SQL editor after 001_init.sql. Read it first.
-- Touches only: schema hvac_notes (new table replies), functions public.hvac_notes_* (replaces shared, my_data,
-- card_save, highlight_delete, card_remove; adds reply_save, reply_delete).
--
-- Any note (a highlight with or without a note, or a card note) can be answered by anyone with the tile. A reply shows
-- its author's name. The author deletes his own reply; 'edit' deletes any (audited). Removing a note removes its replies.

-- ---------------------------------------------------------------------------
-- 1. Table (RLS on, no policies)
-- ---------------------------------------------------------------------------

-- kind 'highlight': ref = the highlight id. kind 'card': ref = the card row id (hvac_notes.cards.id) as text.
create table hvac_notes.replies (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('highlight', 'card')),
  ref        text not null check (ref ~ '^[a-z0-9]{1,32}$'),
  user_id    uuid not null,
  author     text not null default '' check (char_length(author) <= 60),
  body       text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
alter table hvac_notes.replies enable row level security;
create index on hvac_notes.replies (kind, ref);
create index on hvac_notes.replies (user_id);

-- ---------------------------------------------------------------------------
-- 2. Reading
-- ---------------------------------------------------------------------------

-- The caller's own data; cards now carry their row id (for replies). Also brings his author name up to date.
create or replace function public.hvac_notes_my_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  update hvac_notes.highlights h set author = v_user.display_name where h.user_id = v_user.id and h.author <> v_user.display_name;
  update hvac_notes.cards c set author = v_user.display_name where c.user_id = v_user.id and c.author <> v_user.display_name;
  update hvac_notes.replies r set author = v_user.display_name where r.user_id = v_user.id and r.author <> v_user.display_name;
  return jsonb_build_object(
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'tab', h.tab, 'slug', h.slug, 'title', h.title,
        'color', h.color, 'note', h.note, 'quote', h.quote, 'created', h.created_at, 'updated', h.updated_at) order by h.created_at)
      from hvac_notes.highlights h where h.user_id = v_user.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('id', c.id, 'title', c.title, 'color', c.color, 'note', c.note, 'updated', c.updated_at))
      from hvac_notes.cards c where c.user_id = v_user.id), '{}'::jsonb),
    'positions', coalesce((select jsonb_object_agg(p.route, jsonb_build_object('f', p.f, 'title', p.title,
        't', floor(extract(epoch from p.updated_at) * 1000)))
      from hvac_notes.positions p where p.user_id = v_user.id), '{}'::jsonb),
    'state', coalesce((select jsonb_object_agg(s.kind, s.data) from hvac_notes.state s where s.user_id = v_user.id), '{}'::jsonb));
end $$;

-- Everyone else's highlights and card notes, plus every reply (on anyone's note, the caller's own included).
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
      from (select * from hvac_notes.cards c where c.user_id <> v_user.id and c.note <> '' order by c.updated_at desc limit 5000) x), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'ref', x.ref, 'body', x.body,
        'by', x.author, 'mine', x.user_id = v_user.id, 'created', x.created_at))
      from (select * from hvac_notes.replies r order by r.created_at desc limit 5000) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Replies
-- ---------------------------------------------------------------------------

-- Reply under a highlight (p_kind 'highlight', p_ref its id) or a card note (p_kind 'card', p_ref the card row id).
create or replace function public.hvac_notes_reply_save(p_kind text, p_ref text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_body text := trim(coalesce(p_body, '')); v_id bigint;
begin
  v_user := core.require_tile('hvac-notes', null);
  if p_kind is null or p_kind not in ('highlight', 'card') then raise exception 'INVALID:kind'; end if;
  if p_ref is null or p_ref !~ '^[a-z0-9]{1,32}$' then raise exception 'INVALID:ref'; end if;
  if char_length(v_body) not between 1 and 5000 then raise exception 'INVALID:body'; end if;
  if p_kind = 'highlight' and not exists (select 1 from hvac_notes.highlights h where h.id = p_ref) then raise exception 'NOT_FOUND'; end if;
  if p_kind = 'card' and (p_ref !~ '^[0-9]{1,18}$' or not exists (select 1 from hvac_notes.cards c where c.id = p_ref::bigint and c.note <> '')) then
    raise exception 'NOT_FOUND';
  end if;
  if (select count(*) from hvac_notes.replies r where r.user_id = v_user.id) >= 20000 then raise exception 'INVALID:replies'; end if;
  insert into hvac_notes.replies (kind, ref, user_id, author, body) values (p_kind, p_ref, v_user.id, v_user.display_name, v_body)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'by', v_user.display_name, 'created', now());
end $$;
revoke execute on function public.hvac_notes_reply_save(text, text, text) from public, anon;
grant execute on function public.hvac_notes_reply_save(text, text, text) to authenticated;

-- Delete a reply: the caller's own, or anyone's with 'edit' (audited). Otherwise NOT_FOUND.
create or replace function public.hvac_notes_reply_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.replies;
begin
  v_user := core.require_tile('hvac-notes', null);
  delete from hvac_notes.replies r
  where r.id = p_id and (r.user_id = v_user.id or core.has_tile(v_user.id, 'hvac-notes', 'edit'))
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.user_id <> v_user.id then
    perform core.audit('hvac-notes', 'reply_removed', jsonb_build_object('author', v_row.author, 'kind', v_row.kind, 'ref', v_row.ref, 'body', left(v_row.body, 500)));
  end if;
end $$;
revoke execute on function public.hvac_notes_reply_delete(bigint) from public, anon;
grant execute on function public.hvac_notes_reply_delete(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Removing a note removes its replies
-- ---------------------------------------------------------------------------

create or replace function public.hvac_notes_highlight_delete(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.highlights;
begin
  v_user := core.require_tile('hvac-notes', null);
  delete from hvac_notes.highlights h
  where h.id = p_id and (h.user_id = v_user.id or core.has_tile(v_user.id, 'hvac-notes', 'edit'))
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from hvac_notes.replies r where r.kind = 'highlight' and r.ref = p_id;
  if v_row.user_id <> v_user.id then
    perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'highlight', 'author', v_row.author,
      'page', v_row.tab || '/' || v_row.slug, 'quote', left(v_row.quote ->> 'exact', 200), 'note', left(v_row.note, 500)));
  end if;
end $$;

-- Colour and note on a card; now returns the row id (so the return type changes: drop and recreate, grants restated).
-- Clearing the note removes its replies.
drop function public.hvac_notes_card_save(text, text, text, text);
create function public.hvac_notes_card_save(p_key text, p_title text, p_color text, p_note text)
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

create or replace function public.hvac_notes_card_remove(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_row hvac_notes.cards;
begin
  v_user := core.require_tile('hvac-notes', 'edit');
  select * into v_row from hvac_notes.cards c where c.id = p_id and c.note <> '';
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from hvac_notes.replies r where r.kind = 'card' and r.ref = p_id::text;
  if v_row.color is null then delete from hvac_notes.cards c where c.id = p_id;
  else update hvac_notes.cards c set note = '', updated_at = now() where c.id = p_id; end if;
  perform core.audit('hvac-notes', 'note_removed', jsonb_build_object('kind', 'card', 'author', v_row.author,
    'card', v_row.key, 'note', left(v_row.note, 500)));
end $$;

select core.applied('hvac-notes', '002_replies');
