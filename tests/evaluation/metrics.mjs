import { createHash } from "node:crypto";

export function caseSplit(item) {
  return item.split === "blind" ? "blind" : "dev";
}

export function normalizeNumericText(value) {
  return String(value ?? "")
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function scoreOutput(item, output) {
  const answer = String(output.answer ?? "");
  const citations = Array.isArray(output.citations)
    ? output.citations
    : [];
  const keywordGroups =
    item.expectedKeywordGroups ??
    (item.expectedKeywords ?? []).map((keyword) => [keyword]);
  const keywordMatches = keywordGroups.map((group) =>
    group.some((keyword) =>
      answer.toLowerCase().includes(String(keyword).toLowerCase()),
    ),
  );
  const expectedNumbers = item.expectedNumbers ?? [];
  const normalizedAnswer = normalizeNumericText(answer);
  const numberMatches = expectedNumbers.map((number) =>
    normalizedAnswer.includes(normalizeNumericText(number)),
  );
  const refusalPass = item.expectInsufficient
    ? /不知道|证据不足|无法|insufficient|not enough|cannot|don't know|do not know/i.test(
        answer,
      )
    : true;
  const keywordPass =
    keywordMatches.length === 0 || keywordMatches.every(Boolean);
  const numberPass =
    numberMatches.length === 0 || numberMatches.every(Boolean);
  const pageGrounded = citations.filter(
    (citation) => citation.page != null,
  ).length;

  return {
    passed: keywordPass && numberPass && refusalPass,
    keywordPass,
    numberPass,
    refusalPass,
    keywordCoverage: keywordMatches.length
      ? keywordMatches.filter(Boolean).length / keywordMatches.length
      : 1,
    numericCoverage: numberMatches.length
      ? numberMatches.filter(Boolean).length / numberMatches.length
      : 1,
    retrievalHit: citations.length > 0,
    citationPass: pageGrounded > 0,
    citationCount: citations.length,
    pageGroundedCount: pageGrounded,
    answerLength: answer.length,
  };
}

export function rate(results, key) {
  return results.length
    ? results.filter((item) => Boolean(item[key])).length / results.length
    : 0;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * ratio) - 1),
  );
  return ordered[index];
}

function averageMetric(results, key) {
  return results.length
    ? results.reduce(
        (sum, item) => sum + Number(item[key] ?? 0),
        0,
      ) / results.length
    : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function summarizeResults(results) {
  const latencies = results.map((item) => Number(item.elapsedMs ?? 0));
  return {
    total: results.length,
    passRate: rate(results, "passed"),
    retrievalHitRate: rate(results, "retrievalHit"),
    citationPassRate: rate(results, "citationPass"),
    numberPassRate: rate(results, "numberPass"),
    refusalPassRate: rate(results, "refusalPass"),
    keywordCoverage: averageMetric(results, "keywordCoverage"),
    numericCoverage: averageMetric(results, "numericCoverage"),
    averageLatencyMs: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0,
    p95LatencyMs: percentile(latencies, 0.95),
    categories: Object.fromEntries(
      [...new Set(results.map((item) => item.category))]
        .sort()
        .map((category) => {
          const subset = results.filter(
            (item) => item.category === category,
          );
          return [
            category,
            {
              total: subset.length,
              passRate: rate(subset, "passed"),
            },
          ];
        }),
    ),
  };
}

export function compareBaseline(systemResults, baselineResults) {
  const baselineById = new Map(
    baselineResults.map((item) => [item.id, item]),
  );
  const pairs = systemResults
    .map((system) => ({
      system,
      baseline: baselineById.get(system.id),
    }))
    .filter((pair) => pair.baseline);
  const systemPassRate = rate(
    pairs.map((pair) => pair.system),
    "passed",
  );
  const baselinePassRate = rate(
    pairs.map((pair) => pair.baseline),
    "passed",
  );
  const wins = pairs.filter(
    ({ system, baseline }) => system.passed && !baseline.passed,
  ).length;
  const losses = pairs.filter(
    ({ system, baseline }) => !system.passed && baseline.passed,
  ).length;
  const systemLatency = pairs.length
    ? pairs.reduce(
        (sum, pair) => sum + Number(pair.system.elapsedMs ?? 0),
        0,
      ) / pairs.length
    : 0;
  const baselineLatency = pairs.length
    ? pairs.reduce(
        (sum, pair) => sum + Number(pair.baseline.elapsedMs ?? 0),
        0,
      ) / pairs.length
    : 0;

  return {
    name: "fixed-rag-no-agent",
    description:
      "Same hybrid retrieval and citations, with dynamic planning disabled.",
    evaluated: pairs.length,
    systemPassRate,
    baselinePassRate,
    absolutePassRateGain: round(systemPassRate - baselinePassRate),
    relativePassRateGain:
      baselinePassRate > 0
        ? round((systemPassRate - baselinePassRate) / baselinePassRate)
        : null,
    wins,
    losses,
    ties: pairs.length - wins - losses,
    systemCitationPassRate: rate(
      pairs.map((pair) => pair.system),
      "citationPass",
    ),
    baselineCitationPassRate: rate(
      pairs.map((pair) => pair.baseline),
      "citationPass",
    ),
    systemAverageLatencyMs: round(systemLatency, 1),
    baselineAverageLatencyMs: round(baselineLatency, 1),
    averageLatencyDeltaMs: round(systemLatency - baselineLatency, 1),
  };
}

export function buildBlindProtocol(cases) {
  const blindCases = cases.filter((item) => caseSplit(item) === "blind");
  const publicPayload = blindCases.map((item) => ({
    id: item.id,
    kind: item.kind,
    category: item.category,
    question: item.question,
    fileNames: item.fileNames,
  }));
  const rubricPayload = blindCases.map((item) => ({
    id: item.id,
    expectedKeywordGroups:
      item.expectedKeywordGroups ??
      (item.expectedKeywords ?? []).map((keyword) => [keyword]),
    expectedNumbers: item.expectedNumbers ?? [],
    expectInsufficient: Boolean(item.expectInsufficient),
  }));
  const hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");

  return {
    protocol: "blind-v1",
    description:
      "Answers are generated from question/file scope only; rubric fields are applied after generation.",
    total: blindCases.length,
    caseIds: blindCases.map((item) => item.id),
    publicFields: [
      "id",
      "kind",
      "category",
      "question",
      "fileNames",
    ],
    rubricFields: [
      "expectedKeywordGroups",
      "expectedNumbers",
      "expectInsufficient",
    ],
    questionSetSha256: hash(publicPayload),
    rubricSha256: hash(rubricPayload),
  };
}
