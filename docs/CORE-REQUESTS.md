# Core requests - hvac-notes

## Open
- 2026-11-06 - **Health check flags pg_cron's own policies.** Admin > Health shows 2 problems, "policy for anon/public": `cron.job: cron_job_policy` and `cron.job_run_details: cron_job_run_details_policy`. They come from `pg_cron`, which `db/core/010_health.sql` installs for the nightly check, not from any tile. Rule h of `core.security_check()` doesn't skip the system schemas in `v_system` (rules a, c, e and i do). Asked: skip only these two known pg_cron policies, so that any other anon/public policy, even in a system schema, is still reported. Nothing to change in this tile; no tile is to be switched off for it.

## Done
- 2026-11-04 - `core.display_names(p_tile, p_ids)` for the current name of who wrote a highlight, note or reply - `db/core/006_display_names.sql`, used by `003_names.sql`.
- 2026-11-04 - Embedded YouTube player - allowed for this tile on the conditions in `docs/SECURITY.md` section 4.
