# HVAC Notes tile

Tile id `hvac-notes` - path `/hvac-notes/` - schema `hvac_notes` - functions `public.hvac_notes_*` - private bucket `hvac-notes`.

## What it does
A reading app for HVAC product and engineering notes: six notebooks (Theory, Refrigeration, Chillers, AHU, FCU, Systems) and a Books shelf (ASHRAE Handbook - Fundamentals), with search, terms, standards, troubleshooting, self-check questions, review, shared highlights and notes (with the author's name), and a growth timeline. `publish.html` uploads new or changed pages and downloads all pages as a zip.

This repo is public and holds code only. The pages, images, search index and timeline live only in Supabase.

## Rights
- Reading = having the tile.
- `edit` - the Publish page: publish pages, download all pages; remove anyone's highlight, card note or reply (owner only).

## Data
- `hvac_notes.library` - one row: `version`, `index_path`, `growth_path` (files in the bucket), `credits` (CREDITS.md text), `published_at`, `published_by`.
- `hvac_notes.sections` - per notebook: `tab`, `nav` (the `nav.json` text: slug, title, summary, updated, group, prereq, related, keywords, aliases, start, kind, layout).
- `hvac_notes.pages` - `tab`, `slug`, `md` (Markdown, at most 400 000 characters).
- `hvac_notes.files` - images: `path` (`<tab>/images/<file>`), `size`, `sha256`.
- Shared, with `author` (the author's display name): `highlights` (quote, colour, note) and the note in `cards`. Everyone with the tile reads them; only the author changes them; `edit` may remove them.
- `replies` - answers under a highlight (`kind` `highlight`, `ref` = highlight id) or a card note (`kind` `card`, `ref` = card row id), with `author`. Anyone with the tile reads and adds; the author deletes his own, `edit` any. Removing a note removes its replies.
- Private to each user: the colour in `cards`, `positions` (reading position per page), `state` (`review`, `practice`, `seen`).
- All tables: RLS on, no policies; reached only through the functions below.
- Bucket `hvac-notes` (private, 5 MB per file, images and JSON): `<tab>/images/<file>`, `_library/index-<tag>.json`, `_library/growth-<tag>.json`. Read: anyone with the tile. Write and delete: right `edit`, those paths only.

## Functions
All `security definer`, `search_path ''`, granted to `authenticated` only; every one starts with `core.require_tile('hvac-notes', …)`.
- `hvac_notes_library()` - version, file paths, credits, every notebook's `nav`.
- `hvac_notes_page(p_tab, p_slug)`, `hvac_notes_pages(p_routes)` (at most 300) - Markdown of pages.
- `hvac_notes_my_data()` - the caller's highlights, cards, positions and state; also updates the author name on his notes.
- `hvac_notes_shared()` - everyone else's highlights and card notes, with `by` (author name); no card colours; plus every reply (`mine` marks the caller's). At most 5000 of each, newest first.
- `hvac_notes_reply_save(p_kind, p_ref, p_body)` - a reply; returns its id. `hvac_notes_reply_delete(p_id)` - own, or any with `edit` (audited `reply_removed`).
- `hvac_notes_highlight_save`, `hvac_notes_card_save`, `hvac_notes_position_save`, `hvac_notes_state_save` - the caller's own records (another user's highlight id: `INVALID:id`).
- `hvac_notes_highlight_delete(p_id)` - the caller's own; anyone's with `edit` (audited `note_removed`); otherwise `NOT_FOUND`.
- `hvac_notes_card_remove(p_id)` - right `edit`: remove another user's card note (audited `note_removed`).
- `hvac_notes_my_import(p_data)` - restore the caller's own backup file.
- `hvac_notes_publish_export()` - right `edit`: everything published, for the export zip and the Publish page.
- `hvac_notes_publish_commit(p_base, …)` - right `edit`: one atomic publish; refused (`INVALID: version`) if someone published since `p_base`. Audited as `publish`.

## Writing and publishing pages
- Format unchanged from the old site: `src/<notebook>/<slug>.md`, `src/<notebook>/nav.json`, `src/<notebook>/images/…`, `src/CREDITS.md`. Template: `tools/page-template.md`. Writing rules: the project's writing rules, unchanged.
- Check before upload: `node tools/lint.mjs <folder>` (same rules as the Publish page: `assets/js/lint.js`, `assets/js/indexer.js`).
- Publish page: pick a zip or the folder. By default the upload is merged over what is published (only pages in the upload change); *This is the whole library* also removes pages that are not in it. A page also goes when its notebook's new `nav.json` no longer lists it. The page shows the changes, the timeline entry and the check results before anything is sent.
- Download all pages: a zip of `src/` exactly as published (Markdown, `nav.json`, images, `CREDITS.md`, `growth.json`). It is the authoring copy and the backup.

## Decisions
- 2026-11-04 (owner) - see the project's Tile decisions. Summary: new clean repo; content in Supabase; per-user data in the database; online only; no source repo, `HVAC` deleted after cut-over.
- The reader keeps its own look inside the page area (paper themes Light, Sepia, Gray, Dark; Source Serif 4); the DAME top bar and theme tokens stay the core's. View settings only are kept in the browser, key `dame.hvac-notes.view`.
- Widgets are tile code in `assets/js/widgets/`. Explorers that showed product figures (`clearance-explore`, `multi-chiller-explore`, `bag-depth-explore`, `filter-wall-explore`) get them from the page's widget block (`"data": {…}`), which is stored in Supabase with the page. The lint refuses an explorer without its figures.
- Practice formulas are worked out by a small evaluator (`assets/js/hn-expr.js`); no `eval` or `Function`.
- Rendered Markdown and KaTeX go through DOMPurify (`vendor/dompurify`); inline styles from KaTeX are filtered and applied through the CSS object model (the CSP blocks style attributes). Markup written in code uses `HN.html` / `HN.svg`, which never parse a value as markup.
- YouTube: a card; a tap loads YouTube's privacy-mode player in place, on the conditions of the admin repo's `docs/SECURITY.md` section 4 (exception for this tile, 2026-11-04): `index.html` alone carries `frame-src https://www.youtube-nocookie.com`; nothing loads from YouTube before the tap; the address is built in code from the checked 11-character id and a whole-number start; the frame is sandboxed with `referrerpolicy` set; "Watch on YouTube" is always shown beside it. `publish.html` keeps the standard line.
- First publish: if the upload holds the old site's `index.json` and `growth.json`, the old timeline is carried over and only pages that differ from the old index count as changes.
- 2026-11-05 (owner) - New notebook **Refrigeration** (`refrigeration`, Books shelf after Theory, cover #B8325A, p–h cycle cover art). Theory stays the home of shared articles; Refrigeration lists them as linked chapters (below). Notebook ids live in `assets/js/app.js` (TABS, BOOKS, PATH_ORDER) and `assets/js/lint.js` (TABS); the database accepts any id.
- 2026-11-05 (owner) - **Linked chapters: one article, two doors.** An article has one home (usually Theory) and another notebook may list it: a `nav.json` entry `{ "link": "theory/<slug>", "group": "…" }` (no slug, title or file). The notebook's chapter list, its sidebar list and its cover count show it with an "In <home notebook>" tag and open the page at its home route; highlights, notes, positions, search, Up next and the timeline all stay on the home page. `HNData.toc(tab)` resolves the list; `HNData.nav(tab)` stays own pages only. The Publish check refuses a link to a page that does not exist, to the same notebook, or listed twice.
- No service worker, no manifest, no install prompt: installing is the whole DAME app's job (owner, 2026-11-04).
- 2026-11-04 (owner) - Troubleshooting and In the Field belong to each notebook (`#/symptoms/<tab>`, `#/field/<tab>`, rows on the notebook page), not to the library. Each card has one button, which opens focus mode on that card; colour, note and replies are edited there. On wide screens focus mode is a floating window over the dimmed page. Publish is a view inside the reader (`#/publish`, right `edit`, same shell and theme); `publish.html` remains as the stand-alone page. No install button or manifest in the tile.
- 2026-11-04 (owner) - Questions and answers: any highlight or card note can be answered by anyone with the tile, in a thread under it (sheet, card sheet, focus mode). A mark or card note shows its reply count. **Discussions** (sidebar) lists every note with a thread, newest activity first, with Unanswered / All; a note counts as answered once someone other than its author replied. The sidebar shows the unanswered count.
- 2026-11-04 (owner) - Highlights and notes are shared, each showing who made it. On the page, others' highlights are a faint tint (underlined when they carry a note); tap for name, date and note. Card notes show the author's name on the card. The notebook's Highlights & Notes has Everyone / Mine. Settings: *Others' highlights & notes* Show / Hide (view setting). Others' notes are reloaded at most once a minute, when a page opens or the tab comes back. Author names come from `core.display_names('hvac-notes', ids)` inside `hvac_notes_shared()` (`004_names_no_temp.sql`, which replaced `003_names.sql`: no temp table, read only); the name saved with each record is the fallback for an account the core does not name.

## Local test (code only, invented content)
`bash tools/test/run.sh` - evaluator, code rules, database tests, page check, and a browser test of the Publish page and the reader against a local Postgres and a stand-in for Supabase. Needs `dame-hub` cloned next to this repo; see the top of `tools/test/run.sh`.
