# Core requests - hvac-notes

## Open
- 2026-11-07 - **A container with no owner, registered from a tile function.** `core.container_put(..., p_owner)` falls back to the caller when `p_owner` is null, so a notebook first published by an editor becomes his, and the Access panel lets an owner with contribute share it or make it private. For HVAC Notes, who can open a notebook is the managers' decision (owner, TILE-CHANGES 2026-11-06: "Share on each notebook (managers)"). Asked: a way for the tile to register a container with no owner (for example `p_owner => null` plus a flag, or a declaration setting per kind "owned by: nobody / creator"), so only managers share it. Meanwhile: the notebooks that exist were registered by `006_access.sql` from the SQL editor with no owner; only the owner (super user) publishes, so no notebook gets an owner in practice. Nothing to switch off.
- 2026-11-07 - **F14 Waiting for you: ready on this side.** HVAC Notes has a queue (drafts waiting for someone with approve on their notebook). When core 012 fixes the shape of `public.<tile>_waiting()`, this tile adds `public.hvac_notes_waiting()` (count of draft pages the caller may approve, link `#/` of the first) in its next SQL file. No action for the core beyond 012.
- 2026-11-07 - **F20 export per tile: what exists here.** The tile already has *Download all pages* (zip of `src/`: Markdown, `nav.json`, images, `CREDITS.md`, timeline), today for whoever may publish. Highlights, card notes and replies are not in it. When F20 fixes the manager's export, this tile maps to it (likely: the same zip plus the shared notes, for manage). No action now.

## Done
- 2026-11-06 - Health check flags pg_cron's own policies - rule h of `core.security_check()` passes `cron.job: cron_job_policy` and `cron.job_run_details: cron_job_run_details_policy` only in pg_cron's own shape (`db/core/011_access.sql`, applied 2026-11-06).
- 2026-11-04 - `core.display_names(p_tile, p_ids)` for the current name of who wrote a highlight, note or reply - `db/core/006_display_names.sql`, used by `003_names.sql`.
- 2026-11-04 - Embedded YouTube player - allowed for this tile on the conditions in `docs/SECURITY.md` section 4.
