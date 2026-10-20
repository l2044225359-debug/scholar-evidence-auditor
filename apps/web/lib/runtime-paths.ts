import path from "node:path";

function configuredPath(name: string) {
  const value = process.env[name]?.trim();
  return value ? path.resolve(value) : "";
}

export function dataDirectory() {
  return (
    configuredPath("DEMO_DATA_DIR") ||
    path.resolve(process.cwd(), "../../data")
  );
}

export function databaseFile() {
  return (
    configuredPath("DEMO_DB_PATH") ||
    path.join(dataDirectory(), "demo.sqlite")
  );
}

export function uploadsDirectory() {
  return (
    configuredPath("DEMO_UPLOAD_DIR") ||
    path.join(dataDirectory(), "uploads")
  );
}

export function workerLockFile() {
  return (
    configuredPath("WORKER_LOCK_PATH") ||
    path.resolve(process.cwd(), "../../work/index-worker.lock")
  );
}

export function schemaFile() {
  return (
    configuredPath("DEMO_SCHEMA_PATH") ||
    path.resolve(process.cwd(), "lib/db/schema.sql")
  );
}
