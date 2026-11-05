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

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/hvac_notes/001_init.sql` | 2026-11-04 (same project) | 2026-11-04 |
| `db/hvac_notes/002_replies.sql` | 2026-11-04 | 2026-11-04 |
| `db/hvac_notes/003_names.sql` (needs `db/core/006_display_names.sql` first) | - | - |
| `db/hvac_notes/tests.sql` (check only, rolled back) | 2026-11-04 | - |

## Phase 3 - cut-over (owner, in this order)
Decision 2026-11-04 (owner): `HVAC` is **deleted** after the two offline backups (this overrides `docs/NEW-TILE.md` step 4, which keeps the old repo as a private source repo). Any other repo of the account that does not fit the new process is deleted too.

1. **SQL.** Supabase > SQL editor, live project: `db/core/006_display_names.sql` (admin repo), then `db/hvac_notes/003_names.sql`. Then `select * from core.security_check();` returns no rows, and Security Advisor shows nothing new. Mark the row above with the date.
2. **Name check.** Open the tile, a page with a highlight or note: the author's name shows (it is the core's current name now, the saved name only as fallback). `publish.html` and the reader still open.
3. **Backup 1 - the tile.** Tile > Publish > *Download all pages*. Unzip it: 25 `.md` files, 16 images, every `nav.json`, `CREDITS.md`, `growth.json`; `node tools/lint.mjs <unzipped folder>` reports only the two known Sources warnings. This zip is the authoring copy from now on.
4. **Backup 2 - the old repo.** GitHub `HVAC` > Code > Download ZIP. Keep both zips off the computer that will delete the repo (a second drive or a private cloud folder), never in any repo.
5. **Team access.** Admin page > Users > New user for each colleague (temporary password told by voice; needs `db/core/005_owner_users.sql` applied, admin project's list). Admin > Tiles > HVAC Notes > Access: reading only; `edit` stays with the owner. Tell them the new address `/hvac-notes/` under the DAME site and to remove the old site's installed app and bookmarks.
6. **Pages off on `HVAC`.** Repo > Settings > Pages > Unpublish site. Open the old address in a private window: it is gone. Nothing of the tile changes.
7. **Delete `HVAC`.** First Insights > Forks: none (a fork keeps the public history). Then Settings > Danger zone > Delete this repository. Cannot be undone; do it only after step 3 and 4 are verified and the tile is confirmed complete (done 2026-11-04).
8. **Other repos.** Same test for every other repo of the account: Pages on only for `dame-hub` and the tile repos; any other Pages site shares the DAME address and can read the session (`docs/SECURITY.md` section 5), so Pages off first, delete if no longer needed. The admin repo's `docs/STATUS.md` already names `QuickTools`, `RECKON`, `Thinkneering`, `dame-tools-hub`. Record what was deleted in the admin project.
9. **Close.** Tell the admin project: `HVAC` deleted on <date>, so `docs/TILES.md` and this project's instructions drop the "read `HVAC` until deleted" line. Then this file: cut-over done.

## Next
1. Owner: the cut-over above.
2. After cut-over: new or changed pages come as a zip in the chat (the owner attaches the export zip first for changes), checked with `node tools/lint.mjs`, uploaded on the Publish page.

## Open points
- Two dictionary pages (`fcu/terms`, `systems/terms`) have no `## Sources` section; the lint reports it, it does not block publishing.
- `hvac-notes` keeps its own cover colours (admin repo, "Changes tiles must know", 2026-11-04); no change for tile accents.
