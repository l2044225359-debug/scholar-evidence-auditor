import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const limit = Number(process.env.EVAL_LIMIT ?? 0);
const kindFilter = process.env.EVAL_KIND;
const idFilter = process.env.EVAL_IDS
  ? new Set(process.env.EVAL_IDS.split(",").map((id) => id.trim()))
  : null;
const providerAccessPattern =
  /AccessDenied\.Unpurchased|Access to model denied/i;
const selected = cases
  .filter((item) => !idFilter || idFilter.has(item.id))
  .filter((item) => !kindFilter || item.kind === kindFilter)
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

async function runChat(item, fileIds) {
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
for (const item of selected) {
  const fileIds = item.fileNames.map((name) => fileByName.get(name));
  if (fileIds.some((id) => !id)) {
    results.push({
      id: item.id,
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
        : await runChat(item, fileIds);
    const elapsedMs = Date.now() - started;
    const answer = output.answer ?? "";
    const citations = output.citations ?? [];
    const keywordGroups =
      item.expectedKeywordGroups ??
      (item.expectedKeywords ?? []).map((keyword) => [keyword]);
    const keywordPass = keywordGroups.every((group) =>
      group.some((keyword) =>
        answer.toLowerCase().includes(keyword.toLowerCase()),
      ),
    );
    const numberPass = (item.expectedNumbers ?? []).every((number) =>
      answer.includes(number),
    );
    const refusalPass = item.expectInsufficient
      ? /不知道|证据不足|无法|insufficient|not enough|cannot|don't know|do not know/i.test(
          answer,
        )
      : true;
    const passed = keywordPass && numberPass && refusalPass;
    results.push({
      id: item.id,
      kind: item.kind,
      category: item.category,
      passed,
      keywordPass,
      numberPass,
      refusalPass,
      retrievalHit: citations.length > 0,
      citationPass: citations.some((citation) => citation.page != null),
      elapsedMs,
      answer: answer.slice(0, 1000),
      citationCount: citations.length,
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${item.id} ${item.category} ${elapsedMs}ms`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    results.push({
      id: item.id,
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
}

const total = results.length;
const rate = (key) =>
  total
    ? results.filter((item) => item[key]).length / total
    : 0;
const summary = {
  total,
  passRate: rate("passed"),
  retrievalHitRate: rate("retrievalHit"),
  citationPassRate: rate("citationPass"),
  numberPassRate: rate("numberPass"),
  refusalPassRate: rate("refusalPass"),
  averageLatencyMs:
    total
      ? results.reduce((sum, item) => sum + (item.elapsedMs ?? 0), 0) / total
      : 0,
};

const output = { summary, results };
writeFileSync(
  resolve(testDir, "evaluation/results.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));

if (
  summary.retrievalHitRate < 0.9 ||
  summary.citationPassRate < 0.9 ||
  summary.refusalPassRate < 0.9 ||
  summary.numberPassRate < 1
) {
  process.exitCode = 1;
}
