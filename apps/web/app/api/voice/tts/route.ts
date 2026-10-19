import { requireSession } from "@/lib/authz";
import {
  isRateLimited,
  recordRateLimitEvent,
} from "@/lib/rate-limit";
import { serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateLimitKey = `voice:${session.user.id}`;
  if (isRateLimited(rateLimitKey, 6, 5 * 60 * 1000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const payload = await request.json().catch(() => null);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  const speaker =
    typeof payload?.speaker === "string" ? payload.speaker.trim() : "Carter";
  if (!text || text.length > 2500) {
    return Response.json({ error: "invalid_text" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9 _-]{1,40}$/.test(speaker)) {
    return Response.json({ error: "invalid_speaker" }, { status: 400 });
  }
  recordRateLimitEvent(rateLimitKey, 5 * 60 * 1000);

  try {
    const upstream = await fetch(`${serverConfig.vibevoiceUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker, language: "en" }),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        {
          error: "vibevoice_failed",
          detail: detail.slice(0, 500),
        },
        { status: upstream.status },
      );
    }
    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Vibevoice-Speaker": upstream.headers.get(
          "x-vibevoice-speaker",
        ) ?? speaker,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "vibevoice_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
