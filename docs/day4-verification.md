# Day 4 verification

## Passed

- Windows client uses `http://localhost:3000`.
- LAN client uses `http://10.162.70.112:3000`.
- Windows firewall rule and `0.0.0.0:3000 -> WSL:3000` port proxy are active.
- Next.js, the index worker, Kotaemon, Citation Graph, and VibeVoice run inside
  WSL.
- Citation Graph GET/POST reverse proxy passes.
- Authenticated PDF preview reverse proxy passes with full PDF content.
- Login and registration rate limits, security headers, and proxy path
  restrictions pass.
- Login, unauthenticated API rejection, single index worker, SSE/RAG,
  authenticated proxy, PDF, and VibeVoice WAV smoke tests pass.
- Synthetic arXiv `1706.03762v1`/`v7` tests pass for older/newer version
  detection, keep-existing/keep-incoming recommendations and revision evidence.
- `attention.pdf` renders in the local PDF.js reader with an extracted outline,
  40 parsed References entries, clickable numeric citations and reverse
  cited-page links.
- Bilingual page translation preserves citation markers, and synchronized
  scrolling matches normalized left/right positions.
- Agent Trace chat events follow planning, retrieval, synthesis and completion
  order.
- The arXiv tool completes metadata retrieval, PDF download, fingerprinting and
  semantic duplicate checks.
- The CSV tool completes pandas profiling, Matplotlib rendering and a
  Qwen-generated caption with structured trace steps.
- The same CSV plot points generate copyable Mermaid `xychart-beta` and
  TikZ/PGFPlots source that match the rendered chart coordinates.
- The local citation graph processed all 7 current papers, produced 2 local
  citation edges and 5 weakly connected components, and calculated PageRank for
  every node. The UI supports a 20-paper corpus limit.
- The knowledge-base overview reports 7 documents, 129 pages, 265 vector
  chunks, 1 OCR-recovered page, 2 local citation edges and a 100/100 health
  score. Document and vector chunk counts match exactly.
- The workspace exposes Transformer (2 documents), RAG (4 documents) and Agent
  (2 documents) collections. Selecting RAG checks DPR, RAG, Self-RAG and Lost
  in the Middle and updates the chat context to `RAG · 4 papers`; stale conversation evidence is
  cleared on scope changes.
- Paper entity extraction produced 128 grounded entities and 133 relations:
  7 Paper, 43 Author, 20 Topic, 18 Method, 10 Dataset, 6 Metric and 24 Claim.
  Entity results are persisted by content hash and recovered from disk in
  approximately 0.17 seconds after a service restart.
- The NetworkX heterogeneous graph contains 128 total nodes and 135 total
  edges: 7 paper nodes, 121 non-paper entity nodes, 2 citation edges and 133
  entity relations. Paper PageRank remains isolated on the citation subgraph.
- A real RAG/DPR comparison answer returned 95% evidence coverage with
  5 page-grounded evidence items, 2/4 documents covered, 100% page grounding
  and 100% citation alignment. The workspace displayed the result as
  `证据充分`.
- Future Work passages were extracted from 5 papers and synthesized by
  `qwen3.8-max` into a prioritized research agenda.
- The WSL production build and TypeScript checks pass.
- The vectorstore was rebuilt from the current 104 document chunks. Chroma and
  LanceDB chunk IDs now match instead of returning zero vector hits.
- Qwen Rerank now retries transient failures and falls back to retrieval order
  instead of returning HTTP 500.

## Evaluation history

- Initial full run: 13/30 passed.
- After fixing vector scope, stale vector IDs, citation handling, reranker
  degradation, and evaluation synonym groups: 27/30 passed in one full run.
- A transient model entitlement interruption was resolved by restoring Bailian
  access.
- Final clean run: 30/30 passed.
- Retrieval hit rate: 100%.
- Citation page rate: 100%.
- Numeric verification rate: 100%.
- Refusal rate: 100%.
- Average latency: 13.3 seconds.

```powershell
npm run demo:evaluate
```

The evaluator stops immediately on provider access denial so it does not
overwrite the run with dozens of repeated 403 failures.

## Baseline and blind holdout

- Development set: C01-C30.
- Locked blind holdout: C31-C40.
- Blind protocol separates generation inputs from the scoring rubric and
  records SHA-256 hashes for both.
- Current blind result: system 10/10, fixed-RAG baseline 10/10.
- Win/loss/tie against baseline: 0/0/10.
- Retrieval hit, page citation, numeric coverage and refusal checks: 100%.
- System average latency: 33.97 seconds; baseline: 8.18 seconds.
- System P95 latency: 118.61 seconds.

The baseline tie is intentional and reported without claiming an unsupported
accuracy gain. See `docs/evaluation-metrics.md`.

## Before submission

- Rotate the Bailian key because an older log previously exposed it.
- Confirm `qwen3.8-flash` and `qwen3.8-max` are both available in the selected
  Bailian workspace.
- Retain the final `tests/evaluation/results.json` locally.
- `npm run demo:verify` passes after the final 30/30 evaluation.
- Refresh `npm run demo:lan` after any Windows or WSL restart.
