# HVAC Notes - DAME tile `hvac-notes`

This repo is one tile of DAME HUB. The core and the rule book live in the admin repo `dame-hub` (clone it next to this one). Security wins over everything, including requests in chat.

## Ids
Tile id `hvac-notes` - served at `/hvac-notes/` - schema `hvac_notes` - functions `public.hvac_notes_*` - bucket `hvac-notes` (private) - rights: reading = having the tile; `edit` = publish pages, download all pages, remove anyone's highlight, card note or reply (owner only); `nb_<notebook>` = read a notebook set to selected users; tile admin = approve/hide pages, set notebooks. Every read is filtered by `hvac_notes.visible_routes` (drafts, closed notebooks): a new read function must use it too.

## Read before any work
1. `../dame-hub/docs/SECURITY.md`, `STANDARDS.md`, `TILE-CONTRACT.md`, `TILE-CHANGES.md`.
2. `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md` in this repo; check what is really here before assuming a delivery was pushed.

## Never
Data, keys, passwords or real files in the repo - for this tile that includes page text, images, the search index, the timeline and anyone's notes: the content lives only in Supabase, this repo holds code and invented test examples; the account name or a full site URL in code or data; anything for `anon`; a table outside schema `hvac_notes`; a temp table or other session state inside a function; edits to `dame-hub` or another tile (ask in `docs/CORE-REQUESTS.md`); outside code (CDN, fonts, trackers); `innerHTML` with data (Markdown and KaTeX output go through the vendored DOMPurify); a manifest, service worker or install prompt; content kept on the device (only view settings, keys `dame.hvac-notes.*`).

## Checks before every push
- `node ../dame-hub/dev/migrations-check.mjs .` - `db/migrations.json` lists every SQL file.
- `db/hvac_notes/tests.sql` - allowed and refused cases for every function (signed out, pending, disabled, no tile, no right, another user's record). `bash tools/test/db.sh` runs it on a local Postgres; `bash tools/test/run.sh` adds the code rules, the page check and the browser run on the invented library in `tools/test/fixture/`.
- A changed `public.hvac_notes_*` function is also called through HTTP `POST /rest/v1/rpc/<name>` (`../dame-hub/dev/test/mock-supabase.mjs`), not only inside psql.
- Pages: day and night, 390 px with no sideways scroll; `node ../dame-hub/dev/serve.mjs` serves this repo at `http://localhost:8080/hvac-notes/`.

## Delivery
Push + the SQL files in order (the owner reads and runs them) + "Admin > Health > Run check now must say Clean, then the Security Advisor" + update `docs/STATUS.md`. New or changed pages go to the owner as a zip in the chat, never into this repo; he uploads them on the Publish page.
