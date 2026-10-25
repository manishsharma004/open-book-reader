# open-book-reader

The browser keeps the books. FastAPI serves the Svelte UI and the `/v1` proxy.

```bash
cd apps/web && npm install && npm run build
cd ../server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn open_book.main:app --app-dir . --host 0.0.0.0 --port 7507
```

Open `http://localhost:7507`. The port can be any free port from 7500 to 7510.