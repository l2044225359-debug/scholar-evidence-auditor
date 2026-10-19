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

The local view renders the graph as an interactive SVG. Selecting a node reveals
its metadata and highlights related citation edges.

The page also displays a heterogeneous Paper / Author / Topic / Method /
Dataset / Metric / Claim entity graph. Selecting a paper shows its extracted
entities in the inspector. See `docs/paper-entities.md`.

The Citation Graph service inserts those entities into one NetworkX directed
graph with the citation edges. Paper PageRank remains scoped to the citation
subgraph, while the page separately reports total heterogeneous nodes,
relations, components and density.

## Future Work synthesis

Extracted Future Work passages are sent to `qwen3.8-max`. The synthesis:

- merges repeated directions;
- links each direction to supporting local papers;
- distinguishes incremental extensions from larger research opportunities;
- proposes concrete next experiments;
- ends with a prioritized research agenda.

If the model is unavailable, the API returns a deterministic
paper-by-paper fallback rather than fabricating directions.
