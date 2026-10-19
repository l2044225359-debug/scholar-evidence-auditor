import { existsSync, readFileSync } from "node:fs";
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

function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"));
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"));
      if (!event || !data) return null;
      return {
        event: event.slice(6).trim(),
        data: JSON.parse(data.slice(5).trim()),
      };
    })
    .filter(Boolean);
}

async function streamChat(body) {
  const response = await fetch(`${baseUrl}/api/bff/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-BFF-Token": token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`SSE HTTP ${response.status}`);
  }
  return parseSse(await response.text());
}

const events = await streamChat({
  message: "只回复 OK",
  history: [],
  file_ids: null,
  language: "zh",
  citation_mode: "off",
  model_mode: "fast",
});
for (const eventName of ["meta", "status", "done"]) {
  if (!events.some((event) => event.event === eventName)) {
    throw new Error(`Missing SSE event: ${eventName}`);
  }
}
if (!events.some((event) => ["delta", "replace"].includes(event.event))) {
  throw new Error("Missing streamed answer events");
}

const fileResponse = await fetch(`${baseUrl}/api/bff/files`, {
  headers: token ? { "X-BFF-Token": token } : {},
});
if (!fileResponse.ok) {
  throw new Error(`Files HTTP ${fileResponse.status}`);
}
const files = await fileResponse.json();
const attention = files.items.find((file) => file.name === "attention.pdf");
if (!attention) {
  throw new Error("SSE RAG test requires attention.pdf");
}

const ragEvents = await streamChat({
  message: "Transformer 是否完全基于注意力机制？",
  history: [],
  file_ids: [attention.id],
  language: "zh",
  citation_mode: "inline",
  model_mode: "fast",
});
const errorEvent = ragEvents.find((event) => event.event === "error");
if (errorEvent) {
  throw new Error(`RAG stream failed: ${errorEvent.data.message}`);
}
const done = ragEvents.find((event) => event.event === "done");
if (!done?.data.answer) {
  throw new Error("RAG stream did not return an answer");
}
if (!done.data.citations?.length) {
  throw new Error("RAG stream did not return citations");
}
if (!done.data.citations.some((citation) => citation.preview_url)) {
  throw new Error("RAG stream did not return a PDF preview URL");
}

console.log("SSE and RAG smoke tests passed.");
