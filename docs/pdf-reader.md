# PDF.js academic reader

The reader is available at:

```text
/reader?path=<authenticated preview path>&page=<page number>
```

Citation evidence links from the research workspace open this page directly at
the cited page.

## Rendering

- PDF.js renders pages to canvas inside the authenticated Next.js application.
- The worker is served locally from `/pdf.worker.min.mjs`; no CDN is required.
- Pages are rendered lazily with `IntersectionObserver`.
- Zoom and horizontal overflow preserve the original page geometry.

## Title tree

The reader first uses the PDF's embedded outline. If no outline exists, it
groups text items by baseline, estimates the dominant body font size, and
promotes larger or bold lines into a three-level heading tree.

## Citation and References navigation

- Numeric bracket citations such as `[12]` and `[9, 11]` are extracted from
  the body pages.
- Numbered References entries are parsed from the `References` or
  `Bibliography` section.
- Citation markers in the translated text are clickable and open the matching
  References entry.
- Each References entry lists the pages where it is cited; selecting a page
  scrolls both reading columns back to that occurrence.

## Bilingual reading

- Page text is translated on demand through the authenticated
  `/api/translate` BFF.
- The translation service uses `qwen3.8-flash`.
- Prompts preserve numeric citation markers, equations, URLs and metadata.
- Translation results are cached by source text and target language.
- The original PDF and translated text use normalized scroll ratios, so moving
  either pane keeps the other pane at the same relative document position.

## MVP limits

- Numeric bracket citations are supported first; author-year citations are not
  yet linked.
- Translation operates on extracted text. Original PDF layout remains in the
  left canvas, while the translation is presented as aligned page text rather
  than a reconstructed designed PDF.
- Scanned pages without a text layer require Docling/Qwen OCR during ingestion;
  the reader itself does not rerun OCR.
