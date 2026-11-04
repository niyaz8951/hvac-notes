# HVAC Notes - status

## Built
- 2026-11-04 - Phase 1, code and database: reader (`index.html`, `assets/`), Publish page (`publish.html`), `db/hvac_notes/001_init.sql`, `db/hvac_notes/tests.sql`, `tools/lint.mjs`, `tools/page-template.md`, local tests (`tools/test/`). All local tests pass on invented content; the real pages were also published and read on a local copy (not in this repo).
- 2026-11-04 - Shared highlights and notes with the author's name; `edit` removes anyone's (in `001_init.sql`).
- 2026-11-04 - Replies (questions and answers) under any note, Discussions view: `db/hvac_notes/002_replies.sql`.
- 2026-11-04 - Troubleshooting and In the Field per notebook; one Focus button per card; floating focus window on wide screens; Publish inside the reader; install button and manifest removed.
- 2026-11-04 - Embedded YouTube player (tap to load) on the exception the admin repo granted; author names from `core.display_names` (`003_names.sql`); cover colours as on the old site; versioned asset links.

## SQL applied
| File | Staging | Live |
|---|---|---|
| `db/hvac_notes/001_init.sql` | 2026-11-04 (same project) | 2026-11-04 |
| `db/hvac_notes/002_replies.sql` | 2026-11-04 | 2026-11-04 |
| `db/hvac_notes/003_names.sql` (needs `db/core/006_display_names.sql` first) | - | - |
| `db/hvac_notes/tests.sql` (check only, rolled back) | 2026-11-04 | - |

## Next
1. Owner: apply `db/core/006_display_names.sql` (admin repo) then `003_names.sql`; `select * from core.security_check();` returns no rows.
2. Owner checks every page, image, widget and search on the live tile (pages published 2026-11-04, version 1), then as a user without the tile (refused).
3. Phase 3, cut-over: give access, two offline backups, turn off Pages on `HVAC`, then delete it or keep it private (owner's choice pending).
4. Done: embedded YouTube playback (exception granted 2026-11-04).

## Open points
- Two dictionary pages (`fcu/terms`, `systems/terms`) have no `## Sources` section; the lint reports it, it does not block publishing.
