import { requireAdmin } from "@/lib/authz";
import { listJobs } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const jobs = listJobs().map((job) => {
    const payload = JSON.parse(job.payload_json) as {
      fileName?: string;
      size?: number;
    };
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      fileName: payload.fileName ?? "Document",
      size: payload.size ?? 0,
      error: job.error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      result: job.result_json ? JSON.parse(job.result_json) : null,
    };
  });
  return Response.json({ items: jobs });
}
