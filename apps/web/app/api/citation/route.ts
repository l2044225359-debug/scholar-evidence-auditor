import { auth } from "@/auth";
import { serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.text();
  const upstream = await fetch(`${serverConfig.citationUrl}/api/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    cache: "no-store",
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
