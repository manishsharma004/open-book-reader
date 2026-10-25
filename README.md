# Open Book Reader

The browser keeps the book. FastAPI serves the Svelte app and a stateless `/v1` proxy. Speech for the open page and the pages ahead is prepared in short clips. `specs/discussion/DESIGN.md` §1.2 is what the app does today. The rest of `specs/discussion/` is the target pipeline and is not built.

## Run

```bash
cd apps/web && npm install && npm run build
cd ../server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn open_book.main:app --app-dir . --host 0.0.0.0 --port 7507
```

Open `http://localhost:7507`. Use a free port from 7500 to 7510. The server reads `apps/web/build` from disk, so a web-only change needs `npm run build` and does not need a server restart.

Pocket TTS is a second process. It listens on port 7508. The app server forwards vendor `pocket` to it. Do not install `services/pocket/requirements.txt` on a machine that already has the ROCm torch wheel: that file does not pin torch.

```bash
POCKET_HOST=0.0.0.0 POCKET_PORT=7508 POCKET_LANGUAGE=english_18m_refl_2026-10 \
  services/pocket/.venv/bin/python services/pocket/app.py
```

## Checks

```bash
cd apps/web && node --import ./tests/register.mjs --test tests/*.test.ts
cd apps/server && PYTHONPATH="$PWD" .venv/bin/python -m pytest
```

## Design

`specs/discussion/` is the design. After a spec change, push `main`, then from the repo root:

```bash
python3 scripts/sync_design_issue.py --dry-run
python3 scripts/sync_design_issue.py
```

The script mirrors the files onto GitHub issue #1. It reads `$GITHUB_TOKEN_FILE` and does not print the token. `AGENTS.md` and `CLAUDE.md` are the instructions for a later session.
