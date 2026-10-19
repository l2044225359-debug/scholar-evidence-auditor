# Evidence audit

## Pipeline

1. Run hybrid retrieval and generate a cited answer through Kotaemon.
2. Extract atomic claims with `qwen3.8-flash`.
3. Map citation markers to page-level evidence blocks.
4. Verify every number deterministically against the evidence page.
5. Verify non-numeric semantics with Flash for one document or Max for
   multi-document scope.
6. Produce supported, contradicted or insufficient verdicts.

## Citation integrity

Citation completeness is checked independently from model judgment. Invalid or
out-of-range citation markers are rejected and inferred again from the selected
evidence when possible.

## Report

Every audit stores:

- question and answer
- structured citations
- claims and verdicts
- page evidence
- numeric checks
- citation integrity rate
- models used
- generated time
- evidence coverage score and level

Reports are available as JSON through `/api/audits/{id}` and as printable HTML
through `/api/audits/{id}/report`.

## Execution

Audits are queued as `audit` jobs and use the same single-instance worker as PDF
indexing, preventing heavy indexing and auditing from running concurrently.
