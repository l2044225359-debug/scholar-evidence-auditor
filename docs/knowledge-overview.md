# 知识库总览

The document library opens with a compact knowledge-base overview. Every value
is derived from the live local index rather than static demo data.

## Metrics

- **Documents**: registered PDF source records.
- **Pages**: total pages opened from the stored PDFs with PyMuPDF.
- **Chunks**: `Index` rows whose relation is `vector`, representing searchable
  embeddings.
- **OCR pages**: pages with fewer than 80 extractable PDF characters that have a
  recovered indexed text chunk of at least 40 characters.
- **Citation edges**: unique local paper-to-paper reference matches among up to
  20 indexed papers.
- **Index health**: a 0-100 score reduced by missing source files,
  document/vector chunk mismatches, unrecovered low-text pages, citation
  extraction errors, and recent failed jobs.

## API

```text
GET /api/knowledge-overview
GET /api/knowledge-overview?refresh=1
```

The Next.js route requires an authenticated session, calls the private Kotaemon
BFF, and adds queue state from the local SQLite worker database. The BFF caches
expensive PDF and citation inspection for 30 seconds; `refresh=1` forces a new
calculation while retaining per-file page profiles by file size and mtime.

## Health states

- `healthy`: score 90-100.
- `indexing`: active queue work and score at least 65.
- `attention`: score 65-89.
- `degraded`: score below 65.
- `empty`: no documents are registered.

The overview intentionally reports recovered pages rather than claiming that
OCR was invoked when a low-text page could not be recovered.
