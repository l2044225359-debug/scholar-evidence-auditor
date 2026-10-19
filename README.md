# Scientific Evidence Auditor

Local academic research workspace with RAG, evidence audits, citation graphs and
multiple Qwen model routes.

The shipped interface system is documented in `DESIGN.md`; durable product
facts and competition context are recorded in `PRODUCT.md`.

## Team

The competition profile, role split and defense checklist are in
[`TEAM.md`](TEAM.md). Replace the marked personal-information placeholders
before submission.

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
- VibeVoice Realtime TTS: internal `http://127.0.0.1:8002`

VibeVoice provides optional English answer narration. It runs as an isolated
CUDA service inside WSL and is reached by the browser through the authenticated
Next.js BFF at `/api/voice/tts`. The service is not exposed directly to the LAN.
The Realtime model is English-focused, so Chinese UI mode does not show the
narration control. See `services/vibevoice/README.md`.

## First setup

The production-style local runtime is hosted entirely in WSL. Windows only runs
the browser and keeps the source working copy.

For a clean Windows restart, double-click `start-scholar.cmd`. It starts WSL,
waits for all services, refreshes the Windows-to-WSL port proxy and opens the
workspace in the default browser.

```powershell
npm run demo:start
npm run demo:status
```

The WSL runtime is `/home/lh/race/workbench`. It owns its Linux Node.js,
`node_modules`, SQLite data, uploads and build output. See `docs/wsl-server.md`.

The demo initializer creates `admin`, `examiner1`, and `examiner2`. Their random
passwords and the active invitation code are written to the ignored local file
`data/demo-accounts.json`.

## Development

```powershell
npm --prefix apps/web run dev
```

This Windows development command is optional. It is not used by
`npm run demo:start`.

## WSL production-style run

```powershell
npm run demo:start
npm run demo:lan
```

The application is designed for a trusted local network. Do not expose it
publicly without HTTPS, secret rotation and a reviewed network boundary.

Administrator PDF ingestion is serialized through a single SQLite-backed worker.
See `docs/document-ingestion.md`.

The document library accepts batch uploads. Before indexing, Kotaemon compares
PDF content, arXiv identity, version labels and body-text overlap against the
current library, then asks the administrator to keep, replace or retain both
versions. See `docs/document-ingestion.md`.

The document library includes a live knowledge-base overview for documents,
pages, vector chunks, OCR-recovered pages, local citation edges and index
health. See `docs/knowledge-overview.md`.

Citation evidence opens in a local PDF.js academic reader with an outline,
clickable numeric citations, bidirectional References navigation and a
page-aligned Chinese/English translation pane. See `docs/pdf-reader.md`.

Citation Graph includes a local 20-paper corpus view with NetworkX PageRank,
component/density metrics, foundational-paper ranking and Qwen-generated Future
Work synthesis. See `docs/local-citation-graph.md`.

The Agent Trace panel records chat planning, retrieval, model routing and tool
steps. It also exposes two real tools: controlled arXiv download/ingestion and
CSV analysis with pandas, Matplotlib, Qwen-generated captions and copyable
Mermaid/TikZ scripts. A Writing tool produces an evidence-grounded paper
framework, verified References and BibTeX. See `docs/agent-tools.md`.

Evidence audits extract claims, map page evidence, verify numbers and citation
integrity, and generate JSON or printable reports. See `docs/evidence-audit.md`.

## Verification

```powershell
npm run demo:status
npm run demo:verify
npm run demo:evaluate
```

See `docs/day4-verification.md` for the final 30/30 evaluation and smoke-test
results.

## One-command start

```powershell
npm run demo:start
npm run demo:health
npm run demo:stop
```

## Day 5 reset and package

```powershell
npm run demo:reset
npm run submission:package
```

The reset command creates fresh demo accounts and rebuilds a two-document demo
knowledge base. The packaging command excludes all secrets and runtime data.
See `docs/day5-submission.md`.

## Public deployment

The public entry should expose only the authenticated Next.js application on
port `3000`. Never publish the Kotaemon BFF (`7860`), Citation Graph (`8001`) or
VibeVoice (`8002`) directly.

```powershell
npm run demo:start
powershell -ExecutionPolicy Bypass -File deploy/public/start-quick-tunnel.ps1
```

The Quick Tunnel URL is temporary. For a stable hostname, create a named
Cloudflare Tunnel and use
`deploy/public/start-named-tunnel.ps1`. Configuration and the complete security
checklist are in `docs/public-deployment.md`.

## Submission deliverables

- Team profile: `TEAM.md`
- Deployment guide: `docs/public-deployment.md`
- Technical document: `outputs/Scholar-technical-document.pdf`
- Demo video: `outputs/Scholar-demo.mp4`
- Reproducible package and SHA-256: `outputs/submission/`

The final archive is generated with:

```powershell
npm run submission:package
```
