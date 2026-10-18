import { auth } from "@/auth";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchHealth(url: string, headers?: HeadersInit) {
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { status: "unavailable", code: response.status };
    }
    return await response.json();
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "request failed",
    };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const [kotaemon, citation] = await Promise.all([
    fetchHealth(
      `${serverConfig.bffUrl}/api/bff/health`,
      bffHeaders(),
    ),
    fetchHealth(`${serverConfig.citationUrl}/api/health`),
  ]);

  return Response.json({
    kotaemon,
    citation,
    generated_at: new Date().toISOString(),
  });
}
