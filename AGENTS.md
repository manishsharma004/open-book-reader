# Agent instructions

## Design changes

When a design decision changes, do all three of these in the same piece of work. Do not stop after the file edit.

1. Update the spec files in `specs/discussion/` so they are the current design, including diagrams.
   - `DESIGN.md`: product, pipeline, storage, playback, sizing, acceptance. The entry point.
   - `PROVIDERS.md`: settings document, proxy contract, deployment modes, proxy security, vendor tables.
   - `UX.md`: screens, controls, states and microcopy, accessibility, mobile.
   - `REVIEW.md`: review findings. When a review or a change fixes a problem in the design, add a row with the finding, the resolution, and where it now lives.
   - Keep the files consistent with each other. A term defined in one (for example "text profile" or a task status) means the same thing in all of them.
2. Update GitHub issue #1 so it mirrors the files.
   - Issue: https://github.com/manishsharma004/open-book-reader/issues/1
   - Run `python3 scripts/sync_design_issue.py --dry-run`, then `python3 scripts/sync_design_issue.py`. The issue body becomes a short preamble plus `DESIGN.md`. Every other spec file is one comment on the issue, found by its `<!-- spec-file: ... -->` marker and edited in place.
   - A new spec file must be added to `COMMENT_FILES` in the script.
   - GitHub rejects a body or comment over 65,536 characters. The script checks this before writing. If a file is too long, split it into a new spec file rather than trimming content.
3. Commit and push to the `main` branch. Fast-forward `main`. Do not force-push. If `main` has moved, pull and rebase or merge, then push again.

Push the spec files before syncing the issue, because the issue links at `main` and the link and the mirror should describe the same text.

Authenticate to GitHub with the token in `$GITHUB_TOKEN_FILE`. Do not print the token, and do not put it in a remote URL. The sync script reads the token from that file itself.

## Standing architecture

These constraints are already decided in `specs/discussion/DESIGN.md`. Keep them when you edit the design.

- Book data, embeddings, analysis results, audio, playback position, task state, and vendor settings stay in the browser, in IndexedDB. File and audio bytes are Blob values.
- The backend for transcription, analysis, and completion is a stateless proxy. It does not store the book or the settings. Each request includes the provider profile, and the proxy forwards it to that profile's base URL so the browser does not call the vendor directly.
- The app and the proxy are served from the same origin by default, because browsers block or prompt for HTTPS pages calling LAN and loopback addresses. See `PROVIDERS.md`.
- The UI is Svelte 5, SvelteKit with static output, Tailwind CSS, and shadcn-svelte. Ink is the default palette and Lamp stays available. The server is FastAPI. See `DESIGN.md` section 12.

## Vendor facts

Vendor APIs, model names, and retirement dates change. When a spec states a vendor fact, check it against the vendor's current documentation and say in the spec when it was checked.

## Later sessions

`CLAUDE.md` is the handoff for the machine this repo is running on. Read it before changing speech, Pocket, or processes. `DESIGN.md` §1.2 is what the app does today. The rest of `specs/discussion/` is the target pipeline and is not built.

- Publish services only on ports 7500–7510. The app server is 7507. Pocket is 7508. Do not bind or document a service outside that range.
- A change under `apps/web` is served from `apps/web/build` after `npm run build`. Do not restart the app server for a web-only change. Restart it only when `apps/server` changes. Restart Pocket only when `services/pocket` changes.
- Do not install Pocket's `requirements.txt` on this machine. That file does not pin torch, and a Linux install replaces the ROCm wheel with a CUDA wheel. Do not set `HSA_OVERRIDE_GFX_VERSION`.
- Do not kill processes by name. If a process must stop, stop that pid.
- Commit as `manishsharma004` / `51284079+manishsharma004@users.noreply.github.com` with `git -c`. Do not change global git config. Do not force-push. Do not commit `apps/web/test_*.cjs`.
- `gh` is not on PATH. The design sync script reads `$GITHUB_TOKEN_FILE` itself. Do not print the token.
