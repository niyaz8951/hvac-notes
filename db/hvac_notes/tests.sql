-- HVAC Notes tile tests. Run on STAGING after db/core/seed-staging.sql and every db/hvac_notes/0*.sql file. Everything is rolled back.
-- Needs: the tile 'hvac-notes' registered with the right 'edit' (admin page; it may stay off), and the demo accounts.
-- Inside the transaction (then rolled back) it gives demo_admin the tile with 'edit', demo_user the tile without rights,
-- and disables demo_none for one check. For every function: an allowed call, and refused calls for signed out,
-- pending, disabled, no tile, no right and another user's record.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'hvac-notes' and 'edit' = any (rights)) then
    raise exception 'Register the tile hvac-notes with the right "edit" in the admin page first.';
  end if;
  if (select count(*) from core.profiles where username in ('demo_admin', 'demo_user', 'demo_none', 'demo_pending')) <> 4 then
    raise exception 'Run db/core/seed-staging.sql first (demo accounts).';
  end if;
end $$;
-- The tile is switched on for the test only (rolled back with everything else).
update core.tiles set enabled = true where id = 'hvac-notes';

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
  execute 'reset role';
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now()); -- as Supabase Auth at sign-in
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
    'select public.hvac_notes_publish_commit(0, ''{}''::jsonb, ''[]''::jsonb, ''{}'', ''[]''::jsonb, ''{}'', null, ''{"v": 1, "pages": []}''::jsonb, ''{"v": 1, "days": []}''::jsonb)',
    'select public.hvac_notes_shared()',
    'select public.hvac_notes_card_remove(1)',
    'select public.hvac_notes_reply_save(''highlight'', ''abc123'', ''x'')',
    'select public.hvac_notes_reply_delete(1)',
    'select public.hvac_notes_index()',
    'select public.hvac_notes_growth()',
    'select public.hvac_notes_page_status(array[''theory/example''], ''approved'')',
    'select public.hvac_notes_notebook_set(''theory'', ''selected'')'];
  publish constant text[] := array[calls[11], calls[12], calls[14]];
  admin_only constant text[] := array[calls[19], calls[20]];
  -- an index and a timeline for the publishes below (invented)
  i0 constant text := '{"v": 1, "pages": []}';
  g0 constant text := '{"v": 1, "days": []}';
  idx1 jsonb := jsonb_build_object('v', 1, 'pages', jsonb_build_array(
    jsonb_build_object('tab', 'theory', 'slug', 'example', 'title', 'Example page', 'links', jsonb_build_array('theory/draft', 'theory/terms')),
    jsonb_build_object('tab', 'theory', 'slug', 'terms', 'title', 'Terms', 'links', '[]'::jsonb),
    jsonb_build_object('tab', 'theory', 'slug', 'draft', 'title', 'Draft page', 'links', jsonb_build_array('theory/example'))));
  growth1 jsonb := jsonb_build_object('v', 1, 'days', jsonb_build_array(
    jsonb_build_object('date', '2026-11-01', 'items', jsonb_build_array(jsonb_build_object('route', 'theory/example', 'kind', 'new'),
                                                                        jsonb_build_object('route', 'theory/draft', 'kind', 'new'))),
    jsonb_build_object('date', '2026-11-02', 'items', jsonb_build_array(jsonb_build_object('route', 'theory/draft', 'kind', 'grew'))),
    jsonb_build_object('date', '2026-11-03', 'items', jsonb_build_array(jsonb_build_object('route', 'theory/old-example', 'kind', 'grew')))));
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
  foreach c in array admin_only loop perform pg_temp.expect_error(c, 'NO_RIGHT'); end loop;
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/x.svg')$q$, 'RLS');
  reset role;

  -- editor publishes: invalid input is refused, then a valid publish
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(5, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:version');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[]', '{}', '{"pages": {}}', g0), 'INVALID:index');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[]', '{}', i0, '{"days": 1}'), 'INVALID:growth');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[]', '{}', '{"v": 1, "pages": [{"tab": "../x", "slug": "y"}]}', g0), 'INVALID:index');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{"theory": "not json"}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:navs');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{"theory": "{}"}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:navs');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[{"tab": "Theory", "slug": "x", "md": "# X"}]', '{}', '[]', '{}', i0, g0), 'INVALID:pages');
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[{"path": "../x.svg", "size": 1, "sha": "00"}]', '{}', i0, g0), 'INVALID:files');
  -- bucket: only images (the index and timeline are no longer files)
  insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/example.svg');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', '_library/index-v1.json')$q$, 'RLS');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/example.md')$q$, 'RLS');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', '_library/other.json')$q$, 'RLS');
  -- theory: example (related: the draft), terms, draft; refrigeration links the draft and example; chillers/gone
  select public.hvac_notes_publish_commit(0,
    jsonb_build_object('theory', '[{"slug": "example", "title": "Example page", "related": ["theory/draft", "theory/terms"], "aliases": ["old-example"]}, {"slug": "terms", "title": "Terms", "layout": "cards"}, {"slug": "draft", "title": "Draft page", "prereq": ["theory/example"]}]',
                       'refrigeration', '[{"link": "theory/draft"}, {"link": "theory/example", "group": "Linked"}]',
                       'chillers', '[{"slug": "gone", "title": "Gone"}]'),
    '[{"tab": "theory", "slug": "example", "md": "# Example page\n\nInvented text for testing.\n\n## Sources\n\n1. Invented."},
      {"tab": "theory", "slug": "terms", "md": "# Terms\n\n### COP\n\nInvented."},
      {"tab": "theory", "slug": "draft", "md": "# Draft page\n\nInvented draft text."},
      {"tab": "chillers", "slug": "gone", "md": "# Gone"}]'::jsonb,
    '{}', jsonb_build_array(jsonb_build_object('path', 'theory/images/example.svg', 'size', 10, 'sha', repeat('a', 64))), '{}',
    E'# Credits\n', idx1, growth1) into v;
  if (v ->> 'version')::int <> 1 or (v ->> 'drafts')::int <> 4 then raise exception 'publish version %', v; end if;
  -- a second publish from the same base is stale
  perform pg_temp.expect_error(format('select public.hvac_notes_publish_commit(0, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)', '{}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:version');
  -- remove a notebook and its page
  select public.hvac_notes_publish_commit(1, '{"chillers": null}'::jsonb, '[]'::jsonb, array['chillers/gone'], '[]'::jsonb, '{}', null, idx1, growth1) into v;
  select public.hvac_notes_publish_export() into v;
  if (v ->> 'version')::int <> 2 or jsonb_array_length(v -> 'pages') <> 3 or (v -> 'navs') ? 'chillers' or v ->> 'credits' <> E'# Credits\n'
     or jsonb_array_length(v -> 'files') <> 1 or jsonb_array_length(v -> 'index' -> 'pages') <> 3 or v -> 'index' -> 'pages' -> 0 ->> 'slug' <> 'example'
     or v -> 'growth' <> growth1 or v -> 'status' <> '{"theory/draft": "draft", "theory/terms": "draft", "theory/example": "draft"}'::jsonb
     or (v ->> 'approver')::boolean then raise exception 'export %', v; end if;
  -- the editor sees drafts, but only a tile admin approves or opens notebooks
  select public.hvac_notes_library() into v;
  if not (v ->> 'editor')::boolean or (v ->> 'approver')::boolean or jsonb_array_length(v -> 'drafts') <> 3 then raise exception 'editor library %', v; end if;
  select public.hvac_notes_page('theory', 'draft') into v; if v ->> 'status' <> 'draft' then raise exception 'editor draft page %', v; end if;
  foreach c in array admin_only loop perform pg_temp.expect_error(c, 'NO_RIGHT'); end loop;
  reset role;

  -- new pages are drafts: a reader gets none of them
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if (v ->> 'editor')::boolean or v -> 'navs' ->> 'theory' <> '[]' or v -> 'navs' ->> 'refrigeration' <> '[]' or v -> 'drafts' <> '[]'::jsonb then raise exception 'reader library with drafts %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
  select count(*) into n from public.hvac_notes_pages(null); if n <> 0 then raise exception 'reader pages with drafts %', n; end if;
  if jsonb_array_length((public.hvac_notes_index()) -> 'pages') <> 0 or jsonb_array_length((public.hvac_notes_growth()) -> 'days') <> 0 then raise exception 'reader index/growth with drafts'; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc999', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/terms/cop', 'COP', 'mint', 'n')$q$, 'NOT_FOUND');
  reset role;

  -- the tile admin approves example and terms (draft stays a draft)
  update core.tile_access set is_admin = true where tile_id = 'hvac-notes' and user_id = (select id from t_ids where k = 'demo_admin');
  perform pg_temp.act_as('demo_admin');
  if not ((public.hvac_notes_library()) ->> 'approver')::boolean then raise exception 'tile admin is not approver'; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status(array['theory/example', 'theory/nothing'], 'approved')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status(array['theory/example'], 'live')$q$, 'INVALID:status');
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status('{}', 'approved')$q$, 'INVALID:routes');
  select public.hvac_notes_page_status(array['theory/example', 'theory/terms'], 'approved') into v;
  if (v ->> 'changed')::int <> 2 then raise exception 'approve %', v; end if;
  select public.hvac_notes_page_status(array['theory/example'], 'approved') into v;
  if (v ->> 'changed')::int <> 0 then raise exception 'approve again %', v; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'page_approved'; if n <> 1 then raise exception 'approve audit %', n; end if;

  -- the reader now reads them; the draft and every trace of it stay out
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if v -> 'navs' ->> 'theory' is null
     or (v -> 'navs' ->> 'theory')::jsonb <> '[{"slug": "example", "title": "Example page", "related": ["theory/terms"], "aliases": ["old-example"]}, {"slug": "terms", "title": "Terms", "layout": "cards"}]'::jsonb
     or (v -> 'navs' ->> 'refrigeration')::jsonb <> '[{"link": "theory/example", "group": "Linked"}]'::jsonb then raise exception 'reader navs %', v -> 'navs'; end if;
  select public.hvac_notes_index() into v;
  if jsonb_array_length(v -> 'pages') <> 2 or v -> 'pages' -> 0 ->> 'slug' <> 'example' or v -> 'pages' -> 0 -> 'links' <> '["theory/terms"]'::jsonb then raise exception 'reader index %', v; end if;
  select public.hvac_notes_growth() into v;
  if v <> '{"v": 1, "days": [{"date": "2026-11-01", "items": [{"route": "theory/example", "kind": "new"}]}, {"date": "2026-11-03", "items": [{"route": "theory/old-example", "kind": "grew"}]}]}'::jsonb then
    raise exception 'reader growth %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'draft')$q$, 'NOT_FOUND');
  select count(*) into n from public.hvac_notes_pages(array['theory/example', 'theory/draft']); if n <> 1 then raise exception 'reader pages %', n; end if;
  reset role;

  -- reader reads
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if (v ? 'index_path') or not (v -> 'navs') ? 'theory' or (v ->> 'version')::int <> 2 then raise exception 'library %', v; end if;
  select public.hvac_notes_page('theory', 'example') into v;
  if v ->> 'md' not like '# Example page%' then raise exception 'page %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'nothing')$q$, 'NOT_FOUND');
  select count(*) into n from public.hvac_notes_pages(array['theory/example', 'theory/nothing']); if n <> 1 then raise exception 'pages %', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader sees bucket: %', n; end if;
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

  -- another user: none of the reader's private data, but his highlights and card notes, with his name
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_my_data() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or v -> 'cards' <> '{}'::jsonb or v -> 'positions' <> '{}'::jsonb or v -> 'state' <> '{}'::jsonb then
    raise exception 'other user sees private data %', v;
  end if;
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 2 or jsonb_array_length(v -> 'cards') <> 1
     or not exists (select 1 from jsonb_array_elements(v -> 'highlights') x where x ->> 'id' = 'abc123' and x ->> 'note' = 'my note' and x ->> 'by' = 'Demo User')
     or v -> 'cards' -> 0 ->> 'by' <> 'Demo User' or v -> 'cards' -> 0 ->> 'key' <> 'theory/terms/kw' or (v -> 'cards' -> 0) ? 'color' then
    raise exception 'shared for admin %', v;
  end if;
  -- names come from the core: a renamed author shows his new name at once
  reset role;
  update core.profiles set display_name = 'Demo User Renamed' where username = 'demo_user';
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_shared() into v;
  if v -> 'cards' -> 0 ->> 'by' <> 'Demo User Renamed' then raise exception 'name not from core: %', v -> 'cards' -> 0; end if;
  reset role;
  update core.profiles set display_name = 'Demo User' where username = 'demo_user';
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_shared() into v;
  -- he answers the reader's highlight and card note
  perform public.hvac_notes_reply_save('highlight', 'abc123', 'An answer from the admin');
  perform public.hvac_notes_reply_save('card', v -> 'cards' -> 0 ->> 'id', 'Card answer');
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('highlight', 'nothere', 'x')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('card', '999999', 'x')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('highlight', 'abc123', '  ')$q$, 'INVALID:body');
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('other', 'abc123', 'x')$q$, 'INVALID:kind');
  -- he cannot take over the reader's highlight; he saves his own
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc123', 'theory', 'example', '', 'pink', '', '{"exact": "his own"}'::jsonb)$q$, 'INVALID:id');
  perform public.hvac_notes_highlight_save('adm001', 'theory', 'example', '', 'pink', 'admin note', '{"exact": "his own"}'::jsonb);
  perform public.hvac_notes_card_save('theory/terms/kw', 'kW', 'sand', 'admin card note');
  select count(*) into n from jsonb_array_elements((public.hvac_notes_shared()) -> 'highlights'); if n <> 2 then raise exception 'own in shared %', n; end if;
  reset role;

  -- the reader sees the editor's notes but cannot delete them; deletes his own
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 1 or v -> 'highlights' -> 0 ->> 'by' <> 'Demo Admin' or v -> 'highlights' -> 0 ->> 'note' <> 'admin note'
     or jsonb_array_length(v -> 'cards') <> 1 or v -> 'cards' -> 0 ->> 'note' <> 'admin card note' then raise exception 'shared for reader %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_delete('adm001')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.hvac_notes_card_remove(%s)', v -> 'cards' -> 0 ->> 'id'), 'NO_RIGHT');
  -- the replies on his notes, with the author's name; he replies back, deletes his own, cannot delete the admin's
  if jsonb_array_length(v -> 'replies') <> 2 or not exists (select 1 from jsonb_array_elements(v -> 'replies') x where x ->> 'by' = 'Demo Admin' and x ->> 'ref' = 'abc123' and (x ->> 'mine')::boolean = false) then
    raise exception 'replies for reader %', v -> 'replies'; end if;
  select public.hvac_notes_reply_save('highlight', 'abc123', 'Thanks') into v;
  perform public.hvac_notes_reply_delete((v ->> 'id')::bigint);
  perform pg_temp.expect_error(format('select public.hvac_notes_reply_delete(%s)', v ->> 'id'), 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  perform pg_temp.expect_error(format('select public.hvac_notes_reply_delete(%s)', (select x ->> 'id' from jsonb_array_elements(v -> 'replies') x where x ->> 'by' = 'Demo Admin' limit 1)), 'NOT_FOUND');
  perform public.hvac_notes_highlight_delete('abc123');
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_delete('abc123')$q$, 'NOT_FOUND');
  select count(*) into n from jsonb_array_elements((public.hvac_notes_shared()) -> 'replies') x where x ->> 'ref' = 'abc123'; if n <> 0 then raise exception 'replies kept after delete %', n; end if;
  select count(*) into n from jsonb_array_elements((public.hvac_notes_my_data()) -> 'highlights'); if n <> 1 then raise exception 'after delete %', n; end if;
  reset role;

  -- the editor removes the reader's remaining highlight and card note (audited)
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_shared() into v;
  perform public.hvac_notes_highlight_delete('old1');
  perform public.hvac_notes_card_remove((v -> 'cards' -> 0 ->> 'id')::bigint);
  perform pg_temp.expect_error(format('select public.hvac_notes_card_remove(%s)', v -> 'cards' -> 0 ->> 'id'), 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or jsonb_array_length(v -> 'cards') <> 0 or jsonb_array_length(v -> 'replies') <> 0 then raise exception 'after removal %', v; end if;
  select count(*) into n from jsonb_array_elements((public.hvac_notes_my_data()) -> 'highlights'); if n <> 1 then raise exception 'admin highlight kept %', n; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'note_removed'; if n <> 2 then raise exception 'removal audit %', n; end if;

  -- no tile: the bucket shows nothing and refuses writes
  perform pg_temp.act_as('demo_none');
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'no-tile user sees bucket: %', n; end if;
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/y.svg')$q$, 'RLS');
  reset role;

  -- reader cannot delete from the bucket (the row stays)
  perform pg_temp.act_as('demo_user');
  delete from storage.objects where bucket_id = 'hvac-notes';
  reset role;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader deleted from bucket: %', n; end if;
  perform pg_temp.act_as('demo_admin');
  delete from storage.objects where bucket_id = 'hvac-notes';
  reset role;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'editor delete: %', n; end if;

  -- shared names (004): a third author B = demo_none, given the tile for this block. The reader A sees B's highlight,
  -- card note and reply with B's current name, after a rename the new name, after B is deleted the saved name.
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'hvac-notes', false, '{}' from t_ids where k = 'demo_none';
  perform pg_temp.act_as('demo_none');
  perform public.hvac_notes_highlight_save('nne001', 'theory', 'example', 'Example page', 'blue', 'B note', q_ok::jsonb);
  perform public.hvac_notes_card_save('theory/terms/scop', 'SCOP', 'mint', 'B card note');
  perform public.hvac_notes_reply_save('highlight', 'adm001', 'B reply');
  reset role;
  perform pg_temp.act_as('demo_user');
  -- twice in one transaction, same result (003 kept a temp table between calls)
  select public.hvac_notes_shared() into v;
  if v <> public.hvac_notes_shared() then raise exception 'second call differs'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'highlights') x where x ->> 'id' = 'nne001' and x ->> 'by' = 'Demo None' and x ->> 'note' = 'B note')
     or not exists (select 1 from jsonb_array_elements(v -> 'cards') x where x ->> 'key' = 'theory/terms/scop' and x ->> 'by' = 'Demo None')
     or not exists (select 1 from jsonb_array_elements(v -> 'replies') x where x ->> 'ref' = 'adm001' and x ->> 'by' = 'Demo None' and not (x ->> 'mine')::boolean)
     or not exists (select 1 from jsonb_array_elements(v -> 'highlights') x where x ->> 'id' = 'adm001' and x ->> 'by' = 'Demo Admin') then
    raise exception 'names: A does not see B %', v;
  end if;
  reset role;
  update core.profiles set display_name = 'Demo None Renamed' where username = 'demo_none';
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_shared() into v;
  select count(*) into n from (
    select x ->> 'by' b from jsonb_array_elements(v -> 'highlights') x where x ->> 'id' = 'nne001'
    union all select x ->> 'by' from jsonb_array_elements(v -> 'cards') x where x ->> 'key' = 'theory/terms/scop'
    union all select x ->> 'by' from jsonb_array_elements(v -> 'replies') x where x ->> 'ref' = 'adm001' and x ->> 'body' = 'B reply') y
  where y.b = 'Demo None Renamed';
  if n <> 3 then raise exception 'names after rename: % of 3 %', n, v; end if;
  reset role;
  delete from auth.users where id = (select id from t_ids where k = 'demo_none');   -- as core_admin_delete_user (cascades to the profile)
  if exists (select 1 from core.profiles where username = 'demo_none') then raise exception 'delete did not cascade'; end if;
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_shared() into v;
  select count(*) into n from (
    select x ->> 'by' b from jsonb_array_elements(v -> 'highlights') x where x ->> 'id' = 'nne001'
    union all select x ->> 'by' from jsonb_array_elements(v -> 'cards') x where x ->> 'key' = 'theory/terms/scop'
    union all select x ->> 'by' from jsonb_array_elements(v -> 'replies') x where x ->> 'ref' = 'adm001' and x ->> 'body' = 'B reply') y
  where y.b = 'Demo None';
  if n <> 3 then raise exception 'names after delete (saved name): % of 3 %', n, v; end if;
  reset role;

  -- notebook level (005): theory for selected users only. Then the reader holds nb_theory. Then back to everyone.
  perform pg_temp.act_as('demo_admin');
  insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/example.svg');
  perform pg_temp.expect_error($q$select public.hvac_notes_notebook_set('Theory', 'selected')$q$, 'INVALID:tab');
  perform pg_temp.expect_error($q$select public.hvac_notes_notebook_set('a-very-long-notebook-name', 'selected')$q$, 'INVALID:tab');
  perform pg_temp.expect_error($q$select public.hvac_notes_notebook_set('theory', 'some')$q$, 'INVALID:audience');
  select public.hvac_notes_notebook_set('theory', 'selected') into v;
  if v ->> 'right' <> 'nb_theory' then raise exception 'notebook set %', v; end if;
  select public.hvac_notes_library() into v;
  if v -> 'audience' <> '{"theory": "selected"}'::jsonb or not (v -> 'navs') ? 'theory' then raise exception 'admin library closed notebook %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'admin image %', n; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if (v -> 'navs') ? 'theory' or v -> 'closed' <> '["theory"]'::jsonb or (v -> 'navs' ->> 'refrigeration')::jsonb <> '[]'::jsonb then raise exception 'reader library closed notebook %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or jsonb_array_length(v -> 'cards') <> 0 or jsonb_array_length(v -> 'replies') <> 0 then raise exception 'reader shared closed notebook %', v; end if;
  if jsonb_array_length((public.hvac_notes_index()) -> 'pages') <> 0 then raise exception 'reader index closed notebook'; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'reader image in closed notebook %', n; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('highlight', 'adm001', 'x')$q$, 'NOT_FOUND');
  reset role;
  update core.tile_access set rights = array['nb_theory'] where tile_id = 'hvac-notes' and user_id = (select id from t_ids where k = 'demo_user');
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if not (v -> 'navs') ? 'theory' or v -> 'closed' <> '[]'::jsonb then raise exception 'reader with nb_theory %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader with nb_theory image %', n; end if;
  if jsonb_array_length((public.hvac_notes_shared()) -> 'highlights') <> 2 then raise exception 'reader with nb_theory shared'; end if;
  reset role;
  update core.tile_access set rights = '{}' where tile_id = 'hvac-notes' and user_id = (select id from t_ids where k = 'demo_user');
  perform pg_temp.act_as('demo_admin');
  perform public.hvac_notes_notebook_set('theory', 'all');
  -- hide a page again: it goes back to draft
  select public.hvac_notes_page_status(array['theory/example'], 'draft') into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'hide %', v; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 then raise exception 'reader shared on hidden page %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader image, notebook open %', n; end if;
  if jsonb_array_length((public.hvac_notes_growth()) -> 'days') <> 0 then raise exception 'reader growth hidden page'; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action in ('page_hidden', 'notebook_audience'); if n <> 3 then raise exception 'visibility audit %', n; end if;

  -- old layout (before the move): index in a bucket file, readers get no stored index; the next commit moves it
  update hvac_notes.library set index_path = '_library/index-old.json', growth_path = '_library/growth-old.json', growth = null;
  perform pg_temp.act_as('demo_user');
  if public.hvac_notes_index() is not null or public.hvac_notes_growth() is not null then raise exception 'index before move'; end if;
  if public.hvac_notes_file_open('_library/index-old.json') or not public.hvac_notes_file_open('theory/images/example.svg') then raise exception 'reader file_open'; end if;
  reset role;
  perform pg_temp.act_as('demo_pending');
  if public.hvac_notes_file_open('theory/images/example.svg') then raise exception 'pending file_open'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_publish_export() into v;
  if v -> 'index' <> 'null'::jsonb or v -> 'growth' <> 'null'::jsonb or v ->> 'index_path' <> '_library/index-old.json' then raise exception 'export before move %', v; end if;
  select public.hvac_notes_publish_commit((v ->> 'version')::int, '{}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, idx1, growth1) into v;
  select public.hvac_notes_publish_export() into v;
  if v -> 'index_path' <> 'null'::jsonb or jsonb_array_length(v -> 'index' -> 'pages') <> 3 or v -> 'growth' <> growth1 then raise exception 'export after move %', v; end if;
  reset role;

  -- the tables are not reachable directly
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error('select count(*) from hvac_notes.pages', 'PERMISSION');
  perform pg_temp.expect_error('select count(*) from hvac_notes.highlights', 'PERMISSION');
  perform pg_temp.expect_error('select count(*) from hvac_notes.replies', 'PERMISSION');
  reset role;

  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'publish'; if n < 2 then raise exception 'audit %', n; end if;
  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;
  raise notice 'ALL HVAC NOTES TESTS PASSED';
end $$;

rollback;
