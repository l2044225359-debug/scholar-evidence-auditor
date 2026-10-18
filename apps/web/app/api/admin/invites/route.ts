import { randomBytes } from "node:crypto";

import { z } from "zod";

import { requireAdmin } from "@/lib/authz";
import { createInvite, listInvites } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  maxUses: z.coerce.number().int().min(1).max(50).default(20),
  expiresDays: z.coerce.number().int().min(1).max(30).default(7),
});

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json({ items: listInvites() });
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const invite = createInvite({
    code: `SCHOLAR-${randomBytes(6).toString("hex").toUpperCase()}`,
    createdBy: session.user.id,
    maxUses: parsed.data.maxUses,
    expiresAt: new Date(
      Date.now() + parsed.data.expiresDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
  return Response.json(invite, { status: 201 });
}
