# Document ingestion

## Upload

- Administrator-only PDF upload.
- Maximum file size: 100 MB.
- File signature and extension are validated in Next.js and Kotaemon.
- Original file names are retained in the shared document library.

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
