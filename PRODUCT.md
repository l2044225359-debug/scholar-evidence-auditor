# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is competition examiners evaluating the project under time
pressure using the AI large-model innovation challenge rubric. They need to
understand the product, exercise the key workflows, and recognize the technical
depth quickly. Secondary users are students and researchers demonstrating
document Q&A, source tracing, citation exploration, and evidence audits.

## Product Purpose

Scholar is an evidence-first academic research workspace. It turns local PDF
collections into cited answers, page-level evidence, citation graphs, and
auditable research reports. Success means an examiner can complete the core
workflow without explanation, see why the answer is trustworthy, and understand
the project's AI depth within a short demonstration.

## Positioning

The product closes the loop from document ingestion and hybrid retrieval to
cited synthesis, citation-network exploration, numeric verification, and a
printable audit report. It is not a generic chat wrapper: every material claim
is designed to remain connected to a source document, page, retrieval score,
and verification outcome.

## Operating Context

- The project is demonstrated locally or over a trusted LAN.
- The current demo library contains seven research papers, including a scanned
  PDF.
- Examiners receive dedicated demo accounts and can test from a browser.
- The main evaluation flow is login, workspace Q&A, PDF evidence preview,
  Citation Graph, Evidence Audit, and System Status.
- The application supports Chinese and English interface modes.
- The final evaluation suite currently reports 30/30 passing cases.

## Capabilities and Constraints

- PDF document library with Docling parsing and scanned-page OCR fallback.
- Batch PDF upload with content-based version detection, arXiv identity matching,
  and side-by-side revision evidence before replacing an indexed paper.
- Hybrid retrieval, Qwen embedding, and Qwen reranking with source scores.
- Streaming Chinese/English answers with inline citations and page evidence.
- Optional English answer narration through VibeVoice Realtime, exposed only
  through the authenticated same-origin BFF.
- PDF preview through the authenticated same-origin proxy.
- Local PDF.js reading workspace with an outline, citation-to-References
  navigation and synchronized bilingual page translation.
- Agent Trace panel covering planning, retrieval, model synthesis and measured
  tool steps.
- Real arXiv download/ingestion and CSV analysis tools using pandas,
  Matplotlib, Qwen-generated academic captions and reproducible Mermaid/TikZ
  chart scripts.
- Evidence-grounded paper framework generation with restricted `[R#]`
  citations, verified References and BibTeX export.
- Citation Graph powered by OpenAlex, Crossref, and NetworkX.
- Local 20-paper citation graph with PageRank foundational-paper ranking and
  Future Work synthesis grounded in extracted local passages.
- Evidence audit with claim extraction, page anchors, numeric checks,
  contradiction detection, JSON export, and printable reports.
- Automatic and explicit model routing between Qwen Flash and Qwen Max.
- Administrator surfaces for uploads, indexing jobs, users, invites, and demo
  operations.
- System status for Next.js, Kotaemon, Citation Graph, VibeVoice, and the
  indexing worker.
- VibeVoice Realtime is English-focused. Chinese UI mode intentionally omits
  the narration control rather than emitting unreliable speech.
- Existing functionality, wording, authentication, API contracts, and the
  Chinese/English modes must be preserved.
- Useful additions are allowed, but they must support the real research
  workflow or improve examiner comprehension; invented claims and decorative
  product features are not allowed.

## Brand Commitments

- Preserve the product name `Scholar` and its academic research workspace role.
- Preserve the existing functional vocabulary and bilingual behavior.
- The visual result should feel credible to an academic audience while creating
  a strong, memorable competition-demo impression.
- The interface must communicate more evident technical depth than a generic
  administrative dashboard.

## Evidence on Hand

- Seven indexed sample papers: Transformer, RAG, DPR, ReAct, Self-RAG, Lost in
  the Middle, and a scanned Transformer copy.
- A 30-case evaluation covering retrieval, citations, numeric verification,
  OCR, refusal, and contradiction handling.
- Verified Chinese cited answers and cross-paper synthesis.
- Citation Graph and Evidence Audit are real working services, not mockups.
- Runtime and evaluation evidence exist under `docs/`, `tests/evaluation/`, and
  `outputs/`.

## Product Principles

1. Evidence before assertion: answers must make provenance and verification easy
   to inspect.
2. Demo legibility: the core technical advantage should be visible without a
   guided explanation.
3. Research-grade calm: dense information should remain scannable, predictable,
   and trustworthy.
4. Depth on demand: reveal model, retrieval, graph, and audit details without
   overwhelming the primary task.
5. Every interaction should close a real research loop.

## Accessibility & Inclusion

- Maintain keyboard access, visible focus states, readable contrast, and
  responsive layouts.
- Do not rely on color alone for selection, status, errors, or evidence
  confidence.
- Chinese and English text must remain usable without clipping or layout
  breakage.
