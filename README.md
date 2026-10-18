# Scientific Evidence Auditor

Local academic research workspace with RAG, evidence audits, citation graphs and
multiple Qwen model routes.

## Repository layout

```text
apps/web                 Next.js academic workspace
services/kotaemon        Kotaemon source and chat BFF
services/citation-graph  OpenAlex/Crossref citation graph service
scripts                  Launch and maintenance scripts
data                     Local SQLite and generated demo credentials
docs                     Design and operation notes
tests                    Evaluation and smoke tests
```

Runtime data and virtual environments remain outside Git.

## Services

- Next.js: `http://localhost:3000`
- Kotaemon/BFF: `http://localhost:7860`
- Citation Graph: `http://localhost:8001`

## First setup

```powershell
cd apps/web
npm install
npm run demo:init
npm run build
```

The WSL services require the local `.env` and Python environment described in
`services/kotaemon/.env.example`.

The demo initializer creates `admin`, `examiner1`, and `examiner2`. Their random
passwords and the active invitation code are written to the ignored local file
`data/demo-accounts.json`.

## Development

```powershell
npm --prefix apps/web run dev
```

## Production-style local run

```powershell
npm --prefix apps/web run build
npm --prefix apps/web run start
```

The application is designed for a trusted local network. Do not expose it
publicly without HTTPS, secret rotation and a reviewed network boundary.

Administrator PDF ingestion is serialized through a single SQLite-backed worker.
See `docs/document-ingestion.md`.

## One-command start

```powershell
npm run demo:start
npm run demo:health
```
