import { z } from "zod";

import { requireAdmin } from "@/lib/authz";
import { getUserById, setUserActive } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ active: z.boolean() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === session.user.id) {
    return Response.json(
      { error: "cannot_disable_self" },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !getUserById(id)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  setUserActive(id, parsed.data.active);
  return Response.json({ ok: true });
}
