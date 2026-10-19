# Document ingestion

## Upload

- Administrator-only batch PDF upload.
- Maximum file size: 100 MB.
- File signature and extension are validated in Next.js and Kotaemon.
- Original file names are retained in the shared document library.

## Semantic version deduplication

Before a PDF enters the index queue, Kotaemon extracts its title, first-page
text, arXiv identity and version number. It compares those values against the
PDFs already stored in the shared library.

Detection uses, in order:

1. identical SHA-256 content;
2. the same normalized arXiv paper ID, such as `1706.03762`;
3. high-overlap body-text shingles;
4. title and abstract similarity.

For a likely duplicate, the upload API returns HTTP `409` with the existing
document, incoming/current versions, changed-text ratio and representative
added/removed passages. The administrator can:

- keep the indexed version;
- replace it with the incoming file;
- keep both files;
- cancel the remaining files in the batch.

The comparison is content-based rather than filename-based, so
`1706.03762v1.pdf` and `1706.03762v7.pdf` are recognized as versions of the same
paper.

## Queue

Uploads create an `index_pdf` row in SQLite. The Next.js worker claims one job at
a time using an immediate transaction.

The worker lock file prevents more than one indexing process:

```text
work/index-worker.lock
```

Job states:

- `queued`
- `running`
- `completed`
- `failed`

Failed jobs can be retried. The uploaded local PDF is removed after successful
indexing.

## Parsing

The worker sends the PDF to:

```text
POST /api/bff/index
```

Kotaemon uses:

- Docling for layout, text, tables and figures
- `qwen3.5-ocr` for scanned or low-text pages
- `qwen3.7-text-embedding` for vectors
- `qwen3-rerank` for retrieval reranking

## Administration

The document library provides:

- upload controls
- queue progress
- parser and token status
- retry for failed jobs
- administrator document deletion
