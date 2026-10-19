import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
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
const headers = token ? { "X-BFF-Token": token } : {};
const pdfDir =
  process.env.DEMO_PDF_DIR ??
  (process.platform === "win32"
    ? "C:\\Users\\lenovo\\Documents\\Codex\\2026-10-17\\https-www-boxuegu-com-matchtrack-detail\\work"
    : "/mnt/c/Users/lenovo/Documents/Codex/2026-10-17/https-www-boxuegu-com-matchtrack-detail/work");
const demoFiles = [
  "attention.pdf",
  "attention_scan_batch20.pdf",
  "rag_2005.11401.pdf",
  "dpr_2004.04906.pdf",
  "react_2210.03629.pdf",
  "self_rag_2310.11511.pdf",
  "lost_in_middle_2307.03172.pdf",
];

const filesResponse = await fetch(`${baseUrl}/api/bff/files`, { headers });
if (!filesResponse.ok) {
  throw new Error(`Unable to list files: HTTP ${filesResponse.status}`);
}
const filePayload = await filesResponse.json();
for (const item of filePayload.items) {
  const response = await fetch(`${baseUrl}/api/bff/files/${item.id}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to delete ${item.name}: HTTP ${response.status}`);
  }
  console.log(`Removed ${item.name}`);
}

for (const name of demoFiles) {
  const path = resolve(pdfDir, name);
  if (!existsSync(path)) {
    throw new Error(`Demo PDF is missing: ${path}`);
  }
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  const response = await fetch(`${baseUrl}/api/bff/index`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Unable to index ${name}: ${payload.detail ?? response.status}`,
    );
  }
  console.log(`Indexed ${name}`);
}

const finalResponse = await fetch(`${baseUrl}/api/bff/files`, { headers });
const finalPayload = await finalResponse.json();
console.log(`Demo file count: ${finalPayload.items.length}`);
