import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const dataDir = process.env.DEMO_DATA_DIR
  ? resolve(process.env.DEMO_DATA_DIR)
  : resolve(repoRoot, "data");
const dbPath = process.env.DEMO_DB_PATH
  ? resolve(process.env.DEMO_DB_PATH)
  : resolve(dataDir, "demo.sqlite");
const credentialsPath = process.env.DEMO_CREDENTIALS_PATH
  ? resolve(process.env.DEMO_CREDENTIALS_PATH)
  : resolve(dataDir, "demo-accounts.json");
const database = new DatabaseSync(dbPath);

const admin = database
  .prepare("SELECT id FROM users WHERE username_lower = 'admin'")
  .get();
if (!admin) {
  throw new Error("Admin account does not exist. Run demo:init first.");
}

database
  .prepare("UPDATE invite_codes SET active = 0 WHERE active = 1")
  .run();

const code = `SCHOLAR-${randomBytes(6).toString("hex").toUpperCase()}`;
database
  .prepare(
    `INSERT INTO invite_codes (
      code, created_by, max_uses, uses, active, expires_at, created_at
    ) VALUES (?, ?, 20, 0, 1, ?, ?)`,
  )
  .run(
    code,
    admin.id,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    new Date().toISOString(),
  );

const credentials = existsSync(credentialsPath)
  ? JSON.parse(readFileSync(credentialsPath, "utf8"))
  : {};
credentials.inviteCode = code;
writeFileSync(
  credentialsPath,
  `${JSON.stringify(credentials, null, 2)}\n`,
  "utf8",
);

console.log("Invitation code rotated. New code saved to demo-accounts.json.");
