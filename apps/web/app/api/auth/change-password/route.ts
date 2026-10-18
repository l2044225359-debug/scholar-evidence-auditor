import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

import { requireSession } from "@/lib/authz";
import { getUserById, setUserPassword } from "@/lib/db";

export const runtime = "nodejs";

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10).max(128),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const user = getUserById(session.user.id);
  if (
    !user ||
    !(await verify(user.password_hash, parsed.data.currentPassword).catch(
      () => false,
    ))
  ) {
    return Response.json(
      { error: "invalid_current_password" },
      { status: 400 },
    );
  }

  const passwordHash = await hash(parsed.data.newPassword, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  setUserPassword({
    userId: user.id,
    passwordHash,
    mustChangePassword: false,
  });
  return Response.json({ ok: true });
}
