import { z } from "zod";

import { requireSession } from "@/lib/authz";
import { createAuditJob, listAudits } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  question: z.string().trim().min(2).max(20_000),
  fileIds: z.array(z.string()).nullable().optional(),
  language: z.enum(["zh", "en"]).optional(),
});

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = listAudits(session.user.id).map((audit) => ({
    id: audit.id,
    status: audit.status,
    input: JSON.parse(audit.input_json),
    report: audit.result_json ? JSON.parse(audit.result_json) : null,
    error: audit.error,
    created_at: audit.created_at,
    updated_at: audit.updated_at,
  }));
  return Response.json({ items });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const audit = createAuditJob({
    userId: session.user.id,
    question: parsed.data.question,
    fileIds: parsed.data.fileIds ?? null,
    language: parsed.data.language ?? "zh",
  });
  return Response.json(
    {
      id: audit.id,
      status: audit.status,
      input: JSON.parse(audit.input_json),
    },
    { status: 202 },
  );
}
