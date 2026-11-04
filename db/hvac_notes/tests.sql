-- HVAC Notes tile tests. Run on STAGING after db/core/seed-staging.sql and db/hvac_notes/001_init.sql. Everything is rolled back.
-- Needs: the tile 'hvac-notes' registered and switched on with the right 'edit' (admin page), and the demo accounts.
-- Inside the transaction (then rolled back) it gives demo_admin the tile with 'edit', demo_user the tile without rights,
-- and disables demo_none for one check. For every function: an allowed call, and refused calls for signed out,
-- pending, disabled, no tile, no right and another user's record.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'hvac-notes' and enabled and 'edit' = any (rights)) then
    raise exception 'Register the tile hvac-notes with the right "edit" and switch it on in the admin page first.';
  end if;
  if (select count(*) from core.profiles where username in ('demo_admin', 'demo_user', 'demo_none', 'demo_pending')) <> 4 then
    raise exception 'Run db/core/seed-staging.sql first (demo accounts).';
  end if;
end $$;

create temp table t_ids as select username k, id from core.profiles where username in ('demo_admin', 'demo_user', 'demo_none', 'demo_pending');
grant select on t_ids to public;
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select id, 'hvac-notes', false, array['edit'] from t_ids where k = 'demo_admin'
  on conflict (user_id, tile_id) do update set rights = array['edit'], is_admin = false;
insert into core.tile_access (user_id, tile_id, is_admin, rights)
  select id, 'hvac-notes', false, '{}' from t_ids where k = 'demo_user'
  on conflict (user_id, tile_id) do update set rights = '{}', is_admin = false;
delete from core.tile_access where tile_id = 'hvac-notes' and user_id = (select id from t_ids where k = 'demo_none');

create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.core_session_start();
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlerrm = p_code or (p_code in ('PERMISSION', 'RLS') and sqlstate = '42501') then return; end if;
  if sqlerrm like 'expected error%' then raise; end if;
  raise exception 'expected % but got % (%) from: %', p_code, sqlerrm, sqlstate, p_sql;
end $$;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text) to public;

do $$
declare v jsonb; n int; v_ver int;
  q_ok constant text := $j${"exact": "the condenser rejects heat", "prefix": "In summer ", "suffix": " to the air"}$j$;
  -- every function with arguments that would be valid for an editor
  calls constant text[] := array[
    'select public.hvac_notes_library()',
    'select public.hvac_notes_page(''theory'', ''example'')',
    'select * from public.hvac_notes_pages(null)',
    'select public.hvac_notes_my_data()',
    'select public.hvac_notes_highlight_save(''abc123'', ''theory'', ''example'', ''T'', ''yellow'', '''', ''{"exact": "x"}''::jsonb)',
    'select public.hvac_notes_highlight_delete(''abc123'')',
    'select public.hvac_notes_card_save(''theory/terms/cop'', ''COP'', ''mint'', ''n'')',
    'select public.hvac_notes_position_save(''theory/example'', 0.5, ''T'')',
    'select public.hvac_notes_state_save(''review'', ''{}''::jsonb)',
    'select public.hvac_notes_my_import(''{}''::jsonb)',
    'select public.hvac_notes_publish_export()',
    'select public.hvac_notes_publish_commit(0, ''{}''::jsonb, ''[]''::jsonb, ''{}'', ''[]''::jsonb, ''{}'', null, ''_library/index-a.json'', ''_library/growth-a.json'')'];
  publish constant text[] := array[calls[11], calls[12]];
  c text;
begin
  -- signed out: anon may execute nothing
  perform pg_temp.act_as(null);
  foreach c in array calls loop perform pg_temp.expect_error(c, 'PERMISSION'); end loop;
  reset role;

  -- pending account
  perform pg_temp.act_as('demo_pending');
  foreach c in array calls loop perform pg_temp.expect_error(c, 'NOT_APPROVED'); end loop;
  reset role;

  -- no tile
  perform pg_temp.act_as('demo_none');
  foreach c in array calls loop perform pg_temp.expect_error(c, 'NO_ACCESS'); end loop;
  reset role;

  -- disabled account (rolled back): the core ends his session
  update core.profiles set status = 'disabled' where username = 'demo_none';
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(calls[1], 'SIGNED_OUT');
  perform pg_temp.expect_error(calls[4], 'SIGNED_OUT');
  reset role;
  update core.profiles set status = 'active' where username = 'demo_none';

  -- reader (tile, no right): publishing and writing to the bucket are refused
  perform pg_temp.act_as('demo_user');
  foreach c in array publish loop perform pg_temp.expect_error(c, 'NO_RIGHT'); end loop;
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/x.svg')$q$, 'RLS');
  reset role;

  -- editor publishes: invalid input is refused, then a valid publish
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(5, '{}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:version');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, 'index.json', '_library/growth-a.json')$q$, 'INVALID:index_path');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{"theory": "not json"}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:navs');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{"theory": "{}"}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:navs');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{}'::jsonb, '[{"tab": "Theory", "slug": "x", "md": "# X"}]'::jsonb, '{}', '[]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:pages');
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{}'::jsonb, '[]'::jsonb, '{}', '[{"path": "../x.svg", "size": 1, "sha": "00"}]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:files');
  -- bucket: only images and library files, nothing else
  insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/example.svg');
  insert into storage.objects (bucket_id, name) values ('hvac-notes', '_library/index-v1.json');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/example.md')$q$, 'RLS');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', '_library/other.json')$q$, 'RLS');
  select public.hvac_notes_publish_commit(0,
    jsonb_build_object('theory', '[{"slug": "example", "title": "Example page"}]', 'chillers', '[{"slug": "gone", "title": "Gone"}]'),
    '[{"tab": "theory", "slug": "example", "md": "# Example page\n\nInvented text for testing.\n\n## Sources\n\n1. Invented."},
      {"tab": "chillers", "slug": "gone", "md": "# Gone"}]'::jsonb,
    '{}', jsonb_build_array(jsonb_build_object('path', 'theory/images/example.svg', 'size', 10, 'sha', repeat('a', 64))), '{}',
    E'# Credits\n', '_library/index-v1.json', '_library/growth-v1.json') into v;
  if (v ->> 'version')::int <> 1 then raise exception 'publish version %', v; end if;
  -- a second publish from the same base is stale
  perform pg_temp.expect_error($q$select public.hvac_notes_publish_commit(0, '{}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, '_library/index-a.json', '_library/growth-a.json')$q$, 'INVALID:version');
  -- remove a notebook and its page
  select public.hvac_notes_publish_commit(1, '{"chillers": null}'::jsonb, '[]'::jsonb, array['chillers/gone'], '[]'::jsonb, '{}', null,
    '_library/index-v2.json', '_library/growth-v2.json') into v;
  select public.hvac_notes_publish_export() into v;
  if (v ->> 'version')::int <> 2 or jsonb_array_length(v -> 'pages') <> 1 or (v -> 'navs') ? 'chillers' or v ->> 'credits' <> E'# Credits\n'
     or jsonb_array_length(v -> 'files') <> 1 then raise exception 'export %', v; end if;
  reset role;

  -- reader reads
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if v ->> 'index_path' <> '_library/index-v2.json' or not (v -> 'navs') ? 'theory' then raise exception 'library %', v; end if;
  select public.hvac_notes_page('theory', 'example') into v;
  if v ->> 'md' not like '# Example page%' then raise exception 'page %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'nothing')$q$, 'NOT_FOUND');
  select count(*) into n from public.hvac_notes_pages(array['theory/example', 'theory/nothing']); if n <> 1 then raise exception 'pages %', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 2 then raise exception 'reader sees bucket: %', n; end if;
  perform pg_temp.expect_error($q$select count(*) from public.hvac_notes_pages((select array_agg('theory/x' || g) from generate_series(1, 301) g))$q$, 'INVALID:routes');

  -- reader's own data
  perform public.hvac_notes_highlight_save('abc123', 'theory', 'example', 'Example page', 'yellow', '', q_ok::jsonb);
  perform public.hvac_notes_highlight_save('abc123', 'theory', 'example', 'Example page', 'green', 'my note', q_ok::jsonb);
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('ABC', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'INVALID:id');
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc124', 'theory', 'example', '', 'orange', '', '{"exact": "x"}'::jsonb)$q$, 'INVALID:color');
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc124', 'theory', 'example', '', 'yellow', '', '{"exact": ""}'::jsonb)$q$, 'INVALID:quote');
  perform public.hvac_notes_card_save('theory/terms/cop', 'COP', 'mint', 'remember this');
  perform public.hvac_notes_card_save('theory/terms/eer', 'EER', null, '');
  perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/terms', 'x', 'mint', '')$q$, 'INVALID:key');
  perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/terms/x', 'x', 'red', '')$q$, 'INVALID:color');
  perform public.hvac_notes_position_save('theory/example', 0.42, 'Example page');
  perform pg_temp.expect_error($q$select public.hvac_notes_position_save('theory/example', 1.5, '')$q$, 'INVALID:f');
  perform pg_temp.expect_error($q$select public.hvac_notes_position_save('theory/example', 'NaN', '')$q$, 'INVALID:f');
  perform public.hvac_notes_state_save('review', '{"theory/example#k1": {"box": 1, "due": 0}}'::jsonb);
  perform pg_temp.expect_error($q$select public.hvac_notes_state_save('other', '{}'::jsonb)$q$, 'INVALID:kind');
  perform pg_temp.expect_error($q$select public.hvac_notes_state_save('seen', '[]'::jsonb)$q$, 'INVALID:data');
  select public.hvac_notes_my_import(jsonb_build_object(
    'highlights', jsonb_build_array(jsonb_build_object('id', 'old1', 'tab', 'theory', 'slug', 'example', 'title', 'T', 'color', 'blue', 'note', '',
                                                        'quote', jsonb_build_object('exact', 'invented', 'prefix', '', 'suffix', '')),
                                    jsonb_build_object('id', 'abc123', 'tab', 'theory', 'slug', 'example', 'color', 'blue', 'quote', jsonb_build_object('exact', 'dup')),
                                    jsonb_build_object('id', 'bad id', 'tab', 'theory', 'slug', 'example', 'color', 'blue', 'quote', jsonb_build_object('exact', 'x'))),
    'cards', jsonb_build_object('theory/terms/kw', jsonb_build_object('note', 'n'), 'bad', jsonb_build_object('note', 'n')),
    'positions', jsonb_build_object('theory/other', jsonb_build_object('f', 0.2), 'theory/example', jsonb_build_object('f', 0.9)))) into v;
  if v <> '{"highlights": 1, "cards": 1, "positions": 1}'::jsonb then raise exception 'import %', v; end if;
  select public.hvac_notes_my_data() into v;
  if jsonb_array_length(v -> 'highlights') <> 2 or v -> 'highlights' -> 0 ->> 'color' <> 'green'
     or not (v -> 'cards') ? 'theory/terms/cop' or (v -> 'cards') ? 'theory/terms/eer'
     or abs((v -> 'positions' -> 'theory/example' ->> 'f')::numeric - 0.42) > 0.001 or not (v -> 'state') ? 'review' then
    raise exception 'my data %', v;
  end if;
  -- clearing a card's colour and note removes it
  perform public.hvac_notes_card_save('theory/terms/cop', 'COP', null, '');
  select count(*) into n from jsonb_object_keys((public.hvac_notes_my_data()) -> 'cards'); if n <> 1 then raise exception 'card clear %', n; end if;
  reset role;

  -- another user sees none of it, and cannot delete it
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_my_data() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or v -> 'cards' <> '{}'::jsonb or v -> 'positions' <> '{}'::jsonb or v -> 'state' <> '{}'::jsonb then
    raise exception 'other user sees data %', v;
  end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_delete('abc123')$q$, 'NOT_FOUND');
  -- the same highlight id for another user is his own row
  perform public.hvac_notes_highlight_save('abc123', 'theory', 'example', '', 'pink', '', '{"exact": "his own"}'::jsonb);
  reset role;

  perform pg_temp.act_as('demo_user');
  perform public.hvac_notes_highlight_delete('abc123');
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_delete('abc123')$q$, 'NOT_FOUND');
  select count(*) into n from jsonb_array_elements((public.hvac_notes_my_data()) -> 'highlights'); if n <> 1 then raise exception 'after delete %', n; end if;
  reset role;

  perform pg_temp.act_as('demo_admin');
  select count(*) into n from jsonb_array_elements((public.hvac_notes_my_data()) -> 'highlights'); if n <> 1 then raise exception 'admin highlight kept %', n; end if;
  reset role;

  -- no tile: the bucket shows nothing and refuses writes
  perform pg_temp.act_as('demo_none');
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'no-tile user sees bucket: %', n; end if;
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/y.svg')$q$, 'RLS');
  reset role;

  -- reader cannot delete from the bucket (the row stays)
  perform pg_temp.act_as('demo_user');
  delete from storage.objects where bucket_id = 'hvac-notes';
  reset role;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 2 then raise exception 'reader deleted from bucket: %', n; end if;
  perform pg_temp.act_as('demo_admin');
  delete from storage.objects where bucket_id = 'hvac-notes';
  reset role;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'editor delete: %', n; end if;

  -- the tables are not reachable directly
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error('select count(*) from hvac_notes.pages', 'PERMISSION');
  perform pg_temp.expect_error('select count(*) from hvac_notes.highlights', 'PERMISSION');
  reset role;

  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'publish'; if n < 2 then raise exception 'audit %', n; end if;
  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;
  raise notice 'ALL HVAC NOTES TESTS PASSED';
end $$;

rollback;
