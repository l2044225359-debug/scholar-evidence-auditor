import { requireSession } from "@/lib/authz";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const language =
    new URL(request.url).searchParams.get("language") === "en"
      ? "en"
      : "zh";
  const refresh =
    new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const corpusResponse = await fetch(
      `${serverConfig.bffUrl}/api/bff/citation-corpus`,
      {
        headers: bffHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      },
    );
    const corpus = await corpusResponse.json().catch(() => ({}));
    if (!corpusResponse.ok) {
      return Response.json(corpus, { status: corpusResponse.status });
    }
    const [graphResponse, entityResponse] = await Promise.all([
      fetch(`${serverConfig.citationUrl}/api/local-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          papers: corpus.papers ?? [],
          edges: corpus.edges ?? [],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      }),
      fetch(`${serverConfig.bffUrl}/api/bff/paper-entities`, {
        method: "POST",
        headers: bffHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          papers: corpus.papers ?? [],
          language,
          refresh,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(300_000),
      }),
    ]);
    const graph = await graphResponse.json().catch(() => ({}));
    const entities = await entityResponse.json().catch(() => ({}));
    if (!graphResponse.ok) {
      return Response.json(graph, { status: graphResponse.status });
    }

    const futureResponse = await fetch(
      `${serverConfig.bffUrl}/api/bff/future-work-review`,
      {
        method: "POST",
        headers: bffHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          papers: (corpus.papers ?? []).map((paper: Record<string, unknown>) => ({
            title: paper.title,
            year: paper.year,
            future_work: paper.future_work ?? [],
          })),
          foundational: graph.foundational ?? [],
          language,
          refresh,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      },
    );
    const future = await futureResponse.json().catch(() => ({}));

    return Response.json({
      ...graph,
      future_work: futureResponse.ok
        ? future
        : {
            summary_markdown:
              language === "zh"
                ? "Future Work 综述暂不可用。"
                : "Future Work synthesis is unavailable.",
            directions: [],
            source_count: 0,
          },
      extraction_errors: corpus.extraction_errors ?? [],
      entities: entityResponse.ok
        ? entities
        : {
            summary: {
              paper_count: (corpus.papers ?? []).length,
              entity_count: 0,
              edge_count: 0,
              counts: {},
            },
            nodes: [],
            edges: [],
            papers: [],
            error: entities.detail ?? "entity_extraction_failed",
          },
      truncated: Boolean(corpus.truncated),
    });
  } catch (error) {
    return Response.json(
      {
        error: "local_graph_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: 503 },
    );
  }
}
