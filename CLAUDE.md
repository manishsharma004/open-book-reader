# Later sessions

Follow `AGENTS.md`. This file is the handoff for the machine and the reader as of 26 October 2026.

`specs/discussion/DESIGN.md` §1.2 is what the app does. The open-book browser is built: one provider interface, the `/open` screen, and a module plus a registration line for each source (`DESIGN.md` §6.1.1, `PROVIDERS.md` §10). The reader stores a chapter list of title and page (`apps/web/src/lib/chapters.ts`) and jumps to that page. Spans, embeddings, the span-range chapter model in §6.3, the Ready gate, and export are not built. Do not start them unless the request asks for them. `docs/LEARNINGS.md` is why the running reader is shaped this way, and which earlier fixes did not work.

## Where the running reader lives

- Clips and pace: `apps/web/src/lib/speech-clips.ts`
- Punctuation kept on spoken words: `apps/web/src/lib/spoken-text.ts`
- Chapter title, body, and running header on a page: `apps/web/src/lib/page-roles.ts`
- Chapter list and page jump: `apps/web/src/lib/chapters.ts`
- Page buffer, early play, and abort: `apps/web/src/lib/prepare.ts`
- Player, two audio elements, page turn, pace, remove sample: `apps/web/src/routes/read/[id]/+page.svelte`
- Settings and the saved sample: `apps/web/src/lib/settings.ts`, `apps/web/src/lib/settings-store.svelte.ts`, `apps/web/src/routes/settings/+page.svelte`
- Proxy, including closing Pocket when the browser leaves: `apps/server/open_book/main.py`
- Pocket process, GPU choice, and stop-on-disconnect: `services/pocket/app.py`

Speech is clips that end on a full stop and pack up to the player pace (default 24, steps of 4 from 8 to 48). A longer sentence stays one clip until twice the pace, capped at 64 words. The open page plus the next 2 or 3 pages stay buffered. Playback starts on the first clip. The idle audio element preloads the next clip. The last line of a page turns the page. A chapter title is its own clip. A running header, footer, or page number is not spoken. **Remove sample** deletes the reference from IndexedDB.

## This machine

- App server: `apps/server/.venv`, `uvicorn open_book.main:app --host 0.0.0.0 --port 7507`. It reads `apps/web/build` from disk. Rebuild the web app to update the UI. Restart this process only after a Python proxy change.
- Pocket: `services/pocket/.venv`, `POCKET_HOST=0.0.0.0`, `POCKET_PORT=7508`, `POCKET_LANGUAGE=english_18m_refl_2026-10`. It must listen on `0.0.0.0` so the published port reaches it. Health is `GET /health`.
- The only ports this container may publish are 7500–7510. Kokoro on 8880 and Ollama on 11434 or 5173 are on the LAN host `127.0.0.1`, not in this container. Do not use port 8000 for Pocket.
- Pocket uses the RX 5500M (gfx1012) when that card has at least 1 GB free, through the existing ROCm torch `2.14.0+rocm10.1.0`. Do not `uv pip install -r services/pocket/requirements.txt`. That file does not pin torch, and the install replaces the ROCm wheel with a CUDA wheel. Do not set `HSA_OVERRIDE_GFX_VERSION`.
- The Laya brain was stopped on purpose so Pocket could use the GPU. Do not start it again. Leave the chat UI that was already on 7504 and 7509 alone.
- `HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN` are unset. The loaded weights are `pocket-tts-without-voice-cloning`. Builtin voice names work. An uploaded sample is still sent as `voice_wav`, but these weights do not clone a speaker. Do not claim that they do, and do not try to download the gated cloning weights.
- Builtin ids for `english_18m_refl_2026-10`: alba (default), anna, azelma, bill_boerst, caro_davy, charles, cosette, daan, eponine, estelle, eve, fantine, george, giovanni, jane, javert, jean, juergen, lola, marius, mary, michael, paul, peter_yearsley, rafael, stuart_bell, vera.
- Selecting Pocket rewrites an allowed Kokoro host from port 8880 to 7508. A saved Pocket URL on port 8000 is rewritten to 7508. Port 8000 is refused.

## Checks

From `apps/web`:

```bash
npm run build
node --import ./tests/register.mjs --test tests/*.test.ts
```

From `apps/server`, with `PYTHONPATH=/workspace-6/apps/server` and `apps/server/.venv`:

```bash
python -m pytest
```

`svelte-check` still fails on the existing `apps/web/src/hooks.client.ts` (`HandleClientError` is not exported). That failure was already there. Headless Chrome for a UI check is `/home/agent/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome`, with puppeteer-core under `/tmp/pup/node_modules/puppeteer-core`. `page.locator().innerText` is not a function; use `$eval`.

## Git and the design issue

- Branch names are `cursor-agent/<description>-c80c`, lowercase.
- Commit with `git -c user.name='manishsharma004' -c user.email='51284079+manishsharma004@users.noreply.github.com'`. Do not change global git config. Do not force-push. Fast-forward `main`.
- Do not commit `apps/web/test_*.cjs`.
- After a spec change, push `main`, then run `python3 scripts/sync_design_issue.py --dry-run` and `python3 scripts/sync_design_issue.py` from the repo root. The script reads `$GITHUB_TOKEN_FILE`. Do not print the token. `gh` is not on PATH.
- Issue #1 mirrors `DESIGN.md`. The other spec files are comments: PROVIDERS `6396108636`, UX `6396108890`, REVIEW `6396109263`.

## Do not

- Kill processes by name (`pkill -f`). Stop a pid only when that process is the one that must stop.
- Restart Pocket or the app server for a web-only change.
- Install CUDA torch, or any Pocket dependency set that would replace the ROCm wheel.
- Add a server-side book store, or send the browser to a vendor origin.
