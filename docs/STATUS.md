# HVAC Notes - status

## Built
- 2026-11-04 - Phase 1, code and database: reader (`index.html`, `assets/`), Publish page (`publish.html`), `db/hvac_notes/001_init.sql`, `db/hvac_notes/tests.sql`, `tools/lint.mjs`, `tools/page-template.md`, local tests (`tools/test/`). All local tests pass on invented content; the real pages were also published and read on a local copy (not in this repo).
- 2026-11-04 - Shared highlights and notes with the author's name; `edit` removes anyone's (in `001_init.sql`).
- 2026-11-04 - Replies (questions and answers) under any note, Discussions view: `db/hvac_notes/002_replies.sql`.

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/hvac_notes/001_init.sql` | 2026-11-04 (same project) | 2026-11-04 |
| `db/hvac_notes/002_replies.sql` | - | - |
| `db/hvac_notes/tests.sql` (check only, rolled back) | 2026-11-04 | - |

## Next
1. Owner: apply `002_replies.sql`; `select * from core.security_check();` returns no rows.
2. Owner checks every page, image, widget and search on the live tile (pages published 2026-11-04, version 1), then as a user without the tile (refused).
3. Phase 3, cut-over: give access, two offline backups, turn off Pages on `HVAC`, then delete it or keep it private (owner's choice pending).
4. Open: embedded YouTube playback would need the admin project to allow YouTube frames for this tile (contract forbids iframes today).

## Open points
- Two dictionary pages (`fcu/terms`, `systems/terms`) have no `## Sources` section; the lint reports it, it does not block publishing.
