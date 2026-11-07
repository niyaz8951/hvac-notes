#!/bin/bash
# Upgrade test (test harness only, not part of the delivery): 006 on a library as live has it.
# Core 001-011, the demo accounts, the tile registered with 'edit' and nb_* rights, tile 001-005 with invented pages,
# notebooks set to Selected users and people (and a group) holding nb_* rights, then 011 again (on live 011 ran after the
# tile existed: rights -> levels, the first declaration with the nb_* rights), then 006. Checks that everyone keeps
# exactly the notebooks he could open.
# Needs what tools/test/db.sh needs. Uses its own database (hvac_upgrade).
set -e
cd "$(dirname "$0")/../.."
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d hvac}"
: "${DAME:=../dame-hub}"
DB=hvac_upgrade
P=$(echo "$PGARGS" | sed "s/-d [^ ]*/-d $DB/")
ADMIN=$(echo "$PGARGS" | sed "s/-d [^ ]*/-d postgres/")
q() { psql $P -q -v ON_ERROR_STOP=1 "$@"; }
psql $ADMIN -qc "drop database if exists $DB"; psql $ADMIN -qc "create database $DB"
q -f "$DAME/dev/test/supabase-stub.sql"
for f in "$DAME"/db/core/0*.sql; do q -f "$f" > /dev/null 2>&1; done
q -f "$DAME/db/core/seed-staging.sql" > /dev/null
q -c "insert into core.tiles (id, name, tagline, icon, sort_order, enabled, rights) values ('hvac-notes', 'HVAC Notes', 'Notes', 'book', 20, true, array['edit', 'nb_theory', 'nb_ahu'])" > /dev/null
for f in db/hvac_notes/00[1-5]*.sql; do q -f "$f" > /dev/null; done
q > /dev/null <<'SQL'
-- invented library: theory (selected), ahu (selected), fcu (all users); one draft in fcu
insert into hvac_notes.library (id, version) values (1, 1) on conflict (id) do update set version = 1;
insert into hvac_notes.sections (tab, nav) values
  ('theory', '[{"slug": "a", "title": "A"}]'), ('ahu', '[{"slug": "b", "title": "B"}]'), ('fcu', '[{"slug": "c", "title": "C"}, {"slug": "d", "title": "D"}]');
insert into hvac_notes.pages (tab, slug, md, status) values
  ('theory', 'a', '# A', 'approved'), ('ahu', 'b', '# B', 'approved'), ('fcu', 'c', '# C', 'approved'), ('fcu', 'd', '# D', 'draft');
insert into hvac_notes.notebooks (tab, audience) values ('theory', 'selected'), ('ahu', 'selected');
-- before 011's level column every row is rights only: the editor (demo_admin), a reader with nb_theory (demo_user),
-- a reader with nothing extra (demo_viewer)
delete from core.tile_access where tile_id = 'hvac-notes';
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select id, 'hvac-notes', false, case username when 'demo_admin' then array['edit'] when 'demo_user' then array['nb_theory'] else '{}' end
  from core.profiles where username in ('demo_admin', 'demo_user', 'demo_viewer');
SQL
# the trigger keeps level not null; 011 again sets the levels from the rights as on live (rows with no level yet)
q -c "alter table core.tile_access disable trigger tile_access_sync; alter table core.tile_access alter column level drop not null; update core.tile_access set level = null where tile_id = 'hvac-notes'; alter table core.tile_access enable trigger tile_access_sync; delete from core.migrations where repo = 'dame-hub' and name = '011_access';" > /dev/null
q -f "$DAME/db/core/011_access.sql" > /dev/null 2>&1
# a group created after 011 that holds nb_ahu (demo_viewer is its member)
q > /dev/null <<'SQL'
insert into core.groups (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'AHU readers');
insert into core.group_members (group_id, user_id) select '00000000-0000-0000-0000-0000000000a1', id from core.profiles where username = 'demo_viewer';
insert into core.tile_group_access (tile_id, group_id, level, rights) values ('hvac-notes', '00000000-0000-0000-0000-0000000000a1', 'read', array['nb_ahu']);
SQL
q -c "select t.access -> 'rights', (select array_agg(username || ':' || level || ':' || array_to_string(a.rights, ',') order by username) from core.tile_access a join core.profiles p on p.id = a.user_id where a.tile_id = 'hvac-notes') from core.tiles t where t.id = 'hvac-notes'" -At | sed 's/^/before 006: /'
q -f db/hvac_notes/006_access.sql 2>&1 | grep -E 'NOTICE:  notebook|ERROR' || true
q -v ON_ERROR_STOP=1 > /dev/null <<'SQL'
create or replace function pg_temp.lv(p_user text) returns jsonb language sql as $$
  select jsonb_object_agg(t.tab, core.container_level((select id from core.profiles where username = p_user), 'hvac-notes', 'notebook', t.tab))
  from (values ('theory'), ('ahu'), ('fcu')) t(tab) $$;
do $$
declare v jsonb;
begin
  if (select rights from core.tiles where id = 'hvac-notes') <> '{}' or (select access -> 'rights' from core.tiles where id = 'hvac-notes') <> '{}'::jsonb
     or exists (select 1 from core.tile_access where tile_id = 'hvac-notes' and rights <> '{}')
     or exists (select 1 from core.tile_group_access where tile_id = 'hvac-notes' and rights <> '{}') then raise exception 'nb_* rights left'; end if;
  if (select array_agg(id || ':' || coalesce(everyone, '-') || ':' || coalesce(owner_id::text, '-') order by id) from core.containers where tile_id = 'hvac-notes')
     <> array['ahu:-:-', 'fcu:edit:-', 'theory:-:-'] then raise exception 'containers %', (select array_agg(id || everyone) from core.containers where tile_id = 'hvac-notes'); end if;
  v := pg_temp.lv('demo_admin');   -- edit right -> level edit, and Can edit of both selected notebooks
  if v <> '{"theory": "edit", "ahu": "edit", "fcu": "edit"}'::jsonb then raise exception 'demo_admin %', v; end if;
  v := pg_temp.lv('demo_user');    -- nb_theory -> Can edit of theory (his level: contribute); ahu stays closed
  if v <> '{"theory": "contribute", "ahu": null, "fcu": "contribute"}'::jsonb then raise exception 'demo_user %', v; end if;
  v := pg_temp.lv('demo_viewer');  -- group AHU readers held nb_ahu -> the group has Can edit of ahu (his level: contribute)
  if v <> '{"theory": null, "ahu": "contribute", "fcu": "contribute"}'::jsonb then raise exception 'demo_viewer %', v; end if;
  if to_regclass('hvac_notes.notebooks') is not null then raise exception 'notebooks table kept'; end if;
  if (select count(*) from core.security_check()) <> 0 then raise exception 'security_check %', (select array_agg(problem || ' ' || object) from core.security_check()); end if;
  if not exists (select 1 from core.migrations where repo = 'hvac-notes' and name = '006_access') then raise exception '006 not recorded'; end if;
  raise notice 'UPGRADE CHECKS PASSED';
end $$;
SQL
