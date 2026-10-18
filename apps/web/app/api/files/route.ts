import { auth } from "@/auth";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(`${serverConfig.bffUrl}/api/bff/files`, {
    headers: bffHeaders(),
    cache: "no-store",
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
