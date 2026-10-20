import { auth } from "@/auth";
import { workerLockFile } from "@/lib/runtime-paths";
import { bffHeaders, serverConfig } from "@/lib/server-config";
import { existsSync, readFileSync } from "node:fs";

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

function workerHealth() {
  const lockPath = workerLockFile();
  if (!existsSync(lockPath)) {
    return { status: "unavailable", message: "worker lock missing" };
  }
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    process.kill(pid, 0);
    return { status: "ok", service: "index-worker", pid };
  } catch {
    return { status: "unavailable", message: "worker process not running" };
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const [kotaemon, citation, vibevoice] = await Promise.all([
    fetchHealth(
      `${serverConfig.bffUrl}/api/bff/health`,
      bffHeaders(),
    ),
    fetchHealth(`${serverConfig.citationUrl}/api/health`),
    fetchHealth(`${serverConfig.vibevoiceUrl}/health`),
  ]);

  return Response.json({
    next: {
      status: "ok",
      service: "nextjs",
      version: "16.4.2",
    },
    kotaemon,
    citation,
    vibevoice,
    worker: workerHealth(),
    generated_at: new Date().toISOString(),
  });
}
