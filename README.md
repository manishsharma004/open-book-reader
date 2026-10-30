# Open Book Reader

The browser keeps the book. FastAPI serves the Svelte app and a stateless `/v1` proxy. Speech for the open page and the pages ahead is prepared in short clips. The reader jumps to chapters taken from a PDF outline or from headings in the text. **Browse open books** downloads a file the source already gives away into the same library. `specs/discussion/DESIGN.md` §1.2 is what the app does today. The rest of `specs/discussion/` is the target pipeline and is not built. `docs/LEARNINGS.md` records why the reader works this way.

## Run

```bash
cd apps/web && npm install && npm run build
cd ../server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn open_book.main:app --app-dir . --host 0.0.0.0 --port 7507
```

Open `http://localhost:7507`. Use a free port from 7500 to 7510. The server reads `apps/web/build` from disk, so a web-only change needs `npm run build` and does not need a server restart.

Internal addresses stay out of git. Copy `apps/server/local.allow.example` to `apps/server/local.allow`. Each line is `OLLAMA_ALLOW` or `SPEECH_ALLOW` with one host, the same entries as those environment variables. The file and the environment are combined. A completion entry without a port uses 11434. A speech entry includes a port. Link-local and metadata addresses are still refused. `LOCAL_ALLOW_FILE` can point at another path. The file is not copied into the Docker image; mount it or set the environment variables for Compose.

The same app, Kokoro, and Pocket TTS also start from Docker Compose. Run it from the repository root. One profile builds Pocket: `cpu`, `cuda`, or `rocm`. CUDA reserves the NVIDIA GPUs. ROCm passes `/dev/kfd` and `/dev/dri`. Pocket uses the GPU when that card has at least 1 GB free. `HF_TOKEN` is the Hugging Face token for the gated Pocket weights. Docker Compose v2 is the command (`docker compose`).

```bash
docker compose --profile cpu up --build
HF_TOKEN=hf_... docker compose --profile rocm up --build
docker compose --profile cuda up --build
```

Stop with the same profile:

```bash
docker compose --profile cpu down
docker compose --profile rocm down
docker compose --profile cuda down
```

`scripts/run.sh --torch-backend cpu` runs that same `up --build`. `scripts/run.sh --help` lists the GPU checks the profile needs.

```bash
scripts/run.sh --torch-backend cpu
HF_TOKEN=hf_... scripts/run.sh --torch-backend rocm
```

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
