import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBlindProtocol,
  compareBaseline,
  normalizeNumericText,
  scoreOutput,
  summarizeResults,
} from "./evaluation/metrics.mjs";

test("numeric scoring ignores thousands separators and whitespace", () => {
  assert.equal(normalizeNumericText("100,000 steps"), "100000steps");
  const scored = scoreOutput(
    {
      expectedKeywordGroups: [["训练", "training"]],
      expectedNumbers: ["100000"],
    },
    {
      answer: "模型训练了 100,000 步。",
      citations: [{ page: 8 }],
    },
  );
  assert.equal(scored.passed, true);
  assert.equal(scored.numericCoverage, 1);
});

test("keyword groups and citations are scored independently", () => {
  const scored = scoreOutput(
    {
      expectedKeywordGroups: [["encoder", "编码器"], ["decoder", "解码器"]],
      expectedNumbers: [],
      expectInsufficient: false,
    },
    {
      answer: "模型包含编码器和 decoder。",
      citations: [{ page: 2 }],
    },
  );
  assert.equal(scored.keywordPass, true);
  assert.equal(scored.citationPass, true);
  assert.equal(scored.passed, true);
});

test("blind protocol hashes public questions separately from rubric", () => {
  const protocol = buildBlindProtocol([
    {
      id: "D01",
      question: "dev question",
      expectedNumbers: ["1"],
    },
    {
      id: "B01",
      split: "blind",
      kind: "chat",
      category: "numeric",
      question: "blind question",
      fileNames: ["paper.pdf"],
      expectedKeywordGroups: [["paper"]],
      expectedNumbers: ["2"],
    },
  ]);
  assert.equal(protocol.total, 1);
  assert.deepEqual(protocol.caseIds, ["B01"]);
  assert.match(protocol.questionSetSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(
    protocol.questionSetSha256,
    protocol.rubricSha256,
  );
});

test("baseline comparison reports wins, losses and latency delta", () => {
  const comparison = compareBaseline(
    [
      { id: "B01", passed: true, citationPass: true, elapsedMs: 120 },
      { id: "B02", passed: false, citationPass: true, elapsedMs: 100 },
    ],
    [
      { id: "B01", passed: false, citationPass: true, elapsedMs: 80 },
      { id: "B02", passed: true, citationPass: false, elapsedMs: 90 },
    ],
  );
  assert.equal(comparison.evaluated, 2);
  assert.equal(comparison.absolutePassRateGain, 0);
  assert.equal(comparison.wins, 1);
  assert.equal(comparison.losses, 1);
  assert.equal(comparison.averageLatencyDeltaMs, 25);
});

test("summary includes category and percentile metrics", () => {
  const summary = summarizeResults([
    {
      passed: true,
      retrievalHit: true,
      citationPass: true,
      numberPass: true,
      refusalPass: true,
      keywordCoverage: 1,
      numericCoverage: 1,
      category: "numeric",
      elapsedMs: 100,
    },
    {
      passed: false,
      retrievalHit: false,
      citationPass: false,
      numberPass: false,
      refusalPass: true,
      keywordCoverage: 0.5,
      numericCoverage: 0,
      category: "numeric",
      elapsedMs: 300,
    },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.p95LatencyMs, 300);
  assert.equal(summary.categories.numeric.passRate, 0.5);
});
