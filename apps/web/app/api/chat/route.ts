import { auth } from "@/auth";
import { recordUsage, usageCountSince } from "@/lib/db";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let usageCount = 0;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    usageCount = usageCountSince(session.user.id, "chat", since);
  } catch (error) {
    console.warn("chat usage lookup failed", error);
  }
  if (usageCount >= 100) {
    return Response.json({ error: "daily_chat_limit_reached" }, { status: 429 });
  }

  const payload = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${serverConfig.bffUrl}/api/bff/chat/stream`, {
      method: "POST",
      headers: bffHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      }),
      body: payload,
      cache: "no-store",
    });
  } catch (error) {
    return Response.json(
      {
        error: "chat_bff_unreachable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json(
      {
        error: "chat_bff_unavailable",
        detail: detail || upstream.statusText,
      },
      { status: upstream.status || 502 },
    );
  }

  try {
    recordUsage(session.user.id, "chat");
  } catch (error) {
    console.warn("chat usage recording failed", error);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
