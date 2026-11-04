-- HVAC Notes tile: author names from the core (core.display_names, db/core/006_display_names.sql) instead of the name
-- saved with each record. Run after db/core/006_display_names.sql and 002_replies.sql. Read it first.
-- Touches only: public.hvac_notes_shared (replaced). The saved name stays as the fallback for an account the core
-- does not name (pending or deleted).

create or replace function public.hvac_notes_shared()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('hvac-notes', null);
  create temp table if not exists t_hn_names (id uuid primary key, display_name text) on commit drop;
  delete from t_hn_names;
  insert into t_hn_names
    select d.id, d.display_name from core.display_names('hvac-notes', (
      select array_agg(u.id) from (
        select x.user_id as id from (
          select h.user_id, h.updated_at from hvac_notes.highlights h
          union all select c.user_id, c.updated_at from hvac_notes.cards c where c.note <> ''
          union all select r.user_id, r.created_at from hvac_notes.replies r) x
        group by x.user_id order by max(x.updated_at) desc limit 500) u)) d;
  return jsonb_build_object(
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tab', x.tab, 'slug', x.slug, 'title', x.title,
        'color', x.color, 'note', x.note, 'quote', x.quote, 'by', coalesce(n.display_name, x.author), 'created', x.created_at, 'updated', x.updated_at))
      from (select * from hvac_notes.highlights h where h.user_id <> v_user.id order by h.updated_at desc limit 5000) x
      left join t_hn_names n on n.id = x.user_id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'key', x.key, 'title', x.title, 'note', x.note,
        'by', coalesce(n.display_name, x.author), 'updated', x.updated_at))
      from (select * from hvac_notes.cards c where c.user_id <> v_user.id and c.note <> '' order by c.updated_at desc limit 5000) x
      left join t_hn_names n on n.id = x.user_id), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'ref', x.ref, 'body', x.body,
        'by', coalesce(n.display_name, x.author), 'mine', x.user_id = v_user.id, 'created', x.created_at))
      from (select * from hvac_notes.replies r order by r.created_at desc limit 5000) x
      left join t_hn_names n on n.id = x.user_id), '[]'::jsonb));
end $$;

select core.applied('hvac-notes', '003_names');
