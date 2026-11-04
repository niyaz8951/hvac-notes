# hvac-notes - DAME tile

HVAC Notes, a reading app for HVAC product and engineering notes, as a tile of DAME: login, roles, theme and file access come from the core at `/dame-hub/core/v1/`; pages, images and the search index are read from Supabase through `public.hvac_notes_*` functions and the private bucket `hvac-notes`. This repo is public and holds code only, plus invented examples for testing. See `docs/TILE.md`.

Third-party code in `vendor/` keeps its own licence (see `vendor/README.md`).
