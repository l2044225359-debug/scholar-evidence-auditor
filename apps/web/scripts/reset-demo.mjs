import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const dataDir = process.env.DEMO_DATA_DIR
  ? resolve(process.env.DEMO_DATA_DIR)
  : resolve(repoRoot, "data");
const dbPath = process.env.DEMO_DB_PATH
  ? resolve(process.env.DEMO_DB_PATH)
  : resolve(dataDir, "demo.sqlite");
const accountsPath = resolve(dataDir, "demo-accounts.json");
const uploadsPath = resolve(dataDir, "uploads");
const backupRoot = resolve(repoRoot, "work/demo-backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = resolve(backupRoot, timestamp);

mkdirSync(backupDir, { recursive: true });
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, accountsPath]) {
  if (!existsSync(path)) continue;
  copyFileSync(path, resolve(backupDir, path.split(/[\\/]/).pop()));
}
console.log(`Backup: ${backupDir}`);

for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, accountsPath]) {
  rmSync(path, { force: true });
}
rmSync(uploadsPath, { recursive: true, force: true });
mkdirSync(uploadsPath, { recursive: true });

const initResult = spawnSync(
  process.execPath,
  [resolve(scriptDir, "init-demo.mjs")],
  {
    cwd: appRoot,
    env: process.env,
    stdio: "inherit",
  },
);
if (initResult.status !== 0) {
  process.exit(initResult.status ?? 1);
}

console.log("Demo database, accounts, invite code, and uploads were reset.");
