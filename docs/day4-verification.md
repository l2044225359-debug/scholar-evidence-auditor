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

## Before submission

- Rotate the Bailian key because an older log previously exposed it.
- Confirm `qwen3.8-flash` and `qwen3.8-max` are both available in the selected
  Bailian workspace.
- Retain the final `tests/evaluation/results.json` locally.
- `npm run demo:verify` passes after the final 30/30 evaluation.
- Refresh `npm run demo:lan` after any Windows or WSL restart.
