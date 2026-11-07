# HVAC Notes tile

Tile id `hvac-notes` - path `/hvac-notes/` - schema `hvac_notes` - functions `public.hvac_notes_*` - private bucket `hvac-notes`.

## What it does
A reading app for HVAC product and engineering notes: six notebooks (Theory, Refrigeration, Chillers, AHU, FCU, Systems) and a Books shelf (ASHRAE Handbook - Fundamentals), with search, terms, standards, troubleshooting, self-check questions, review, shared highlights and notes (with the author's name), and a growth timeline. `publish.html` uploads new or changed pages and downloads all pages as a zip.

This repo is public and holds code only. The pages, images, search index and timeline live only in Supabase.

## Who can do what
Access is the core's (admin repo `docs/TILE-CONTRACT.md` section 5, core 011), declared in `db/hvac_notes/006_access.sql` (`core.tile_declare`). A person's level is the highest of his own and his groups' (Admin > Tiles > HVAC Notes > Access); on each notebook it is capped by how the notebook is shared with him.

Container kind: `notebook` ("Notebook") - one per notebook, id = the notebook id (`theory`, `refrigeration`, `chillers`, `ahu`, `fcu`, `systems`, `ashrae`). New ones start as **everyone can edit** (everyone in the tile, each at his own level). Shared from **Share** on the notebook page (managers): everyone can edit, everyone can view, or only the people and groups listed (Can view / Can edit). The notebooks 006 registered have no owner (managers share them); a notebook first published later is owned by its publisher (the core's rule for a new container).

| Level      | In this tile |
|---|---|
| read       | Read the approved pages of the notebooks open to him; his own reading position, review, practice and card colours. No highlights, card notes or replies there (the page says "View only"). |
| contribute | + his own highlights, card notes and replies, seen by everyone who can read the page; deletes his own. |
| edit       | + sees the drafts of the notebooks where he has edit. The **Publish page** (publish pages, which arrive as drafts; Download all pages; Move now) needs edit on **every** notebook, because one publish carries the whole library's search index and timeline. |
| approve    | + **Approve** and **Hide** the notebook's pages; removes anyone's highlight, card note or reply on its pages (audited). |
| manage     | Every notebook, private ones too; **Share**; *This is the whole library* on the Publish page (removing pages a notebook still lists, whole notebooks, images); people and access of the tile (only the super user names managers). |

Aliases: none. Special rights: none (005's `nb_<notebook>` rights became notebook shares in 006). Default level when a manager gives the tile: contribute. 011 set every existing user from his rights: `edit` -> edit, tile admin -> manage, anyone else -> contribute.

Functions and their level ("page open" = `hvac_notes.can_see`: an approved page of a notebook he may open, or a draft where he has edit; otherwise `NOT_FOUND`):
- `hvac_notes_library`, `_page`, `_pages`, `_index`, `_growth`, `_shared`, `_my_data`, `_position_save`, `_state_save` - the tile; everything filtered to the pages open to him.
- `hvac_notes_card_save` - colour only: read, page open; with a note: contribute on the notebook.
- `hvac_notes_highlight_save`, `_reply_save` - contribute on the page's notebook (`NO_RIGHT` below it).
- `hvac_notes_highlight_delete`, `_reply_delete` - his own: the tile; anyone's: approve on the notebook (else `NOT_FOUND`). `hvac_notes_card_remove` - approve on the notebook.
- `hvac_notes_my_import` - restores only what he may write (highlights and card notes: contribute; colours: read); positions as before.
- `hvac_notes_page_status` - approve on the notebook of every page named.
- `hvac_notes_publish_export`, `_publish_commit` - edit on every notebook (`hvac_notes.can_publish`). In the commit, removing a notebook, an image, or a page whose new `nav.json` still lists it (or whose `nav.json` is not in the upload) needs manage.
- `hvac_notes_file_open` (bucket read policy) - images: the notebook is open to him, or not published yet and he may publish; `_library/*`: may publish. `hvac_notes_file_write` (insert and update policies) - images only, may publish. `hvac_notes_file_remove` (delete policy) - `_library/*`: may publish; images: manage.

## Who sees what (005, owner 2026-11-06; notebooks shared through the core since 006)
- **Notebook:** shared from the core's Access panel (above). A notebook he may not open is off the shelf, the tab bar and the sidebar; its pages, images, notes and search entries are not sent.
- **Page:** *Draft* or *Approved*. A newly published page is a draft; someone with approve on its notebook opens it and presses **Approve**. **Hide** puts it back to draft. A change to an approved page goes live at once. Pages published before 005 are approved.
- **Links:** the page's home decides. A linked chapter, prereq, related page, Up next, search entry, term, standard, symptom, check question, In the field item, timeline item, highlight, card note or reply of a page the reader cannot open is not sent to him. A link in the text to such a page shows as plain text ("Not available yet"). Known limit: an image of a draft page in an open notebook can be fetched by its exact file name (which the reader never receives).
- The database does all of this (`hvac_notes.visible_routes`, `nav_for`, `idx_for`); the page only hides what it was not sent.

## Data
- `hvac_notes.library` - one row: `version`, `growth` (the timeline), `credits` (CREDITS.md text), `published_at`, `published_by`; `index_path`, `growth_path` are the old bucket files, null once moved (Publish page > *Move now*).
- `hvac_notes.sections` - per notebook: `tab`, `nav` (the `nav.json` text: slug, title, summary, updated, group, prereq, related, keywords, aliases, start, kind, layout).
- `hvac_notes.pages` - `tab`, `slug`, `md` (Markdown, at most 400 000 characters), `status` (`draft` / `approved`), `approved_at`, `approved_by`, `idx` (its search-index entry), `ord` (place in the index).
- `hvac_notes.files` - images: `path` (`<tab>/images/<file>`), `size`, `sha256`.
- Shared, with `author` (the author's display name): `highlights` (quote, colour, note) and the note in `cards`. Everyone who can read the page reads them; only the author changes them (contribute); approve on the notebook may remove them.
- `replies` - answers under a highlight (`kind` `highlight`, `ref` = highlight id) or a card note (`kind` `card`, `ref` = card row id), with `author`. Anyone who can read the page reads them; contribute adds; the author deletes his own, approve on the notebook any. Removing a note removes its replies.
- Private to each user: the colour in `cards`, `positions` (reading position per page), `state` (`review`, `practice`, `seen`).
- All tables: RLS on, no policies; reached only through the functions below. Who may open which notebook is the core's (`core.containers`, `core.shares`), never a table of this tile.
- Bucket `hvac-notes` (private, 5 MB per file): `<tab>/images/<file>`. Read: anyone who can open that notebook (`public.hvac_notes_file_open`). Write: whoever may publish, images only (`public.hvac_notes_file_write`). Delete: manage for images, whoever may publish for the old `_library/*.json` files (`public.hvac_notes_file_remove`).

## Functions
All `security definer`, `search_path ''`, granted to `authenticated` only; every one starts with `core.require_tile('hvac-notes', …)`.
- `hvac_notes_library()` - version and every notebook's `nav` the caller may read (cut unless he may publish); `levels` (his level per notebook), `editor` (may publish), `approver` (approve somewhere), `manager`, `sharing` (managers: who can open each notebook), `drafts` he may see, `closed` (notebooks he may not open).
- `hvac_notes_page(p_tab, p_slug)`, `hvac_notes_pages(p_routes)` (at most 300) - Markdown of pages the caller may read (`NOT_FOUND` otherwise).
- `hvac_notes_index()` - the search index of the pages the caller may read (null before the move: the reader then builds it). `hvac_notes_growth()` - the timeline, items of other pages left out.
- `hvac_notes_page_status(p_routes, p_status)` - approve on each page's notebook: `approved` or `draft` (audited `page_approved` / `page_hidden`). Who can open a notebook: the core's `core_share_*` (Access panel); `hvac_notes_notebook_set` was dropped in 006.
- `hvac_notes_file_open(p_name)`, `hvac_notes_file_write(p_name)`, `hvac_notes_file_remove(p_name)` - for the bucket's policies only (true or false for the signed-in user; no `require_tile`, like `core.has_tile`).
- `hvac_notes_my_data()` - the caller's highlights, cards, positions and state; also updates the author name on his notes.
- `hvac_notes_shared()` - everyone else's highlights and card notes on pages the caller may read, with `by` (author name); no card colours; plus their replies (`mine` marks the caller's). At most 5000 of each, newest first. Saving a highlight, card note or reply on a page the caller cannot read: `NOT_FOUND`.
- `hvac_notes_reply_save(p_kind, p_ref, p_body)` - a reply (contribute); returns its id. `hvac_notes_reply_delete(p_id)` - own, or any with approve on the notebook (audited `reply_removed`).
- `hvac_notes_highlight_save`, `hvac_notes_card_save`, `hvac_notes_position_save`, `hvac_notes_state_save` - the caller's own records (another user's highlight id: `INVALID:id`).
- `hvac_notes_highlight_delete(p_id)` - the caller's own; anyone's with approve on the notebook (audited `note_removed`); otherwise `NOT_FOUND`.
- `hvac_notes_card_remove(p_id)` - approve on the notebook: remove another user's card note (audited `note_removed`).
- `hvac_notes_my_import(p_data)` - restore the caller's own backup file (only what his level allows).
- `hvac_notes_publish_export()` - edit on every notebook: everything published (with the index, timeline and drafts; `manager`), for the export zip and the Publish page.
- `hvac_notes_publish_commit(p_base, p_navs, p_pages, p_remove, p_files, p_remove_files, p_credits, p_index, p_growth)` - edit on every notebook: one atomic publish, carrying the whole index and timeline; the whole-library removals need manage; a notebook seen for the first time is registered as a container; new pages are drafts; refused (`INVALID: version`) if someone published since `p_base`. Audited as `publish`.

## Writing and publishing pages
- Format unchanged from the old site: `src/<notebook>/<slug>.md`, `src/<notebook>/nav.json`, `src/<notebook>/images/…`, `src/CREDITS.md`. Template: `tools/page-template.md`. Writing rules: the project's writing rules, unchanged.
- Check before upload: `node tools/lint.mjs <folder>` (same rules as the Publish page: `assets/js/lint.js`, `assets/js/indexer.js`).
- Publish page: pick a zip or the folder. New pages arrive as drafts (the page says so, and lists the drafts waiting). By default the upload is merged over what is published (only pages in the upload change); *This is the whole library* also removes pages that are not in it. A page also goes when its notebook's new `nav.json` no longer lists it. The page shows the changes, the timeline entry and the check results before anything is sent.
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
- 2026-11-06 (admin repo, `docs/TILE-CHANGES.md`, owner: one access model for every tile) - **Levels and notebook sharing** (`006_access.sql`). Notebooks are core containers shared from the Access panel (Share on the notebook page, managers); the `nb_*` rights and the notebook setting are gone (whoever held `nb_<notebook>`, and editors, kept the notebook as a Can edit share). Levels: read, contribute (notes), edit (drafts, publish), approve (approve/hide pages, remove others' notes; was the tile admin / the right `edit`), manage (Share, whole library). Publishing needs edit on every notebook (one publish carries the whole index and timeline); publishing per notebook is a later step if a team needs it.
- 2026-11-06 (owner) - **Who can read.** Notebook level: all users, or selected users (right `nb_<notebook>`; replaced by 006). Page level: new pages are drafts until the tile admin approves them; Hide sends a page back to draft; changes to an approved page go live without a second approval. A page's home decides for every link to it. No content moved. The index and timeline moved from the bucket into the database so every read can be filtered (`005_visibility.sql`).
- 2026-11-05 (owner) - **Linked chapters: one article, two doors.** An article has one home (usually Theory) and another notebook may list it: a `nav.json` entry `{ "link": "theory/<slug>", "group": "…" }` (no slug, title or file). The notebook's chapter list, its sidebar list and its cover count show it with an "In <home notebook>" tag and open the page at its home route; highlights, notes, positions, search, Up next and the timeline all stay on the home page. `HNData.toc(tab)` resolves the list; `HNData.nav(tab)` stays own pages only. The Publish check refuses a link to a page that does not exist, to the same notebook, or listed twice.
- No service worker, no manifest, no install prompt: installing is the whole DAME app's job (owner, 2026-11-04).
- 2026-11-04 (owner) - Troubleshooting and In the Field belong to each notebook (`#/symptoms/<tab>`, `#/field/<tab>`, rows on the notebook page), not to the library. Each card has one button, which opens focus mode on that card; colour, note and replies are edited there. On wide screens focus mode is a floating window over the dimmed page. Publish is a view inside the reader (`#/publish`, right `edit`, same shell and theme); `publish.html` remains as the stand-alone page. No install button or manifest in the tile.
- 2026-11-04 (owner) - Questions and answers: any highlight or card note can be answered by anyone with the tile, in a thread under it (sheet, card sheet, focus mode). A mark or card note shows its reply count. **Discussions** (sidebar) lists every note with a thread, newest activity first, with Unanswered / All; a note counts as answered once someone other than its author replied. The sidebar shows the unanswered count.
- 2026-11-04 (owner) - Highlights and notes are shared, each showing who made it. On the page, others' highlights are a faint tint (underlined when they carry a note); tap for name, date and note. Card notes show the author's name on the card. The notebook's Highlights & Notes has Everyone / Mine. Settings: *Others' highlights & notes* Show / Hide (view setting). Others' notes are reloaded at most once a minute, when a page opens or the tab comes back. Author names come from `core.display_names('hvac-notes', ids)` inside `hvac_notes_shared()` (`004_names_no_temp.sql`, which replaced `003_names.sql`: no temp table, read only); the name saved with each record is the fallback for an account the core does not name.

## Local test (code only, invented content)
`bash tools/test/run.sh` - evaluator, code rules, database tests (`db/hvac_notes/tests.sql`), the upgrade as on live (`tools/test/db-upgrade.sh`: 005 data with `nb_*` rights and a group, core 011, then 006), page check, a browser test of the Publish page, the reader and the Access panel, and every changed function over HTTP rpc (`tools/test/http-rpc.mjs` on the admin repo's `dev/test/mock-supabase.mjs`), against a local Postgres and a stand-in for Supabase. Needs `dame-hub` cloned next to this repo; see the top of `tools/test/run.sh`.
