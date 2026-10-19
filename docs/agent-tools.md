# Agent Trace and tools

The research workspace exposes a collapsible Agent panel with three views:

- `Trace`: live planning, retrieval, model and tool steps.
- `arXiv`: download and ingestion.
- `CSV`: pandas analysis, Matplotlib rendering and academic captioning.
- `Writing`: evidence-grounded paper framework and References generation.

## Trace events

Chat streaming emits structured trace events through the authenticated BFF:

- task plan and model route;
- hybrid retrieval state;
- evidence synthesis state;
- completion or failure with citation count.

Tool calls append measured sub-steps and durations. Trace state stays in the
current browser session and can be cleared without affecting documents or
conversations.

## arXiv tool

`POST /api/tools/arxiv`

The tool only accepts a parsed arXiv identifier. It:

1. fetches arXiv Atom metadata;
2. downloads the PDF from `arxiv.org`;
3. validates the PDF signature;
4. extracts arXiv identity, version and page count;
5. compares content against the current library;
6. indexes the paper only when it is not already present.

The tool does not accept arbitrary URLs, preventing it from becoming a generic
server-side download proxy.

## CSV tool

`POST /api/tools/csv`

Limits:

- CSV only;
- maximum 10 MB;
- authenticated users only;
- per-user rate limiting.

The backend uses pandas for column profiling, missing values, descriptive
statistics and grouped values. Matplotlib generates a chart for the most
relevant categorical/numeric columns. `qwen3.8-flash` writes a grounded caption
from the computed result, with a deterministic fallback if the model is
unavailable.

The same computed plot points are converted into reproducible code:

- Mermaid `xychart-beta` with matching labels, axis ranges and series data;
- TikZ/PGFPlots `axis`, `addplot` coordinates and chart options such as bars,
  lines or scatter marks.

Both scripts are shown inside the Agent panel and can be copied directly into a
Markdown/Mermaid renderer or an Overleaf LaTeX project.

## Writing tool

`POST /api/tools/writing`

The writing tool uses either selected library papers or all indexed papers. It:

1. extracts local title, abstract and arXiv identity;
2. enriches author, year and DOI metadata through the local
   OpenAlex/Crossref service;
3. assigns restricted citation markers `[R1]`, `[R2]`, and so on;
4. asks `qwen3.8-max` for an Abstract-to-Conclusion paper framework;
5. removes any citation marker not present in the verified candidate list;
6. appends a deterministic References section and BibTeX entries.

The UI supports copying the Markdown framework, formatted References and
BibTeX independently.
