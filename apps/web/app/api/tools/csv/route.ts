import { requireSession } from "@/lib/authz";
import {
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/rate-limit";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = `tool-csv:${session.user.id}`;
  if (isRateLimited(key, 12, 10 * 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const question =
    typeof formData?.get("question") === "string"
      ? String(formData.get("question")).trim()
      : "";
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_csv" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return Response.json({ error: "csv_required" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_CSV_BYTES) {
    return Response.json({ error: "invalid_csv_size" }, { status: 400 });
  }
  if (question.length > 2000) {
    return Response.json({ error: "question_too_long" }, { status: 400 });
  }
  recordRateLimitEvent(key, 10 * 60_000);

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name);
  upstreamForm.append("question", question);
  try {
    const upstream = await fetch(
      `${serverConfig.bffUrl}/api/bff/tools/csv`,
      {
        method: "POST",
        headers: bffHeaders(),
        body: upstreamForm,
        cache: "no-store",
        signal: AbortSignal.timeout(300_000),
      },
    );
    const body = await upstream.json().catch(() => ({}));
    return Response.json(body, { status: upstream.status });
  } catch (error) {
    return Response.json(
      {
        error: "csv_tool_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
