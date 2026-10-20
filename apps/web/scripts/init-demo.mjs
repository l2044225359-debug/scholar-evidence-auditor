import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { hashSync } from "@node-rs/argon2";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "../..");
const dataDir = process.env.DEMO_DATA_DIR
  ? resolve(process.env.DEMO_DATA_DIR)
  : resolve(repoRoot, "data");
const dbPath = process.env.DEMO_DB_PATH
  ? resolve(process.env.DEMO_DB_PATH)
  : resolve(dataDir, "demo.sqlite");
const schemaPath = process.env.DEMO_SCHEMA_PATH
  ? resolve(process.env.DEMO_SCHEMA_PATH)
  : resolve(appRoot, "lib/db/schema.sql");
const credentialsPath = process.env.DEMO_CREDENTIALS_PATH
  ? resolve(process.env.DEMO_CREDENTIALS_PATH)
  : resolve(dataDir, "demo-accounts.json");

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(schemaPath, "utf8"));

function password() {
  return randomBytes(12).toString("base64url");
}

function createSeedUser(username, role) {
  const existing = db
    .prepare("SELECT id FROM users WHERE username_lower = ?")
    .get(username.toLowerCase());
  if (existing) return null;

  const plainPassword = password();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (
      id, username, username_lower, email, password_hash, role,
      active, must_change_password, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, 1, 0, ?, ?)`,
  ).run(
    randomUUID(),
    username,
    username.toLowerCase(),
    hashSync(plainPassword, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    }),
    role,
    timestamp,
    timestamp,
  );
  return plainPassword;
}

const adminPassword = createSeedUser("admin", "admin");
const examiner1Password = createSeedUser("examiner1", "user");
const examiner2Password = createSeedUser("examiner2", "user");

let invite = db
  .prepare(
    `SELECT code FROM invite_codes
     WHERE active = 1 AND uses < max_uses
     ORDER BY created_at DESC LIMIT 1`,
  )
  .get();

let inviteCode = invite?.code;
if (!inviteCode) {
  const admin = db
    .prepare("SELECT id FROM users WHERE username_lower = 'admin'")
    .get();
  inviteCode = `SCHOLAR-${randomBytes(6).toString("hex").toUpperCase()}`;
  db.prepare(
    `INSERT INTO invite_codes (
      code, created_by, max_uses, uses, active, expires_at, created_at
    ) VALUES (?, ?, 20, 0, 1, ?, ?)`,
  ).run(
    inviteCode,
    admin.id,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    new Date().toISOString(),
  );
}

let existingCredentials = {};
if (existsSync(credentialsPath)) {
  try {
    existingCredentials = JSON.parse(
      readFileSync(credentialsPath, "utf8"),
    );
  } catch {
    existingCredentials = {};
  }
}

const generatedUsers = [
  ["admin", adminPassword, "admin"],
  ["examiner1", examiner1Password, "user"],
  ["examiner2", examiner2Password, "user"],
].filter(([, value]) => value);

for (const [username, value, role] of generatedUsers) {
  existingCredentials[username] = {
    password: value,
    role,
  };
}
existingCredentials.inviteCode =
  existingCredentials.inviteCode ?? inviteCode;
writeFileSync(
  credentialsPath,
  `${JSON.stringify(existingCredentials, null, 2)}\n`,
  "utf8",
);

console.log(`Database: ${dbPath}`);
console.log(`Demo credentials: ${credentialsPath}`);
console.log(
  generatedUsers.length
    ? `Created accounts: ${generatedUsers
        .map(([username]) => username)
        .join(", ")}`
    : "Seed accounts already exist; passwords were not changed.",
);
