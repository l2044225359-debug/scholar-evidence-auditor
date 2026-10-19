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

  const key = `translate:${session.user.id}`;
  if (isRateLimited(key, 40, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const payload = await request.json().catch(() => null);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  const targetLanguage =
    payload?.targetLanguage === "en"
      ? "en"
      : payload?.targetLanguage === "zh"
        ? "zh"
        : "";
  const sourceLanguage =
    payload?.sourceLanguage === "zh"
      ? "zh"
      : payload?.sourceLanguage === "en"
        ? "en"
        : "";
  if (
    !text ||
    text.length > 30_000 ||
    !targetLanguage ||
    !sourceLanguage
  ) {
    return Response.json({ error: "invalid_text" }, { status: 400 });
  }

  recordRateLimitEvent(key, 60_000);
  try {
    const upstream = await fetch(`${serverConfig.bffUrl}/api/bff/translate`, {
      method: "POST",
      headers: bffHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return Response.json(
        {
          error: "translation_failed",
          detail: body.detail ?? body.error ?? `HTTP ${upstream.status}`,
        },
        { status: upstream.status },
      );
    }
    return Response.json(body);
  } catch (error) {
    return Response.json(
      {
        error: "translation_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
