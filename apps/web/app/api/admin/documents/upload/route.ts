import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { requireAdmin } from "@/lib/authz";
import { createIndexJob } from "@/lib/db";
import { uploadsDirectory } from "@/lib/runtime-paths";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const DEDUPE_ACTIONS = new Set([
  "keep_existing",
  "replace",
  "coexist",
]);

type DuplicateMatch = {
  existing_id: string;
  existing_name: string;
  recommendation: "keep_existing" | "keep_incoming" | "review";
  relationship: string;
  similarity: number;
  changed_ratio: number;
};

type DedupePreflight = {
  duplicate: boolean;
  recommended_action: string;
  matches: DuplicateMatch[];
};

async function preflightPdf(data: ArrayBuffer, fileName: string) {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([data], { type: "application/pdf" }),
    fileName,
  );
  const response = await fetch(
    `${serverConfig.bffUrl}/api/bff/dedupe/preflight`,
    {
      method: "POST",
      headers: bffHeaders(),
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.detail ?? payload.error ?? `Dedupe HTTP ${response.status}`,
    );
  }
  return payload as DedupePreflight;
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_file" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "pdf_required" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
    return Response.json({ error: "invalid_file_size" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    return Response.json({ error: "invalid_pdf" }, { status: 400 });
  }

  let preflight: DedupePreflight;
  try {
    preflight = await preflightPdf(arrayBuffer, file.name);
  } catch (error) {
    return Response.json(
      {
        error: "dedupe_unavailable",
        detail:
          error instanceof Error
            ? error.message
            : "Semantic duplicate detection failed",
      },
      { status: 503 },
    );
  }

  const requestedAction = formData?.get("dedupe_action");
  const dedupeAction =
    typeof requestedAction === "string" &&
    DEDUPE_ACTIONS.has(requestedAction)
      ? requestedAction
      : "";
  if (preflight.duplicate && !dedupeAction) {
    return Response.json(
      {
        error: "semantic_duplicate",
        preflight,
      },
      { status: 409 },
    );
  }
  if (dedupeAction === "keep_existing") {
    return Response.json({
      status: "skipped",
      message: "Existing document was kept",
      preflight,
    });
  }
  if (dedupeAction === "replace") {
    const existingId = preflight.matches[0]?.existing_id;
    if (!existingId) {
      return Response.json(
        { error: "missing_existing_document" },
        { status: 409 },
      );
    }
    const deletion = await fetch(
      `${serverConfig.bffUrl}/api/bff/files/${encodeURIComponent(existingId)}`,
      {
        method: "DELETE",
        headers: bffHeaders(),
        cache: "no-store",
      },
    ).catch(() => null);
    if (!deletion?.ok) {
      return Response.json(
        {
          error: "existing_document_delete_failed",
          detail: deletion
            ? `HTTP ${deletion.status}`
            : "BFF request failed",
        },
        { status: 502 },
      );
    }
  }

  const id = randomUUID();
  const uploadDir = uploadsDirectory();
  await mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, `${id}.pdf`);
  await writeFile(filePath, bytes);

  const job = createIndexJob({
    id,
    userId: session.user.id,
    filePath,
    fileName: file.name,
    size: file.size,
  });

  return Response.json(
    {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      fileName: file.name,
      size: file.size,
      preflight,
    },
    { status: 202 },
  );
}
