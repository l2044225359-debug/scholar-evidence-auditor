import { requireSession } from "@/lib/authz";
import {
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/rate-limit";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = `tool-writing:${session.user.id}`;
  if (isRateLimited(key, 6, 10 * 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const payload = await request.json().catch(() => null);
  const idea = typeof payload?.idea === "string" ? payload.idea.trim() : "";
  const fileIds = Array.isArray(payload?.fileIds)
    ? payload.fileIds.filter((item: unknown) => typeof item === "string")
    : null;
  const language = payload?.language === "en" ? "en" : "zh";
  if (!idea || idea.length < 5 || idea.length > 4000) {
    return Response.json({ error: "invalid_idea" }, { status: 400 });
  }
  recordRateLimitEvent(key, 10 * 60_000);

  try {
    const upstream = await fetch(
      `${serverConfig.bffUrl}/api/bff/tools/writing`,
      {
        method: "POST",
        headers: bffHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          idea,
          file_ids: fileIds?.length ? fileIds : null,
          language,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(300_000),
      },
    );
    const body = await upstream.json().catch(() => ({}));
    return Response.json(body, { status: upstream.status });
  } catch (error) {
    return Response.json(
      {
        error: "writing_tool_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
