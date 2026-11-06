# HVAC Notes - status

## Built
- 2026-11-04 - Phase 1, code and database: reader (`index.html`, `assets/`), Publish page (`publish.html`), `db/hvac_notes/001_init.sql`, `db/hvac_notes/tests.sql`, `tools/lint.mjs`, `tools/page-template.md`, local tests (`tools/test/`). All local tests pass on invented content; the real pages were also published and read on a local copy (not in this repo).
- 2026-11-04 - Shared highlights and notes with the author's name; `edit` removes anyone's (in `001_init.sql`).
- 2026-11-04 - Replies (questions and answers) under any note, Discussions view: `db/hvac_notes/002_replies.sql`.
- 2026-11-04 - Troubleshooting and In the Field per notebook; one Focus button per card; floating focus window on wide screens; Publish inside the reader; install button and manifest removed.
- 2026-11-04 - Embedded YouTube player (tap to load) on the exception the admin repo granted; author names from `core.display_names` (`003_names.sql`); cover colours as on the old site; versioned asset links.
- 2026-11-04 - **Live.** All 25 pages and 16 images published (version 1). Owner checked every page, image, widget and search on the live tile, and the refusals for a user without the tile.

- 2026-11-05 - New notebook **Refrigeration** in the code (reader, cover, icon, learning path, Publish check). No SQL. Asset links bumped to `?v=20261105a`. Code rules and the page check on the invented library pass; the browser test was not run in this session (no local Postgres).
- 2026-11-05 - Linked chapters (`{ "link": "tab/slug" }` in `nav.json`): a notebook lists another notebook's article without copying or moving it. Reader, sidebar, covers, Publish check; fixture and browser test added (`refrigeration` links `theory/test-basics`). `tools/test/db.sh` now reads the stub from `dame-hub/dev/test/` (moved there in the admin repo). Full local test passes. Asset links `?v=20261105b`.
- 2026-11-05 - Reading quick wins: new page colour **Gold** (mustard text on a warm near-black page; Themes & Settings > Page). Phones: slightly wider line spacing and paragraph gaps, smaller tables and headings, no text inflation on rotate; better line breaks on all screens. Secondary text, lines and cards now follow the chosen page colour (they kept DAME's day/night colours before). CSS and one line in `app.js`; no SQL, nothing stored beyond the existing view setting. Code rules pass; checked by screenshot at phone width; the browser test was not run (no local Postgres). Asset links `?v=20261105c`.
- 2026-11-05 - **Fix: shared highlights after `003_names`.** On live, 003 made everyone see only his own highlights, card notes and replies (the reader swallows a failed `hvac_notes_shared` and shows own data only); the owner restored the 002 body by hand. `db/hvac_notes/004_names_no_temp.sql` replaces the function: same output as 003 (current name from `core.display_names`, saved name as fallback), one read-only statement, names from a materialized CTE, no temp table, lists ordered explicitly. Tests: `act_as` creates the `auth.sessions` row (core 008); new block - a third author's highlight, card note and reply seen with his name, after a rename the new name, after his account is deleted the saved name; two calls in one transaction give the same result; the old 002 body fails the rename check. HTTP: two users, four rounds of `POST /rpc/hvac_notes_shared` each plus a rename, through real PostgREST 12 against a Supabase-like database (`postgres` not a superuser, BYPASSRLS, history replayed as on live: 003, 002 body by hand, then 004) and through `dame-hub/dev/test/mock-supabase.mjs` - all pass. The live failure itself did not reproduce locally (003 also passed both ways), so the exact Supabase cause is unconfirmed; 004 no longer depends on it. Also: `db/migrations.json` (003 superseded), `CLAUDE.md`, `viewport-fit=cover` + `theme-color` head lines on both pages, the tile's test mock creates the `auth.sessions` row at sign-in. Full local test (`tools/test/run.sh`) passes, browser included.
- 2026-11-06 - **Who can read (owner decision).** Notebook level: *All users* or *Selected users* (tile right `nb_<notebook>`); page level: new pages are **drafts** until the tile admin presses **Approve** on the page; **Hide** sends a page back to draft; changes to an approved page go live at once. A page's home decides for every link to it: readers are not sent linked chapters, prereq/related, search entries, terms, symptoms, check questions, timeline items, highlights, card notes or replies of pages they cannot open; a link in the text shows as plain text. The search index and timeline moved from bucket files into the database so every read is filtered; the Publish page has **Move now** for the live library. `db/hvac_notes/005_visibility.sql`; reader (`hn-data.js`, `app.js`, `app-reader.js`, CSS), Publish page (`publish.js`). No content moved; all 25 live pages stay approved. Tests: `tests.sql` (drafts, approval, notebook for selected users with and without the right, images, shared notes, replies, nav/index/timeline cuts, old layout and move, refusals); browser run (approve on the page, link to a draft, linked chapter, closed notebook off the shelf and tab bar, Move now, search before the move) - full `tools/test/run.sh` passes; every changed or new function also called through HTTP `POST /rest/v1/rpc/<name>` on `dame-hub/dev/test/mock-supabase.mjs` as a tile admin and a reader (17 checks: cuts, refusals, hide/approve, notebook set, export, the move commit, file_open); 005 also applied over a 001-004 database with pages (pages stay approved). Checked by screenshot at 1280 px and 390 px, day and night. Asset links `?v=20261106a`.

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/hvac_notes/001_init.sql` | 2026-11-04 (same project) | 2026-11-04 |
| `db/hvac_notes/002_replies.sql` | 2026-11-04 | 2026-11-04 |
| `db/hvac_notes/003_names.sql` (superseded by 004) | - | 2026-11-05, then the owner put the 002 body of `hvac_notes_shared()` back by hand (sharing broke); `core.migrations` still lists 003 |
| `db/hvac_notes/004_names_no_temp.sql` | - | by 2026-11-06 (Admin > Health: all applied) |
| `db/hvac_notes/005_visibility.sql` | - | by 2026-11-06 (Admin > Health: all applied). Health then shows only the two pg_cron policies (core, see `docs/CORE-REQUESTS.md`) |
| `db/hvac_notes/tests.sql` (check only, rolled back) | 2026-11-04 | - |

**After 004, the owner checks:** two accounts that both have the tile, each with a highlight with a note, a card note, and a reply under the other's highlight. Each sees the other's highlight, card note and reply with the other's name (Highlights & Notes > Everyone, Discussions). Admin > Health > Run check now says **Clean**; `select * from core.security_check();` returns no rows; Security Advisor shows nothing new.

## Phase 3 - cut-over (owner, in this order)
Decision 2026-11-04 (owner): `HVAC` is **deleted** after the two offline backups (this overrides `docs/NEW-TILE.md` step 4, which keeps the old repo as a private source repo). Any other repo of the account that does not fit the new process is deleted too.

1. **SQL.** Done for 006 and 003 (2026-11-05). Now `db/hvac_notes/004_names_no_temp.sql`, then the check under the table above. Mark the row with the date.
2. **Name check.** Open the tile, a page with a highlight or note: the author's name shows (it is the core's current name now, the saved name only as fallback). `publish.html` and the reader still open.
3. **Backup 1 - the tile.** Tile > Publish > *Download all pages*. Unzip it: 25 `.md` files, 16 images, every `nav.json`, `CREDITS.md`, `growth.json`; `node tools/lint.mjs <unzipped folder>` reports only the two known Sources warnings. This zip is the authoring copy from now on.
4. **Backup 2 - the old repo.** GitHub `HVAC` > Code > Download ZIP. Keep both zips off the computer that will delete the repo (a second drive or a private cloud folder), never in any repo.
5. **Team access.** Admin page > Users > New user for each colleague (temporary password told by voice; needs `db/core/005_owner_users.sql` applied, admin project's list). Admin > Tiles > HVAC Notes > Access: reading only; `edit` stays with the owner. Tell them the new address `/hvac-notes/` under the DAME site and to remove the old site's installed app and bookmarks.
6. **Pages off on `HVAC`.** Repo > Settings > Pages > Unpublish site. Open the old address in a private window: it is gone. Nothing of the tile changes.
7. **Delete `HVAC`.** First Insights > Forks: none (a fork keeps the public history). Then Settings > Danger zone > Delete this repository. Cannot be undone; do it only after step 3 and 4 are verified and the tile is confirmed complete (done 2026-11-04).
8. **Other repos.** Same test for every other repo of the account: Pages on only for `dame-hub` and the tile repos; any other Pages site shares the DAME address and can read the session (`docs/SECURITY.md` section 5), so Pages off first, delete if no longer needed. The admin repo's `docs/STATUS.md` already names `QuickTools`, `RECKON`, `Thinkneering`, `dame-tools-hub`. Record what was deleted in the admin project.
9. **Close.** Tell the admin project: `HVAC` deleted on <date>, so `docs/TILES.md` and this project's instructions drop the "read `HVAC` until deleted" line. Then this file: cut-over done.

**005 - owner steps (in this order):**
1. Run `005_visibility.sql` (after 004). The new reader and Publish page are already pushed; until 005 runs the reader still works, but do not publish.
2. Open the tile > Publish: press **Move now** (the index and timeline go into the database; the old `_library` files are deleted). Nothing else changes.
3. Admin > Health > Run check now says **Clean**; `select * from core.security_check();` returns no rows; Security Advisor shows nothing new.
4. Only when you want a notebook for selected users: Admin > Tiles > HVAC Notes > rights, add `nb_theory nb_refrigeration nb_chillers nb_ahu nb_fcu nb_systems nb_ashrae` (or just the one needed); then give the right to the users under Access; then on the notebook page set *Who can read* to *Selected users*.
5. Check with a reader account: every page still opens; publish a new page and see it as a draft (reader: nothing; you: Draft bar, Approve).

## Next
1. Owner: run `004_names_no_temp.sql` and `005_visibility.sql` on live, do the two-account check above and the 005 steps.
2. Owner: the rest of the cut-over above.
3. After cut-over: new or changed pages come as a zip in the chat (the owner attaches the export zip first for changes), checked with `node tools/lint.mjs`, uploaded on the Publish page.

## Open points
- An image of a draft page in an open notebook can be fetched by a reader who knows its exact file name (the page text, which names it, is never sent). Accepted 2026-11-06; if it matters later, images move per page.
- If others' notes still do not show after 004: open the tile, DevTools > Network, the `hvac_notes_shared` request, copy its response text into the chat. The reader currently hides that error; that is the next thing to change if it recurs.
- Two dictionary pages (`fcu/terms`, `systems/terms`) have no `## Sources` section; the lint reports it, it does not block publishing.
- `hvac-notes` keeps its own cover colours (admin repo, "Changes tiles must know", 2026-11-04); no change for tile accents.
