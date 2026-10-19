import { requireSession } from "@/lib/authz";
import { listJobs } from "@/lib/db";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function healthStatus(score: number) {
  if (score <= 0) return "empty";
  if (score >= 90) return "healthy";
  if (score >= 65) return "attention";
  return "degraded";
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const refresh =
    new URL(request.url).searchParams.get("refresh") === "1" ? "1" : "0";
  try {
    const response = await fetch(
      `${serverConfig.bffUrl}/api/bff/knowledge-overview?refresh=${refresh}`,
      {
        headers: bffHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      },
    );
    const overview = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json(overview, { status: response.status });
    }

    const now = Date.now();
    const recentJobs = listJobs(80).filter(
      (job) =>
        now - new Date(job.created_at).getTime() <= 24 * 60 * 60 * 1000,
    );
    const active = recentJobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length;
    const failed = recentJobs.filter((job) => job.status === "failed").length;
    const baseScore = Number(overview.health?.score ?? 0);
    const adjustedScore = overview.documents
      ? Math.max(0, Math.min(100, baseScore - Math.min(15, failed * 3)))
      : 0;
    const status =
      active > 0 && adjustedScore >= 65
        ? "indexing"
        : healthStatus(adjustedScore);

    return Response.json({
      ...overview,
      health: {
        ...(overview.health ?? {}),
        score: adjustedScore,
        status,
      },
      queue: {
        active,
        failed,
        worker_status: active > 0 ? "busy" : "ready",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "knowledge_overview_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
