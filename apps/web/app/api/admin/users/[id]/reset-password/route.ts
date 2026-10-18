import { randomBytes } from "node:crypto";

import { hash } from "@node-rs/argon2";

import { requireAdmin } from "@/lib/authz";
import { getUserById, setUserPassword } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const target = getUserById(id);
  if (!target) {
    return Response.json({ error: "user_not_found" }, { status: 404 });
  }

  const temporaryPassword = randomBytes(10).toString("base64url");
  const passwordHash = await hash(temporaryPassword, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  setUserPassword({
    userId: target.id,
    passwordHash,
    mustChangePassword: true,
  });

  return Response.json({
    username: target.username,
    temporaryPassword,
  });
}
