import { requireSession } from "@/lib/authz";
import { serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const source = new URL(request.url).searchParams.get("path") ?? "";
  if (
    !source.startsWith("/file=/home/lh/race/kotaemon/") ||
    source.includes("..")
  ) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }

  const upstream = await fetch(`${serverConfig.bffUrl}${source}`, {
    cache: "no-store",
    headers: { Accept: "application/pdf,*/*" },
  });
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "file_unavailable" },
      { status: upstream.status || 502 },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
