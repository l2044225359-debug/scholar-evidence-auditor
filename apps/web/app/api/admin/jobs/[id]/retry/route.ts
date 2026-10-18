import { requireAdmin } from "@/lib/authz";
import { retryJob } from "@/lib/db";

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
  const job = retryJob(id);
  if (!job) {
    return Response.json(
      { error: "job_not_retryable" },
      { status: 409 },
    );
  }
  return Response.json({ id: job.id, status: job.status });
}
