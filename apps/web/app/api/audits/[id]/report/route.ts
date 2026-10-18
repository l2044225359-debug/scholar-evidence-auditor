import { requireSession } from "@/lib/authz";
import { getAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const audit = getAudit(id);
  if (
    !audit?.result_json ||
    (audit.user_id !== session.user.id && session.user.role !== "admin")
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const report = JSON.parse(audit.result_json);
  const claims = (report.claims ?? [])
    .map(
      (claim: Record<string, unknown>) => `
        <section>
          <h2>${escapeHtml(String(claim.id))} · ${escapeHtml(String(claim.verdict))}</h2>
          <p>${escapeHtml(String(claim.claim))}</p>
          <small>${escapeHtml(String(claim.reason))}</small>
        </section>`,
    )
    .join("");
  const summary = report.summary ?? {};
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <title>证据审计报告</title><style>
    body{font:14px/1.6 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#172126}
    h1{font-size:24px}h2{font-size:16px;margin-top:24px}section{border-top:1px solid #d9dfe2;padding-top:12px}
    small{color:#66737a}@media print{body{margin:0}.no-print{display:none}}
    </style></head><body>
    <button class="no-print" onclick="window.print()">打印 / 保存 PDF</button>
    <h1>证据审计报告</h1>
    <p><strong>问题：</strong>${escapeHtml(String(report.question ?? ""))}</p>
    <p>Claims ${Number(summary.claim_count ?? 0)} · 支持 ${Number(summary.supported_count ?? 0)}
    · 矛盾 ${Number(summary.contradicted_count ?? 0)} · 证据不足 ${Number(summary.insufficient_count ?? 0)}</p>
    ${claims}
    <h2>原始回答</h2><p>${escapeHtml(String(report.answer ?? ""))}</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
