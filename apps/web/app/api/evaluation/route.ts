import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { requireSession } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resultsPath() {
  const configured = process.env.EVALUATION_RESULTS_PATH?.trim();
  return configured
    ? resolve(configured)
    : resolve(process.cwd(), "../../tests/evaluation/results.json");
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const path = resultsPath();
    const [raw, metadata] = await Promise.all([
      readFile(path, "utf8"),
      stat(path),
    ]);
    const payload = JSON.parse(raw);
    if (!payload.summary?.blind) {
      return Response.json(
        { error: "blind_evaluation_missing" },
        { status: 404 },
      );
    }

    return Response.json({
      available: true,
      generated_at: metadata.mtime.toISOString(),
      protocol: {
        name: payload.protocol?.protocol ?? "blind-v1",
        total: payload.protocol?.total ?? payload.summary.blind.total,
        executed: payload.protocol?.executedCaseCount,
        question_set_sha256: payload.protocol?.questionSetSha256,
        rubric_sha256: payload.protocol?.rubricSha256,
      },
      metrics: {
        blind: payload.summary.blind,
        baselines: payload.summary.baselines,
      },
    });
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT";
    return Response.json(
      {
        available: false,
        error: missing ? "evaluation_not_found" : "evaluation_unavailable",
        detail: error instanceof Error ? error.message : "request failed",
      },
      { status: missing ? 404 : 503 },
    );
  }
}
