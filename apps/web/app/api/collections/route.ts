import { requireSession } from "@/lib/authz";
import { buildKnowledgeCollections } from "@/lib/knowledge-collections";
import { bffHeaders, serverConfig } from "@/lib/server-config";
import type { SourceFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const locale =
    new URL(request.url).searchParams.get("language") === "en" ? "en" : "zh";
  try {
    const response = await fetch(`${serverConfig.bffUrl}/api/bff/files`, {
      headers: bffHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json(payload, { status: response.status });
    }
    const files = (payload.items ?? []) as SourceFile[];
    return Response.json({
      items: buildKnowledgeCollections(files, locale),
    });
  } catch (error) {
    return Response.json(
      {
        error: "collections_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
