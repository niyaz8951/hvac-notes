-- HVAC Notes tile: shared highlights, card notes and replies with the author's current name, without a temp table.
-- Replaces 003_names.sql. On live, 003 stopped every user from seeing anyone else's notes (2026-11-05); the owner put the
-- 002 body back by hand. 003 created a temp table inside this security definer function; this version only reads:
-- one statement, the names read once from core.display_names (a materialized CTE) and joined to each list.
-- Same output as 003: 'by' = the core's current display name, or the name saved with the record when the core does not
-- name the account (pending or deleted). Same guard, security definer, search_path = '', grants unchanged.
-- Run after db/core/006_display_names.sql and 002_replies.sql (003 may or may not have run; this replaces it either way).
-- Touches only: public.hvac_notes_shared (replaced). No table, no data, no grant changes.

create or replace function public.hvac_notes_shared()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  return (
    with names as materialized (
      -- the 500 most recently active authors (the core's limit); anyone beyond keeps the saved name
      select d.id, d.display_name from core.display_names('hvac-notes', (
        select array_agg(u.id) from (
          select x.user_id as id from (
            select h.user_id, h.updated_at as at from hvac_notes.highlights h
            union all select c.user_id, c.updated_at from hvac_notes.cards c where c.note <> ''
            union all select r.user_id, r.created_at from hvac_notes.replies r) x
          group by x.user_id order by max(x.at) desc limit 500) u)) d)
    select jsonb_build_object(
      'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tab', x.tab, 'slug', x.slug, 'title', x.title,
          'color', x.color, 'note', x.note, 'quote', x.quote, 'by', coalesce(n.display_name, x.author),
          'created', x.created_at, 'updated', x.updated_at) order by x.updated_at desc)
        from (select * from hvac_notes.highlights h where h.user_id <> v_user.id order by h.updated_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'key', x.key, 'title', x.title, 'note', x.note,
          'by', coalesce(n.display_name, x.author), 'updated', x.updated_at) order by x.updated_at desc)
        from (select * from hvac_notes.cards c where c.user_id <> v_user.id and c.note <> '' order by c.updated_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb),
      'replies', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'ref', x.ref, 'body', x.body,
          'by', coalesce(n.display_name, x.author), 'mine', x.user_id = v_user.id, 'created', x.created_at) order by x.created_at desc)
        from (select * from hvac_notes.replies r order by r.created_at desc limit 5000) x
        left join names n on n.id = x.user_id), '[]'::jsonb)));
end $$;
revoke execute on function public.hvac_notes_shared() from public, anon;
grant execute on function public.hvac_notes_shared() to authenticated;

select core.applied('hvac-notes', '004_names_no_temp');
