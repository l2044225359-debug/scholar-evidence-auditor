import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type UserRole = "admin" | "user";

export type UserRow = {
  id: string;
  username: string;
  username_lower: string;
  email: string | null;
  password_hash: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
};

export type InviteRow = {
  code: string;
  created_by: string;
  max_uses: number;
  uses: number;
  active: number;
  expires_at: string | null;
  created_at: string;
};

const globalDatabase = globalThis as typeof globalThis & {
  __scholarDb?: DatabaseSync;
};

function databasePath() {
  if (process.env.DEMO_DB_PATH) {
    return path.resolve(process.env.DEMO_DB_PATH);
  }
  return path.resolve(process.cwd(), "../../data/demo.sqlite");
}

export function getDb(): DatabaseSync {
  if (globalDatabase.__scholarDb) {
    return globalDatabase.__scholarDb;
  }

  const dbPath = databasePath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const schemaPath = path.join(process.cwd(), "lib/db/schema.sql");
  if (!existsSync(schemaPath)) {
    throw new Error(`Database schema not found: ${schemaPath}`);
  }
  db.exec(readFileSync(schemaPath, "utf8"));
  const jobColumns = new Set(
    (
      db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>
    ).map((column) => column.name),
  );
  if (!jobColumns.has("progress")) {
    db.exec(
      "ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!jobColumns.has("message")) {
    db.exec("ALTER TABLE jobs ADD COLUMN message TEXT");
  }

  globalDatabase.__scholarDb = db;
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function getUserById(id: string): UserRow | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE username_lower = ?")
    .get(normalizeUsername(username)) as UserRow | undefined;
}

export function getInviteByCode(code: string): InviteRow | undefined {
  return getDb()
    .prepare("SELECT * FROM invite_codes WHERE code = ?")
    .get(code.trim().toUpperCase()) as InviteRow | undefined;
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT id, username, email, role, active, must_change_password,
              created_at, updated_at
       FROM users ORDER BY created_at`,
    )
    .all() as Array<Omit<UserRow, "password_hash" | "username_lower">>;
}

export function listInvites() {
  return getDb()
    .prepare(
      `SELECT code, created_by, max_uses, uses, active, expires_at, created_at
       FROM invite_codes ORDER BY created_at DESC`,
    )
    .all() as InviteRow[];
}

export function createInvite({
  code,
  createdBy,
  maxUses,
  expiresAt,
}: {
  code: string;
  createdBy: string;
  maxUses: number;
  expiresAt: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO invite_codes (
        code, created_by, max_uses, uses, active, expires_at, created_at
      ) VALUES (?, ?, ?, 0, 1, ?, ?)`,
    )
    .run(code, createdBy, maxUses, expiresAt, nowIso());
  return getInviteByCode(code)!;
}

export function setUserPassword({
  userId,
  passwordHash,
  mustChangePassword,
}: {
  userId: string;
  passwordHash: string;
  mustChangePassword: boolean;
}) {
  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = ?, must_change_password = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      passwordHash,
      mustChangePassword ? 1 : 0,
      nowIso(),
      userId,
    );
}

export function setUserActive(userId: string, active: boolean) {
  getDb()
    .prepare("UPDATE users SET active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, nowIso(), userId);
}

export function createUserFromInvite({
  username,
  email,
  passwordHash,
  inviteCode,
}: {
  username: string;
  email?: string;
  passwordHash: string;
  inviteCode: string;
}) {
  const db = getDb();
  const normalized = normalizeUsername(username);
  const invite = getInviteByCode(inviteCode);
  if (!invite || !invite.active) {
    throw new Error("邀请码无效");
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw new Error("邀请码已过期");
  }
  if (invite.uses >= invite.max_uses) {
    throw new Error("邀请码使用次数已用完");
  }
  if (getUserByUsername(normalized)) {
    throw new Error("用户名已存在");
  }

  const timestamp = nowIso();
  const id = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO users (
        id, username, username_lower, email, password_hash, role,
        active, must_change_password, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'user', 1, 0, ?, ?)`,
    ).run(
      id,
      username.trim(),
      normalized,
      email?.trim() || null,
      passwordHash,
      timestamp,
      timestamp,
    );
    db.prepare(
      "UPDATE invite_codes SET uses = uses + 1 WHERE code = ?",
    ).run(invite.code);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getUserById(id)!;
}

export function createConversation(userId: string, title = "New conversation") {
  const id = randomUUID();
  const timestamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO conversations (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, title, timestamp, timestamp);
  return id;
}

export function appendMessage({
  conversationId,
  role,
  content,
  citations = [],
}: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: unknown[];
}) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, role, content, citations_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    conversationId,
    role,
    content,
    JSON.stringify(citations),
    timestamp,
  );
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
    timestamp,
    conversationId,
  );
  return id;
}

export function recordUsage(
  userId: string,
  kind: "chat" | "audit" | "upload",
) {
  getDb()
    .prepare(
      "INSERT INTO usage_events (id, user_id, kind, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(randomUUID(), userId, kind, nowIso());
}

export function usageCountSince(
  userId: string,
  kind: "chat" | "audit" | "upload",
  sinceIso: string,
) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM usage_events
       WHERE user_id = ? AND kind = ? AND created_at >= ?`,
    )
    .get(userId, kind, sinceIso) as { count: number };
  return Number(row.count);
}

export type JobRow = {
  id: string;
  user_id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  payload_json: string;
  result_json: string | null;
  error: string | null;
  progress: number;
  message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function createIndexJob({
  id,
  userId,
  filePath,
  fileName,
  size,
}: {
  id: string;
  userId: string;
  filePath: string;
  fileName: string;
  size: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO jobs (
        id, user_id, kind, status, payload_json, progress, message, created_at
      ) VALUES (?, ?, 'index_pdf', 'queued', ?, 0, '等待索引', ?)`,
    )
    .run(
      id,
      userId,
      JSON.stringify({ filePath, fileName, size }),
      nowIso(),
    );
  return getJob(id)!;
}

export function getJob(id: string): JobRow | undefined {
  return getDb()
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(id) as JobRow | undefined;
}

export function listJobs(limit = 30): JobRow[] {
  return getDb()
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as JobRow[];
}

export function retryJob(id: string) {
  getDb()
    .prepare(
      `UPDATE jobs
       SET status = 'queued', progress = 0, message = '等待重试',
           error = NULL, result_json = NULL, started_at = NULL,
           finished_at = NULL
       WHERE id = ? AND status = 'failed'`,
    )
    .run(id);
  return getJob(id);
}

export type AuditRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  input_json: string;
  result_json: string | null;
  markdown: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export function createAuditJob({
  userId,
  question,
  fileIds,
}: {
  userId: string;
  question: string;
  fileIds: string[] | null;
}) {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();
  const input = { question, fileIds };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO audit_reports (
        id, user_id, status, input_json, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?)`,
    ).run(id, userId, JSON.stringify(input), timestamp, timestamp);
    db.prepare(
      `INSERT INTO jobs (
        id, user_id, kind, status, payload_json, progress, message, created_at
      ) VALUES (?, ?, 'audit', 'queued', ?, 0, '等待审计', ?)`,
    ).run(
      id,
      userId,
      JSON.stringify({ auditId: id, question, fileIds }),
      timestamp,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getAudit(id)!;
}

export function getAudit(id: string): AuditRow | undefined {
  return getDb()
    .prepare("SELECT * FROM audit_reports WHERE id = ?")
    .get(id) as AuditRow | undefined;
}

export function listAudits(userId: string, limit = 30): AuditRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM audit_reports
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as AuditRow[];
}
