import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { requireAdmin } from "@/lib/authz";
import { createIndexJob } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 100 * 1024 * 1024;

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

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    return Response.json({ error: "invalid_pdf" }, { status: 400 });
  }

  const id = randomUUID();
  const uploadDir = path.resolve(process.cwd(), "../../data/uploads");
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
    },
    { status: 202 },
  );
}
