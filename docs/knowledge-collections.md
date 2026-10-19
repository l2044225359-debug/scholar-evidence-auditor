# Knowledge collections

The research workspace exposes three curated retrieval scopes:

- **Transformer**: attention, encoder-decoder and Transformer architecture papers.
- **RAG**: retrieval, dense passage retrieval, reranking and context-use papers.
- **Agent**: reasoning, planning, tool-use and agentic retrieval papers.

Collections are generated from the current indexed document list by the
authenticated `/api/collections` route. The response contains real Kotaemon
`file_ids`; the browser never fabricates document identifiers.

## Retrieval contract

1. The user selects a collection in the workspace document rail.
2. The collection resolves to its `file_ids`.
3. Chat sends those IDs through the existing `file_ids` field.
4. The Kotaemon BFF applies the existing selected-file retrieval scope.

Manual document selection clears the active collection and creates a custom
scope. Selecting all documents also clears the active collection.

Collections intentionally overlap when appropriate. For example, Self-RAG is a
retrieval paper and also demonstrates agentic retrieval.

## API

```text
GET /api/collections?language=zh
GET /api/collections?language=en
```

The route requires an authenticated session and returns:

```json
{
  "items": [
    {
      "id": "transformer",
      "name": "Transformer",
      "description": "Attention, encoder-decoder design and Transformer architecture",
      "file_ids": ["..."],
      "document_count": 2
    }
  ]
}
```
