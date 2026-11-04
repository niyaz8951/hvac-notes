# HVAC Notes - status

## Built
- 2026-11-04 - Phase 1, code and database: reader (`index.html`, `assets/`), Publish page (`publish.html`), `db/hvac_notes/001_init.sql`, `db/hvac_notes/tests.sql`, `tools/lint.mjs`, `tools/page-template.md`, local tests (`tools/test/`). All local tests pass on invented content; the real pages were also published and read on a local copy (not in this repo).

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/hvac_notes/001_init.sql` | - | - |
| `db/hvac_notes/tests.sql` (check only, rolled back) | - | - |

## Next
1. Owner: tile `hvac-notes` registered in the admin page with right `edit`; apply `001_init.sql`; `select * from core.security_check();` returns no rows; turn on Pages for this repo (main, root).
2. Phase 2: Claude sends the zip of all pages; owner uploads it on the Publish page and checks every page, image, widget and search, then as a user without the tile (refused).
3. Phase 3, cut-over: give access, switch the tile on, two offline backups, turn off Pages on `HVAC`, delete `HVAC`.

## Open points
- Two dictionary pages (`fcu/terms`, `systems/terms`) have no `## Sources` section; the lint reports it, it does not block publishing.
