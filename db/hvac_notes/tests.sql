-- HVAC Notes tile tests. Run on STAGING after db/core/seed-staging.sql and every db/hvac_notes/0*.sql file. Everything is rolled back.
-- Needs: the tile 'hvac-notes' registered (admin page; it may stay off), core 011, and the demo accounts.
-- Inside the transaction (then rolled back) it gives the tile to demo_admin (edit, later approve, later manage),
-- demo_user (contribute), demo_viewer (read), and disables demo_none for one check. For every function: an allowed call,
-- and refused calls for signed out, pending, disabled, no tile, a level too low, a notebook not shared with him, and
-- another user's record.
begin;

do $$
begin
  if not exists (select 1 from core.tiles where id = 'hvac-notes' and access -> 'kinds' ? 'notebook' and rights = '{}') then
    raise exception 'Register the tile hvac-notes in the admin page, then run db/hvac_notes/006_access.sql (declaration with the notebook kind).';
  end if;
  if (select count(*) from core.profiles where username in ('demo_admin', 'demo_user', 'demo_viewer', 'demo_none', 'demo_pending')) <> 5 then
    raise exception 'Run db/core/seed-staging.sql first (demo accounts).';
  end if;
end $$;
-- The tile is switched on for the test only (rolled back with everything else).
update core.tiles set enabled = true where id = 'hvac-notes';

create temp table t_ids as select username k, id from core.profiles where username in ('demo_admin', 'demo_user', 'demo_viewer', 'demo_none', 'demo_pending');
grant select on t_ids to public;
delete from core.tile_access where tile_id = 'hvac-notes';
insert into core.tile_access (user_id, tile_id, level)
  select id, 'hvac-notes', case k when 'demo_admin' then 'edit' when 'demo_user' then 'contribute' else 'read' end
  from t_ids where k in ('demo_admin', 'demo_user', 'demo_viewer');

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
create or replace function pg_temp.set_level(p_key text, p_level text) returns void language sql as $$
  update core.tile_access set level = p_level where tile_id = 'hvac-notes' and user_id = (select id from t_ids where k = p_key) $$;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text), pg_temp.set_level(text, text) to public;

do $$
declare v jsonb; n int; v_grp uuid;
  q_ok constant text := $j${"exact": "the condenser rejects heat", "prefix": "In summer ", "suffix": " to the air"}$j$;
  -- every function with arguments that would be valid for a publisher
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
    'select public.hvac_notes_page_status(array[''theory/example''], ''approved'')'];
  publish constant text[] := array[calls[11], calls[12]];
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
  commit_sql constant text := 'select public.hvac_notes_publish_commit(%s, %L::jsonb, %L::jsonb, %L, %L::jsonb, %L, null, %L::jsonb, %L::jsonb)';
  c text;
begin
  -- signed out: anon may execute nothing
  perform pg_temp.act_as(null);
  foreach c in array calls loop perform pg_temp.expect_error(c, 'PERMISSION'); end loop;
  perform pg_temp.expect_error($q$select public.hvac_notes_file_write('theory/images/x.svg')$q$, 'PERMISSION');
  perform pg_temp.expect_error($q$select public.hvac_notes_file_remove('theory/images/x.svg')$q$, 'PERMISSION');
  reset role;

  -- pending account
  perform pg_temp.act_as('demo_pending');
  foreach c in array calls loop perform pg_temp.expect_error(c, 'NOT_APPROVED'); end loop;
  reset role;

  -- no tile
  perform pg_temp.act_as('demo_none');
  foreach c in array calls loop perform pg_temp.expect_error(c, 'NO_ACCESS'); end loop;
  if public.hvac_notes_file_write('theory/images/x.svg') or public.hvac_notes_file_remove('_library/index-x.json') then raise exception 'no tile may write files'; end if;
  reset role;

  -- disabled account (rolled back): the core ends his session
  update core.profiles set status = 'disabled' where username = 'demo_none';
  perform pg_temp.act_as('demo_none');
  perform pg_temp.expect_error(calls[1], 'SIGNED_OUT');
  perform pg_temp.expect_error(calls[4], 'SIGNED_OUT');
  reset role;
  update core.profiles set status = 'active' where username = 'demo_none';

  -- contribute and read: publishing and writing to the bucket are refused
  foreach c in array array['demo_user', 'demo_viewer'] loop
    perform pg_temp.act_as(c);
    perform pg_temp.expect_error(publish[1], 'NO_RIGHT');
    perform pg_temp.expect_error(publish[2], 'NO_RIGHT');
    perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/x.svg')$q$, 'RLS');
    reset role;
  end loop;

  -- edit publishes: invalid input is refused, then a valid publish
  perform pg_temp.act_as('demo_admin');
  perform pg_temp.expect_error(format(commit_sql, 5, '{}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:version');
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[]', '{}', '[]', '{}', '{"pages": {}}', g0), 'INVALID:index');
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[]', '{}', '[]', '{}', i0, '{"days": 1}'), 'INVALID:growth');
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[]', '{}', '[]', '{}', '{"v": 1, "pages": [{"tab": "../x", "slug": "y"}]}', g0), 'INVALID:index');
  perform pg_temp.expect_error(format(commit_sql, 0, '{"theory": "not json"}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:navs');
  perform pg_temp.expect_error(format(commit_sql, 0, '{"theory": "{}"}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:navs');
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[{"tab": "Theory", "slug": "x", "md": "# X"}]', '{}', '[]', '{}', i0, g0), 'INVALID:pages');
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[]', '{}', '[{"path": "../x.svg", "size": 1, "sha": "00"}]', '{}', i0, g0), 'INVALID:files');
  -- bucket: only images (the index and timeline are no longer files)
  -- (returning reads the row back, as the Storage API does: the notebook is not published yet)
  insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/example.svg') returning name into c;
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
  -- each notebook is now a container, open to everyone in the tile, owned by its first publisher
  reset role;
  select count(*) into n from core.containers where tile_id = 'hvac-notes' and kind = 'notebook' and everyone = 'edit'
    and owner_id = (select id from t_ids where k = 'demo_admin') and id in ('theory', 'refrigeration', 'chillers');
  if n <> 3 then raise exception 'containers after first publish %', n; end if;
  perform pg_temp.act_as('demo_admin');
  -- a second publish from the same base is stale
  perform pg_temp.expect_error(format(commit_sql, 0, '{}', '[]', '{}', '[]', '{}', i0, g0), 'INVALID:version');
  -- the whole-library parts are the manager's: a notebook removed, a page removed that its nav.json still lists (or
  -- whose nav.json is not in the upload), an image removed
  perform pg_temp.expect_error(format(commit_sql, 1, '{"chillers": null}', '[]', '{chillers/gone}', '[]', '{}', idx1, growth1), 'NO_RIGHT');
  perform pg_temp.expect_error(format(commit_sql, 1, '{}', '[]', '{chillers/gone}', '[]', '{}', idx1, growth1), 'NO_RIGHT');
  perform pg_temp.expect_error(format(commit_sql, 1, '{"chillers": "[{\"slug\": \"gone\", \"title\": \"Gone\"}]"}', '[]', '{chillers/gone}', '[]', '{}', idx1, growth1), 'NO_RIGHT');
  perform pg_temp.expect_error(format(commit_sql, 1, '{}', '[]', '{}', '[]', '{theory/images/example.svg}', idx1, growth1), 'NO_RIGHT');
  -- a page its new nav.json no longer lists goes (merged upload)
  select public.hvac_notes_publish_commit(1, '{"chillers": "[]"}'::jsonb, '[]'::jsonb, array['chillers/gone'], '[]'::jsonb, '{}', null, idx1, growth1) into v;
  select public.hvac_notes_publish_export() into v;
  if (v ->> 'version')::int <> 2 or jsonb_array_length(v -> 'pages') <> 3 or v -> 'navs' ->> 'chillers' <> '[]' or v ->> 'credits' <> E'# Credits\n'
     or jsonb_array_length(v -> 'files') <> 1 or jsonb_array_length(v -> 'index' -> 'pages') <> 3 or v -> 'index' -> 'pages' -> 0 ->> 'slug' <> 'example'
     or v -> 'growth' <> growth1 or v -> 'status' <> '{"theory/draft": "draft", "theory/terms": "draft", "theory/example": "draft"}'::jsonb
     or (v ->> 'manager')::boolean or v ? 'audience' then raise exception 'export %', v; end if;
  -- edit sees drafts, but approving is approve
  select public.hvac_notes_library() into v;
  if not (v ->> 'editor')::boolean or (v ->> 'approver')::boolean or (v ->> 'manager')::boolean or jsonb_array_length(v -> 'drafts') <> 3
     or v -> 'levels' ->> 'theory' <> 'edit' or v -> 'sharing' <> '{}'::jsonb then raise exception 'editor library %', v; end if;
  select public.hvac_notes_page('theory', 'draft') into v; if v ->> 'status' <> 'draft' then raise exception 'editor draft page %', v; end if;
  perform pg_temp.expect_error(calls[19], 'NO_RIGHT');
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status(array['theory/nothing'], 'approved')$q$, 'NOT_FOUND');
  if not public.hvac_notes_file_remove('_library/index-old.json') or public.hvac_notes_file_remove('theory/images/example.svg') then
    raise exception 'editor file_remove'; end if;
  reset role;

  -- new pages are drafts: contribute and read get none of them
  foreach c in array array['demo_user', 'demo_viewer'] loop
    perform pg_temp.act_as(c);
    select public.hvac_notes_library() into v;
    if (v ->> 'editor')::boolean or v -> 'navs' ->> 'theory' <> '[]' or v -> 'navs' ->> 'refrigeration' <> '[]' or v -> 'drafts' <> '[]'::jsonb
       or v -> 'closed' <> '[]'::jsonb then raise exception '% library with drafts %', c, v; end if;
    perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
    perform pg_temp.expect_error(calls[19], 'NOT_FOUND');
    select count(*) into n from public.hvac_notes_pages(null); if n <> 0 then raise exception 'reader pages with drafts %', n; end if;
    if jsonb_array_length((public.hvac_notes_index()) -> 'pages') <> 0 or jsonb_array_length((public.hvac_notes_growth()) -> 'days') <> 0 then raise exception 'reader index/growth with drafts'; end if;
    perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc999', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'NOT_FOUND');
    perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/terms/cop', 'COP', 'mint', 'n')$q$, 'NOT_FOUND');
    reset role;
  end loop;

  -- approve approves example and terms (draft stays a draft)
  perform pg_temp.set_level('demo_admin', 'approve');
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_library() into v;
  if not (v ->> 'approver')::boolean or (v ->> 'manager')::boolean or not (v ->> 'editor')::boolean then raise exception 'approve library %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status(array['theory/example', 'theory/nothing'], 'approved')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status(array['theory/example'], 'live')$q$, 'INVALID:status');
  perform pg_temp.expect_error($q$select public.hvac_notes_page_status('{}', 'approved')$q$, 'INVALID:routes');
  select public.hvac_notes_page_status(array['theory/example', 'theory/terms'], 'approved') into v;
  if (v ->> 'changed')::int <> 2 then raise exception 'approve %', v; end if;
  select public.hvac_notes_page_status(array['theory/example'], 'approved') into v;
  if (v ->> 'changed')::int <> 0 then raise exception 'approve again %', v; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'page_approved'; if n <> 1 then raise exception 'approve audit %', n; end if;

  -- contribute now reads them; the draft and every trace of it stay out; approving needs approve
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if v -> 'navs' ->> 'theory' is null
     or (v -> 'navs' ->> 'theory')::jsonb <> '[{"slug": "example", "title": "Example page", "related": ["theory/terms"], "aliases": ["old-example"]}, {"slug": "terms", "title": "Terms", "layout": "cards"}]'::jsonb
     or (v -> 'navs' ->> 'refrigeration')::jsonb <> '[{"link": "theory/example", "group": "Linked"}]'::jsonb
     or v -> 'levels' <> '{"theory": "contribute", "chillers": "contribute", "refrigeration": "contribute"}'::jsonb then raise exception 'reader navs %', v; end if;
  select public.hvac_notes_index() into v;
  if jsonb_array_length(v -> 'pages') <> 2 or v -> 'pages' -> 0 ->> 'slug' <> 'example' or v -> 'pages' -> 0 -> 'links' <> '["theory/terms"]'::jsonb then raise exception 'reader index %', v; end if;
  select public.hvac_notes_growth() into v;
  if v <> '{"v": 1, "days": [{"date": "2026-11-01", "items": [{"route": "theory/example", "kind": "new"}]}, {"date": "2026-11-03", "items": [{"route": "theory/old-example", "kind": "grew"}]}]}'::jsonb then
    raise exception 'reader growth %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'draft')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error(calls[19], 'NO_RIGHT');
  select count(*) into n from public.hvac_notes_pages(array['theory/example', 'theory/draft']); if n <> 1 then raise exception 'reader pages %', n; end if;
  select public.hvac_notes_library() into v;
  if (v ? 'index_path') or (v ->> 'version')::int <> 2 then raise exception 'library %', v; end if;
  select public.hvac_notes_page('theory', 'example') into v;
  if v ->> 'md' not like '# Example page%' then raise exception 'page %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'nothing')$q$, 'NOT_FOUND');
  select count(*) into n from public.hvac_notes_pages(array['theory/example', 'theory/nothing']); if n <> 1 then raise exception 'pages %', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader sees bucket: %', n; end if;
  perform pg_temp.expect_error($q$select count(*) from public.hvac_notes_pages((select array_agg('theory/x' || g) from generate_series(1, 301) g))$q$, 'INVALID:routes');

  -- contribute: his own data
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
                                    jsonb_build_object('id', 'bad id', 'tab', 'theory', 'slug', 'example', 'color', 'blue', 'quote', jsonb_build_object('exact', 'x')),
                                    jsonb_build_object('id', 'drf1', 'tab', 'theory', 'slug', 'draft', 'color', 'blue', 'quote', jsonb_build_object('exact', 'x'))),
    'cards', jsonb_build_object('theory/terms/kw', jsonb_build_object('note', 'n'), 'bad', jsonb_build_object('note', 'n'),
                                'theory/draft/x', jsonb_build_object('note', 'on a draft')),
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

  -- read: reads the page, keeps his private things (position, card colour), but writes nothing others see
  perform pg_temp.act_as('demo_viewer');
  select public.hvac_notes_library() into v;
  if v -> 'levels' ->> 'theory' <> 'read' or (v -> 'navs' ->> 'theory')::jsonb -> 0 ->> 'slug' <> 'example' then raise exception 'viewer library %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('vw0001', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'NO_RIGHT');
  perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/terms/cop', 'COP', 'mint', 'a note')$q$, 'NO_RIGHT');
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('highlight', 'abc123', 'x')$q$, 'NO_RIGHT');
  perform pg_temp.expect_error($q$select public.hvac_notes_card_save('theory/draft/x', 'X', 'mint', '')$q$, 'NOT_FOUND');
  perform public.hvac_notes_card_save('theory/terms/cop', 'COP', 'mint', '');
  perform public.hvac_notes_position_save('theory/example', 0.3, 'Example page');
  select public.hvac_notes_my_import(jsonb_build_object(
    'highlights', jsonb_build_array(jsonb_build_object('id', 'vw0002', 'tab', 'theory', 'slug', 'example', 'color', 'blue', 'quote', jsonb_build_object('exact', 'x'))),
    'cards', jsonb_build_object('theory/terms/kw', jsonb_build_object('note', 'n'), 'theory/terms/eer', jsonb_build_object('color', 'sand')))) into v;
  if v <> '{"highlights": 0, "cards": 1, "positions": 0}'::jsonb then raise exception 'viewer import %', v; end if;
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 2 or jsonb_array_length(v -> 'cards') <> 1 then raise exception 'viewer shared %', v; end if;
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

  -- contribute sees the approver's notes but cannot remove them; deletes his own
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 1 or v -> 'highlights' -> 0 ->> 'by' <> 'Demo Admin' or v -> 'highlights' -> 0 ->> 'note' <> 'admin note'
     or jsonb_array_length(v -> 'cards') <> 1 or v -> 'cards' -> 0 ->> 'note' <> 'admin card note' then raise exception 'shared for reader %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_delete('adm001')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.hvac_notes_card_remove(%s)', v -> 'cards' -> 0 ->> 'id'), 'NO_RIGHT');
  perform pg_temp.expect_error('select public.hvac_notes_card_remove(999999)', 'NOT_FOUND');
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
  -- he answers the approver's card note; the approver will remove that reply
  perform public.hvac_notes_reply_save('highlight', 'adm001', 'A question on your note');
  reset role;

  -- approve removes the reader's remaining highlight, card note and reply (audited)
  perform pg_temp.act_as('demo_admin');
  select public.hvac_notes_shared() into v;
  perform public.hvac_notes_highlight_delete('old1');
  perform public.hvac_notes_card_remove((v -> 'cards' -> 0 ->> 'id')::bigint);
  perform pg_temp.expect_error(format('select public.hvac_notes_card_remove(%s)', v -> 'cards' -> 0 ->> 'id'), 'NOT_FOUND');
  perform public.hvac_notes_reply_delete((select (x ->> 'id')::bigint from jsonb_array_elements(v -> 'replies') x where x ->> 'ref' = 'adm001'));
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or jsonb_array_length(v -> 'cards') <> 0 or jsonb_array_length(v -> 'replies') <> 0 then raise exception 'after removal %', v; end if;
  select count(*) into n from jsonb_array_elements((public.hvac_notes_my_data()) -> 'highlights'); if n <> 1 then raise exception 'admin highlight kept %', n; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'note_removed'; if n <> 2 then raise exception 'removal audit %', n; end if;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'reply_removed'; if n <> 1 then raise exception 'reply removal audit %', n; end if;

  -- no tile: the bucket shows nothing and refuses writes
  perform pg_temp.act_as('demo_none');
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'no-tile user sees bucket: %', n; end if;
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/y.svg')$q$, 'RLS');
  reset role;

  -- neither contribute nor approve deletes an image (only "whole library", the manager's); the manager does
  foreach c in array array['demo_user', 'demo_admin'] loop
    perform pg_temp.act_as(c);
    delete from storage.objects where bucket_id = 'hvac-notes';
    reset role;
    select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception '% deleted from bucket: %', c, n; end if;
  end loop;
  perform pg_temp.set_level('demo_admin', 'manage');
  perform pg_temp.act_as('demo_admin');
  delete from storage.objects where bucket_id = 'hvac-notes';
  reset role;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'manager delete: %', n; end if;

  -- shared names (004): a third author B = demo_none, given the tile for this block. The reader A sees B's highlight,
  -- card note and reply with B's current name, after a rename the new name, after B is deleted the saved name.
  insert into core.tile_access (user_id, tile_id, level) select id, 'hvac-notes', 'contribute' from t_ids where k = 'demo_none';
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

  -- notebooks shared from the core's Access panel (managers). Theory: only the people and groups listed.
  perform pg_temp.act_as('demo_admin');
  insert into storage.objects (bucket_id, name) values ('hvac-notes', 'theory/images/example.svg');
  select public.hvac_notes_library() into v;
  if not (v ->> 'manager')::boolean or v -> 'sharing' -> 'theory' ->> 'everyone' <> 'edit' or v -> 'levels' ->> 'theory' <> 'manage' then raise exception 'manager library %', v; end if;
  select public.core_share_set('hvac-notes', 'notebook', 'theory', null, '[]'::jsonb) into v;
  if v -> 'everyone' <> 'null'::jsonb then raise exception 'share private %', v; end if;
  select public.hvac_notes_library() into v;
  if v -> 'sharing' -> 'theory' -> 'everyone' <> 'null'::jsonb or not (v -> 'navs') ? 'theory' then raise exception 'manager library private notebook %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'manager image %', n; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  perform pg_temp.expect_error($q$select public.core_share_set('hvac-notes', 'notebook', 'theory', 'edit', '[]'::jsonb)$q$, 'NOT_FOUND');
  select public.hvac_notes_library() into v;
  if (v -> 'navs') ? 'theory' or v -> 'closed' <> '["theory"]'::jsonb or (v -> 'navs' ->> 'refrigeration')::jsonb <> '[]'::jsonb
     or (v -> 'levels') ? 'theory' then raise exception 'reader library private notebook %', v; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 or jsonb_array_length(v -> 'cards') <> 0 or jsonb_array_length(v -> 'replies') <> 0 then raise exception 'reader shared private notebook %', v; end if;
  if jsonb_array_length((public.hvac_notes_index()) -> 'pages') <> 0 then raise exception 'reader index private notebook'; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 0 then raise exception 'reader image in private notebook %', n; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_reply_save('highlight', 'adm001', 'x')$q$, 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc777', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'NOT_FOUND');
  reset role;
  -- demo_user listed with Can view: reads, writes nothing shared there
  perform pg_temp.act_as('demo_admin');
  perform public.core_share_set('hvac-notes', 'notebook', 'theory', null,
    jsonb_build_array(jsonb_build_object('type', 'user', 'id', (select id from t_ids where k = 'demo_user'), 'level', 'read')));
  reset role;
  perform pg_temp.act_as('demo_user');
  select public.hvac_notes_library() into v;
  if not (v -> 'navs') ? 'theory' or v -> 'closed' <> '[]'::jsonb or v -> 'levels' ->> 'theory' <> 'read' then raise exception 'reader with Can view %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader with Can view image %', n; end if;
  if jsonb_array_length((public.hvac_notes_shared()) -> 'highlights') <> 2 then raise exception 'reader with Can view shared'; end if;
  perform pg_temp.expect_error($q$select public.hvac_notes_highlight_save('abc777', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb)$q$, 'NO_RIGHT');
  reset role;
  -- ... with Can edit: his tile level (contribute) there
  perform pg_temp.act_as('demo_admin');
  perform public.core_share_set('hvac-notes', 'notebook', 'theory', null,
    jsonb_build_array(jsonb_build_object('type', 'user', 'id', (select id from t_ids where k = 'demo_user'), 'level', 'edit')));
  reset role;
  perform pg_temp.act_as('demo_user');
  if (public.hvac_notes_library()) -> 'levels' ->> 'theory' <> 'contribute' then raise exception 'reader with Can edit'; end if;
  perform public.hvac_notes_highlight_save('abc777', 'theory', 'example', '', 'yellow', '', '{"exact": "x"}'::jsonb);
  reset role;
  -- a group listed with Can view opens it to its members (demo_viewer)
  insert into core.groups (name) values ('Test readers') returning id into v_grp;
  insert into core.group_members (group_id, user_id) select v_grp, id from t_ids where k = 'demo_viewer';
  perform pg_temp.act_as('demo_viewer');
  if (public.hvac_notes_library()) -> 'levels' ? 'theory' then raise exception 'viewer before the group share'; end if;
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.core_share_set('hvac-notes', 'notebook', 'theory', null, jsonb_build_array(
    jsonb_build_object('type', 'user', 'id', (select id from t_ids where k = 'demo_user'), 'level', 'edit'),
    jsonb_build_object('type', 'group', 'id', v_grp, 'level', 'read')));
  reset role;
  perform pg_temp.act_as('demo_viewer');
  if (public.hvac_notes_library()) -> 'levels' ->> 'theory' <> 'read' then raise exception 'viewer through the group'; end if;
  reset role;
  -- an editor with no Can edit on a notebook may not publish (one publish carries the whole library's index and
  -- timeline), nor upload images; with Can edit he may
  perform pg_temp.set_level('demo_viewer', 'edit');
  perform pg_temp.act_as('demo_viewer');
  select public.hvac_notes_library() into v;
  if (v ->> 'editor')::boolean or v -> 'levels' ->> 'theory' <> 'read' or v -> 'levels' ->> 'refrigeration' <> 'edit' then raise exception 'partial editor library %', v; end if;
  perform pg_temp.expect_error(publish[1], 'NO_RIGHT');
  perform pg_temp.expect_error(format(commit_sql, 2, '{}', '[]', '{}', '[]', '{}', idx1, growth1), 'NO_RIGHT');
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('hvac-notes', 'refrigeration/images/x.svg')$q$, 'RLS');
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'draft')$q$, 'NOT_FOUND');
  reset role;
  perform pg_temp.act_as('demo_admin');
  perform public.core_share_set('hvac-notes', 'notebook', 'theory', null, jsonb_build_array(
    jsonb_build_object('type', 'group', 'id', v_grp, 'level', 'edit')));
  reset role;
  perform pg_temp.act_as('demo_viewer');
  select public.hvac_notes_library() into v;
  if not (v ->> 'editor')::boolean or v -> 'levels' ->> 'theory' <> 'edit' then raise exception 'editor through the group %', v; end if;
  select public.hvac_notes_page('theory', 'draft') into v; if v ->> 'status' <> 'draft' then raise exception 'group editor draft %', v; end if;
  perform public.hvac_notes_publish_export();
  reset role;
  perform pg_temp.set_level('demo_viewer', 'read');
  -- back to everyone in the tile; the manager removes the empty chillers notebook (whole library) and hides a page
  perform pg_temp.act_as('demo_admin');
  perform public.core_share_set('hvac-notes', 'notebook', 'theory', 'edit', '[]'::jsonb);
  select public.hvac_notes_publish_commit(2, '{"chillers": null}'::jsonb, '[]'::jsonb, '{}', '[]'::jsonb, '{}', null, idx1, growth1) into v;
  if (v ->> 'version')::int <> 3 then raise exception 'manager removes a notebook %', v; end if;
  select public.hvac_notes_page_status(array['theory/example'], 'draft') into v;
  if (v ->> 'changed')::int <> 1 then raise exception 'hide %', v; end if;
  reset role;
  perform pg_temp.act_as('demo_user');
  perform pg_temp.expect_error($q$select public.hvac_notes_page('theory', 'example')$q$, 'NOT_FOUND');
  select public.hvac_notes_shared() into v;
  if jsonb_array_length(v -> 'highlights') <> 0 then raise exception 'reader shared on hidden page %', v; end if;
  select count(*) into n from storage.objects where bucket_id = 'hvac-notes'; if n <> 1 then raise exception 'reader image, notebook open %', n; end if;
  if jsonb_array_length((public.hvac_notes_growth()) -> 'days') <> 0 then raise exception 'reader growth hidden page'; end if;
  if (public.hvac_notes_library()) -> 'navs' ? 'chillers' then raise exception 'chillers still listed'; end if;
  reset role;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'page_hidden'; if n <> 1 then raise exception 'hide audit %', n; end if;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'share_set'; if n <> 6 then raise exception 'share audit %', n; end if;

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
  if not public.hvac_notes_file_open('_library/index-old.json') then raise exception 'manager file_open old index'; end if;
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
  perform pg_temp.expect_error($q$select hvac_notes.can_publish(auth.uid())$q$, 'PERMISSION');
  reset role;

  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.proname = 'hvac_notes_notebook_set') then raise exception 'notebook_set still there'; end if;
  if to_regclass('hvac_notes.notebooks') is not null then raise exception 'hvac_notes.notebooks still there'; end if;
  select count(*) into n from core.audit where tile_id = 'hvac-notes' and action = 'publish'; if n < 3 then raise exception 'audit %', n; end if;
  select count(*) into n from core.security_check(); if n <> 0 then raise exception 'security_check reports % problem(s)', n; end if;
  raise notice 'ALL HVAC NOTES TESTS PASSED';
end $$;

rollback;
