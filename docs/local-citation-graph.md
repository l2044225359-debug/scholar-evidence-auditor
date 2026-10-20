# Local 20-paper citation graph

The Citation Graph page defaults to a local-corpus view and retains the
OpenAlex explorer as a second tab.

## Corpus construction

The backend reads up to 20 indexed PDFs from the local library. For each paper:

1. resolve title, authors and year from arXiv Atom, OpenAlex or Crossref;
2. extract the References section from the PDF tail;
3. detect Future Work, Future Directions and Future Research passages;
4. match local references by arXiv ID or normalized paper title.

Matched pairs become directed citation edges. Self edges are discarded.

## Graph analytics

The Citation Graph service builds a directed NetworkX graph and reports:

- PageRank;
- in-degree and out-degree;
- degree centrality;
- graph density and weakly connected components;
- foundational papers ranked by PageRank;
- recent frontier candidates for horizon scanning.

The local view offers two coordinated modes:

- `2D citations`: the original quick-scan SVG citation view;
- `3D entities`: an on-demand Three.js heterogeneous graph with citation and
  entity edges.

Selecting a node reveals its metadata and highlights related citation edges.

The page also displays a heterogeneous Paper / Author / Topic / Method /
Dataset / Metric / Claim entity graph. Selecting a paper shows its extracted
entities in the inspector. See `docs/paper-entities.md`.

The Citation Graph service inserts those entities into one NetworkX directed
graph with the citation edges. Paper PageRank remains scoped to the citation
subgraph, while the page separately reports total heterogeneous nodes,
relations, components and density.

The desktop inspector uses an independent vertical scroll area. Foundational
paper titles wrap instead of being truncated, and paper details plus entity
chips remain reachable without moving the graph or page body.

## 3D entity graph

The 3D canvas is loaded only after the examiner selects `3D entities`, keeping
the initial workspace free of the Three.js bundle. It uses distinct geometry and
color for Paper, Author, Topic, Method, Dataset, Metric and Claim nodes.

- Drag rotates and zooms the camera; wheel zooms.
- Clicking an entity reveals its related papers, relation names and grounded
  evidence.
- Entity-type filters rebuild the visible graph without discarding the current
  paper selection.
- `Fit` excludes isolated nodes so one disconnected component cannot shrink the
  main graph into a corner.
- Slow auto-rotation starts with the 3D view and can be paused; it is disabled
  automatically under `prefers-reduced-motion`.
- The graph uses a white research-paper field, light citation edges, small
  blue/green entity nodes, paper labels, and a compact live HUD.
- The 2D view remains available for screenshots, keyboard usage and lower-end
  clients.

## Future Work synthesis

Extracted Future Work passages are sent to `qwen3.8-max`. The synthesis:

- merges repeated directions;
- links each direction to supporting local papers;
- distinguishes incremental extensions from larger research opportunities;
- proposes concrete next experiments;
- ends with a prioritized research agenda.

If the model is unavailable, the API returns a deterministic
paper-by-paper fallback rather than fabricating directions.
