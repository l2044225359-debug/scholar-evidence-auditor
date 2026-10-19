# Paper entity graph

The local Citation Graph page now includes a heterogeneous paper entity layer:

- `Paper`
- `Author`
- `Topic`
- `Method`
- `Dataset`
- `Metric`
- `Claim`

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
and entity graph in parallel, and then returns both in one payload. The private
BFF endpoint is:

```text
POST /api/bff/paper-entities
```

Entity extraction is cached for six hours by paper content, language and model.
