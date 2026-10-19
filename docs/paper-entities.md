# Paper entity graph

The local Citation Graph page now includes a heterogeneous paper entity layer:

- `Paper`
- `Author`
- `Topic`
- `Method`
- `Dataset`
- `Metric`
- `Claim`

These entities are inserted into the existing NetworkX graph. A single directed
graph contains:

- paper-to-paper `cites` edges;
- paper-to-author `authored_by` edges;
- paper-to-topic `has_topic` edges;
- paper-to-method `uses_method` edges;
- paper-to-dataset `evaluates_on` edges;
- paper-to-metric `measured_by` edges;
- paper-to-claim `supports_claim` edges.

PageRank and foundational-paper ranking continue to run only on the paper
citation subgraph, so high-degree authors or topics cannot distort the
foundational-paper ordering. Heterogeneous node, relation, component and
density statistics are reported separately.

## Extraction contract

`Paper` and `Author` are derived deterministically from local metadata and
document IDs. `Topic`, `Method`, `Dataset`, `Metric` and `Claim` are extracted
by `qwen3.8-max` from the supplied title, abstract and Future Work passages.

Every extracted relation contains:

- source paper node;
- target entity node;
- relation type;
- supporting evidence text;
- confidence score.

The model is instructed not to invent datasets, metrics or numerical results.
Technical labels remain in canonical English, while Claim labels can be written
in Simplified Chinese when that language is requested.

## Fallback

If model extraction is unavailable:

- Paper and Author remain available from local metadata;
- Claims fall back to sentences from the abstract;
- common Method, Dataset and Metric terms are detected with a controlled
  vocabulary;
- the response records the extraction error instead of returning an empty page.

## API flow

```text
GET /api/citation/local?language=zh
GET /api/citation/local?language=zh&refresh=1
```

The Next.js route reuses the local citation corpus, requests the citation graph
and entity graph, sends entity nodes and relations into the Citation Graph
service, and then returns both in one payload. The private BFF endpoint is:

```text
POST /api/bff/paper-entities
```

Entity extraction is cached for six hours by paper content, language and model.
