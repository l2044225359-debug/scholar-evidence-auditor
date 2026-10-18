import { requireAdmin } from "@/lib/authz";
import { listUsers } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json({ items: listUsers() });
}
