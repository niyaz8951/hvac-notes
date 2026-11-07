-- Local test database only (tools/test/db.sh + mock.mjs): gives the demo accounts their HVAC Notes level for a browser run.
--   demo_admin  manage (publishes, approves, shares notebooks)   demo_user  contribute   demo_viewer  read   demo_none  no tile
delete from core.tile_access where tile_id = 'hvac-notes';
insert into core.tile_access (user_id, tile_id, level)
  select id, 'hvac-notes', case username when 'demo_admin' then 'manage' when 'demo_user' then 'contribute' else 'read' end
  from core.profiles where username in ('demo_admin', 'demo_user', 'demo_viewer');
