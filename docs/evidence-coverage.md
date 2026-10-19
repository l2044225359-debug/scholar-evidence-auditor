# Evidence coverage

Every completed chat answer now includes an evidence-coverage assessment. The
metric estimates whether the current retrieval scope contains enough grounded
evidence to support the answer. It does not claim that the answer is factually
correct.

## Inputs

- number of retrieved evidence items;
- unique documents represented by the evidence;
- number of page-grounded citations;
- answer citation markers and how many have matching evidence;
- numbers in the answer that can be found in the cited evidence;
- number of documents in the selected collection or manual scope.

## Score

The 0-100 score is deterministic:

- 30 points: evidence volume;
- 25 points: page grounding;
- 20 points: citation alignment;
- 15 points: selected-scope document coverage;
- 10 points: numeric evidence matching.

Levels:

- `sufficient`: score at least 80, page grounding at least 75%, and at least two
  evidence items;
- `partial`: score at least 50 with at least one evidence item;
- `insufficient`: weak evidence, missing page anchors, or no citations.

The SSE `done` payload returns `evidence_coverage` with the score, level,
bilingual explanation and underlying metrics. Evidence Audit reports include
the same object.

## UI

The chat workspace displays the coverage score, level, evidence count, document
coverage, page-grounding rate and citation-alignment rate after an answer
completes. Switching collections or manually changing the document scope clears
the previous coverage result.
