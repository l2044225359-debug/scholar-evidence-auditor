import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBlindProtocol,
  caseSplit,
  compareBaseline,
  scoreOutput,
  summarizeResults,
} from "./evaluation/metrics.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const envPath = resolve(repoRoot, "apps/web/.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

const baseUrl = (process.env.KOTAEMON_BFF_URL ?? "http://127.0.0.1:7860")
  .replace(/\/$/, "");
const token = process.env.CHAT_BFF_TOKEN ?? "";
const cases = JSON.parse(
  readFileSync(resolve(testDir, "evaluation/cases.json"), "utf8"),
);
const cliArgs = new Set(process.argv.slice(2));
const limit = Number(process.env.EVAL_LIMIT ?? 0);
const kindFilter = process.env.EVAL_KIND;
const splitFilter =
  process.env.EVAL_SPLIT ?? (cliArgs.has("--blind") ? "blind" : "");
const baselineMode =
  process.env.EVAL_BASELINE ??
  (cliArgs.has("--no-baseline") ? "off" : "blind");
const idFilter = process.env.EVAL_IDS
  ? new Set(process.env.EVAL_IDS.split(",").map((id) => id.trim()))
  : null;
if (!["", "all", "dev", "blind"].includes(splitFilter)) {
  throw new Error("EVAL_SPLIT must be all, dev, blind, or empty");
}
if (!["off", "blind", "all"].includes(baselineMode)) {
  throw new Error("EVAL_BASELINE must be off, blind, or all");
}
const providerAccessPattern =
  /AccessDenied\.Unpurchased|Access to model denied/i;
const selected = cases
  .filter((item) => !idFilter || idFilter.has(item.id))
  .filter((item) => !kindFilter || item.kind === kindFilter)
  .filter(
    (item) =>
      !splitFilter ||
      splitFilter === "all" ||
      caseSplit(item) === splitFilter,
  )
  .slice(0, limit > 0 ? limit : undefined);

const fileResponse = await fetch(`${baseUrl}/api/bff/files`, {
  headers: token ? { "X-BFF-Token": token } : {},
});
if (!fileResponse.ok) throw new Error("Unable to load BFF files");
const filePayload = await fileResponse.json();
const fileByName = new Map(
  filePayload.items.map((file) => [file.name, file.id]),
);

function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const eventLine = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("event:"));
    const dataLine = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    events.push({
      event: eventLine.slice(6).trim(),
      data: JSON.parse(dataLine.slice(5).trim()),
    });
  }
  return events;
}

async function runChat(item, fileIds, agentMode = true) {
  let lastError = "Chat stream failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/bff/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-BFF-Token": token } : {}),
        },
        body: JSON.stringify({
          message: item.question,
          history: [],
          file_ids: fileIds,
          language: "zh",
          citation_mode: "inline",
          model_mode: "auto",
          agent_mode: agentMode,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`);
      }
      const events = parseSse(await response.text());
      const errorEvent = events.find((event) => event.event === "error");
      if (errorEvent) {
        throw new Error(errorEvent.data.message ?? "SSE error event");
      }
      const done = events.find((event) => event.event === "done")?.data;
      const citationEvent = [...events]
        .reverse()
        .find((event) => event.event === "citations")?.data;
      const citations = done?.citations?.length
        ? done.citations
        : citationEvent?.items ?? [];
      if (!done?.answer) {
        throw new Error("Chat stream returned an empty answer");
      }
      if (!citations.length) {
        throw new Error("Chat stream returned no citations");
      }
      return {
        answer: done.answer,
        citations,
        agent: done.agent,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Chat stream failed";
      if (providerAccessPattern.test(lastError)) {
        throw new Error(`PROVIDER_ACCESS_DENIED: ${lastError}`);
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw new Error(lastError);
}

async function runAudit(item, fileIds) {
  let lastError = "Audit failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/bff/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-BFF-Token": token } : {}),
        },
        body: JSON.stringify({
          question: item.question,
          file_ids: fileIds,
          language: "zh",
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report.detail ?? "Audit failed");
      if (!report.answer || !report.citations?.length) {
        throw new Error("Audit returned an empty answer or citations");
      }
      return { answer: report.answer, citations: report.citations, report };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Audit failed";
      if (providerAccessPattern.test(lastError)) {
        throw new Error(`PROVIDER_ACCESS_DENIED: ${lastError}`);
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw new Error(lastError);
}

const results = [];
const baselineResults = [];
let stopEvaluation = false;
const shouldRunBaseline = (item) =>
  baselineMode === "all" ||
  (baselineMode === "blind" && caseSplit(item) === "blind");

for (const item of selected) {
  const fileIds = item.fileNames.map((name) => fileByName.get(name));
  if (fileIds.some((id) => !id)) {
    results.push({
      id: item.id,
      split: caseSplit(item),
      kind: item.kind,
      category: item.category,
      passed: false,
      error: `Missing files: ${item.fileNames.join(", ")}`,
    });
    continue;
  }

  const started = Date.now();
  try {
    const output =
      item.kind === "audit"
        ? await runAudit(item, fileIds)
        : await runChat(item, fileIds, true);
    const elapsedMs = Date.now() - started;
    const scored = scoreOutput(item, output);
    results.push({
      id: item.id,
      split: caseSplit(item),
      kind: item.kind,
      category: item.category,
      ...scored,
      elapsedMs,
      answer: String(output.answer ?? "").slice(0, 1000),
      agent: output.agent ?? undefined,
    });
    console.log(
      `${scored.passed ? "PASS" : "FAIL"} ${item.id} ${item.category} ${elapsedMs}ms`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    results.push({
      id: item.id,
      split: caseSplit(item),
      kind: item.kind,
      category: item.category,
      passed: false,
      error: message,
      elapsedMs: Date.now() - started,
    });
    console.error(`FAIL ${item.id} ${message}`);
    if (message.startsWith("PROVIDER_ACCESS_DENIED:")) {
      console.error(
        "Provider access was denied; stopping evaluation to avoid repeated 403s.",
      );
      break;
    }
  }

  if (!shouldRunBaseline(item)) continue;

  const baselineStarted = Date.now();
  try {
    const baselineOutput =
      item.kind === "audit"
        ? await runAudit(item, fileIds)
        : await runChat(item, fileIds, false);
    const elapsedMs = Date.now() - baselineStarted;
    const scored = scoreOutput(item, baselineOutput);
    baselineResults.push({
      id: item.id,
      split: caseSplit(item),
      kind: item.kind,
      category: item.category,
      mode: "fixed-rag-no-agent",
      ...scored,
      elapsedMs,
      answer: String(baselineOutput.answer ?? "").slice(0, 1000),
      agent: baselineOutput.agent ?? undefined,
    });
    console.log(
      `${scored.passed ? "BASE PASS" : "BASE FAIL"} ${item.id} ${elapsedMs}ms`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Baseline failed";
    baselineResults.push({
      id: item.id,
      split: caseSplit(item),
      kind: item.kind,
      category: item.category,
      mode: "fixed-rag-no-agent",
      passed: false,
      error: message,
      elapsedMs: Date.now() - baselineStarted,
    });
    console.error(`BASE FAIL ${item.id} ${message}`);
    if (message.startsWith("PROVIDER_ACCESS_DENIED:")) {
      console.error(
        "Provider access was denied; stopping evaluation to avoid repeated 403s.",
      );
      stopEvaluation = true;
    }
  }
  if (stopEvaluation) break;
}

const summary = summarizeResults(results);
const blindResults = results.filter(
  (item) => caseSplit(item) === "blind",
);
const developmentResults = results.filter(
  (item) => caseSplit(item) === "dev",
);
const blindSummary = summarizeResults(blindResults);
const baselineSystemResults =
  baselineMode === "all" ? results : blindResults;
const baselineComparison = compareBaseline(
  baselineSystemResults,
  baselineResults,
);
const retrievalOnlyBaseline = {
  name: "retrieval-only-evidence",
  description:
    "No answer-quality claim; measures whether the blind query retrieved page-grounded evidence.",
  evaluated: blindResults.length,
  retrievalHitRate: blindSummary.retrievalHitRate,
  citationPassRate: blindSummary.citationPassRate,
};

summary.blind = {
  ...blindSummary,
  baselinePassRate: baselineComparison.baselinePassRate,
  baselinePassRateGain: baselineComparison.absolutePassRateGain,
};
summary.development = developmentResults.length
  ? summarizeResults(developmentResults)
  : undefined;
summary.baselines = {
  fixedRag: baselineComparison,
  retrievalOnly: retrievalOnlyBaseline,
};

const protocol = buildBlindProtocol(cases);
protocol.executedCaseCount = blindResults.length;
protocol.baselineMode = baselineMode;

const output = {
  protocol,
  summary,
  results,
  baselineResults,
};
writeFileSync(
  resolve(testDir, "evaluation/results.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));

const minBlindPassRate = Number(
  process.env.EVAL_MIN_BLIND_PASS_RATE ?? 0.8,
);
if (
  summary.retrievalHitRate < 0.9 ||
  summary.citationPassRate < 0.9 ||
  summary.refusalPassRate < 0.9 ||
  summary.numberPassRate < 1 ||
  (blindSummary.total > 0 &&
    blindSummary.passRate < minBlindPassRate)
) {
  process.exitCode = 1;
}
