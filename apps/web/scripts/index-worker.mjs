import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { Blob } from "node:buffer";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const dataDir = resolve(repoRoot, "data");
const dbPath = resolve(dataDir, "demo.sqlite");
const schemaPath = resolve(appRoot, "lib/db/schema.sql");
const uploadDir = resolve(dataDir, "uploads");
const lockPath = resolve(repoRoot, "work/index-worker.lock");

function loadEnv() {
  const envPath = resolve(appRoot, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (pid && isProcessAlive(pid)) {
      console.log(`Index worker already running with PID ${pid}.`);
      process.exit(0);
    }
  }
  writeFileSync(lockPath, `${process.pid}\n`, "utf8");
}

function releaseLock() {
  try {
    if (Number(readFileSync(lockPath, "utf8").trim()) === process.pid) {
      unlinkSync(lockPath);
    }
  } catch {
    // Lock already removed.
  }
}

loadEnv();
acquireLock();
process.on("exit", releaseLock);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const database = new DatabaseSync(dbPath);
database.exec("PRAGMA journal_mode = WAL;");
database.exec("PRAGMA foreign_keys = ON;");
database.exec("PRAGMA busy_timeout = 5000;");
database.exec(readFileSync(schemaPath, "utf8"));
const jobColumns = new Set(
  database
    .prepare("PRAGMA table_info(jobs)")
    .all()
    .map((column) => column.name),
);
if (!jobColumns.has("progress")) {
  database.exec(
    "ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0",
  );
}
if (!jobColumns.has("message")) {
  database.exec("ALTER TABLE jobs ADD COLUMN message TEXT");
}

database
  .prepare(
    `UPDATE jobs
     SET status = 'queued', progress = 0,
         message = 'Worker restarted; waiting to retry'
     WHERE status = 'running'`,
  )
  .run();

const bffUrl = (
  process.env.KOTAEMON_BFF_URL ?? "http://127.0.0.1:7860"
).replace(/\/$/, "");
const bffToken = process.env.CHAT_BFF_TOKEN ?? "";

function claimNextJob() {
  database.exec("BEGIN IMMEDIATE");
  try {
    const job = database
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND kind = 'index_pdf'
         ORDER BY created_at LIMIT 1`,
      )
      .get();
    if (!job) {
      database.exec("COMMIT");
      return null;
    }

    const timestamp = new Date().toISOString();
    database
      .prepare(
        `UPDATE jobs
         SET status = 'running', progress = 15,
             message = 'Uploading PDF to Docling parser',
             started_at = ?, error = NULL
         WHERE id = ?`,
      )
      .run(timestamp, job.id);
    database.exec("COMMIT");
    return { ...job, status: "running", progress: 15 };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function finishJob(id, status, fields) {
  database
    .prepare(
      `UPDATE jobs
       SET status = ?, progress = ?, message = ?, result_json = ?,
           error = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      fields.progress,
      fields.message,
      fields.result ? JSON.stringify(fields.result) : null,
      fields.error ?? null,
      new Date().toISOString(),
      id,
    );
}

async function processJob(job) {
  const payload = JSON.parse(job.payload_json);
  const filePath = resolve(payload.filePath);
  if (!filePath.startsWith(uploadDir)) {
    throw new Error("Job file is outside the upload directory.");
  }
  if (!existsSync(filePath)) {
    throw new Error("Uploaded PDF no longer exists.");
  }

  database
    .prepare(
      "UPDATE jobs SET progress = 35, message = ? WHERE id = ?",
    )
    .run("Docling parse, OCR fallback and vector indexing", job.id);

  const bytes = readFileSync(filePath);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    payload.fileName,
  );
  const headers = {};
  if (bffToken) headers["X-BFF-Token"] = bffToken;
  const response = await fetch(`${bffUrl}/api/bff/index`, {
    method: "POST",
    headers,
    body: formData,
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail ?? body.message ?? `HTTP ${response.status}`);
  }

  finishJob(job.id, "completed", {
    progress: 100,
    message: "PDF indexed successfully",
    result: body,
  });
  try {
    unlinkSync(filePath);
  } catch {
    // The original index remains valid even if cleanup fails.
  }
  console.log(`Completed job ${job.id}: ${payload.fileName}`);
}

async function main() {
  console.log(`Index worker ${process.pid} started.`);
  while (true) {
    const job = claimNextJob();
    if (!job) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 1000),
      );
      continue;
    }

    try {
      await processJob(job);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Indexing failed";
      finishJob(job.id, "failed", {
        progress: 0,
        message: "Indexing failed",
        error: message,
      });
      console.error(`Failed job ${job.id}: ${message}`);
    }
  }
}

await main();
