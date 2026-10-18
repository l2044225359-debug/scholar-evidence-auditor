import { requireSession } from "@/lib/authz";
import { getAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const audit = getAudit(id);
  if (
    !audit ||
    (audit.user_id !== session.user.id && session.user.role !== "admin")
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({
    id: audit.id,
    status: audit.status,
    input: JSON.parse(audit.input_json),
    report: audit.result_json ? JSON.parse(audit.result_json) : null,
    error: audit.error,
    created_at: audit.created_at,
    updated_at: audit.updated_at,
  });
}
