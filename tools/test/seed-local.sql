-- Local test database only (tools/test/db.sh + mock.mjs): gives the demo accounts their HVAC Notes access for a browser run.
--   demo_admin  tile admin with the right 'edit' (publishes, approves)   demo_user  the tile, reading only   demo_none  no tile
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select id, 'hvac-notes', true, array['edit'] from core.profiles where username = 'demo_admin'
  on conflict (user_id, tile_id) do update set rights = array['edit'], is_admin = true;
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select id, 'hvac-notes', false, '{}' from core.profiles where username = 'demo_user'
  on conflict (user_id, tile_id) do update set rights = '{}';
