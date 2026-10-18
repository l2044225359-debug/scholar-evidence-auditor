import { requireAdmin } from "@/lib/authz";
import { bffHeaders, serverConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const upstream = await fetch(
    `${serverConfig.bffUrl}/api/bff/files/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: bffHeaders(),
      cache: "no-store",
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
