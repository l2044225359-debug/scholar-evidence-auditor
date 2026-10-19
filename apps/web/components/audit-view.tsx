"use client";

import {
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  Printer,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { SourceFile } from "@/lib/types";

import { useLanguage } from "./language-provider";
import styles from "./audit-view.module.css";

type AuditClaim = {
  id: string;
  claim: string;
  verdict: "supported" | "contradicted" | "insufficient";
  reason: string;
  citation_complete: boolean;
  evidence: Array<{
    file_name: string;
    page: number | null;
    snippet: string;
  }>;
  numeric_checks: Array<{ value: string; matched: boolean }>;
};

type AuditReport = {
  claims: AuditClaim[];
  answer: string;
  summary: {
    claim_count: number;
    supported_count: number;
    contradicted_count: number;
    insufficient_count: number;
    citation_integrity_rate: number;
  };
};

type AuditItem = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  input: { question: string; fileIds: string[] | null };
  report: AuditReport | null;
  error: string | null;
  created_at: string;
};

export function AuditView() {
  const { locale, t } = useLanguage();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [selectedAudit, setSelectedAudit] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    const [filesResponse, auditsResponse] = await Promise.all([
      fetch("/api/files", { cache: "no-store", credentials: "include" }),
      fetch("/api/audits", { cache: "no-store", credentials: "include" }),
    ]);
    if (!filesResponse.ok || !auditsResponse.ok) {
      throw new Error(t("audit.failed"));
    }
    const [filesPayload, auditsPayload] = await Promise.all([
      filesResponse.json(),
      auditsResponse.json(),
    ]);
    setFiles(filesPayload.items ?? []);
    setAudits(auditsPayload.items ?? []);
    setSelectedAudit((current) => {
      if (current) return current;
      return auditsPayload.items?.[0]?.id;
    });
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void loadData()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [loadData]);

  const activeAudits = audits.some(
    (audit) => audit.status === "queued" || audit.status === "running",
  );
  useEffect(() => {
    if (!activeAudits) return;
    const timer = window.setInterval(() => {
      void loadData();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeAudits, loadData]);

  const current = useMemo(
    () => audits.find((audit) => audit.id === selectedAudit),
    [audits, selectedAudit],
  );

  function toggleFile(id: string) {
    setSelectedFiles((currentFiles) => {
      const next = new Set(currentFiles);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runAudit() {
    if (!question.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          fileIds: selectedFiles.size ? [...selectedFiles] : null,
          language: locale,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("audit.failed"));
      setQuestion("");
      setSelectedAudit(payload.id);
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("audit.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function statusLabel(status: AuditItem["status"]) {
    return t(
      `audit.${status}` as
        | "audit.queued"
        | "audit.running"
        | "audit.completed"
        | "audit.failed",
    );
  }

  function downloadJson() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${current.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("audit.title")}</h1>
          <p>{t("audit.subtitle")}</p>
        </div>
        <span className="tag accent">
          <FileSearch size={13} />
          qwen3.8-max
        </span>
      </header>

      <main className={styles.content}>
        {error ? <div className="error-banner">{error}</div> : null}

        <section className={styles.formPanel}>
          <label>
            {t("audit.question")}
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("audit.questionPlaceholder")}
              rows={4}
            />
          </label>
          <div className={styles.scope}>
            <strong>{t("audit.scope")}</strong>
            <span>{t("audit.allDocuments")}</span>
            <div className={styles.fileChoices}>
              {files.map((file) => (
                <label key={file.id}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.id)}
                    onChange={() => toggleFile(file.id)}
                  />
                  <span>{file.name}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => void runAudit()}
            disabled={submitting || !question.trim()}
          >
            {submitting ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <ShieldQuestion size={15} />
            )}
            {t("audit.run")}
          </button>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.history}>
            <h2>{t("audit.history")}</h2>
            {!audits.length ? (
              <div className={styles.empty}>{t("audit.noReports")}</div>
            ) : null}
            {audits.map((audit) => (
              <button
                key={audit.id}
                type="button"
                className={
                  audit.id === selectedAudit
                    ? `${styles.historyItem} ${styles.active}`
                    : styles.historyItem
                }
                onClick={() => setSelectedAudit(audit.id)}
              >
                <span>{audit.input.question}</span>
                <small>{statusLabel(audit.status)}</small>
              </button>
            ))}
          </aside>

          <section className={styles.report}>
            {loading ? (
              <div className={styles.empty}>{t("common.loading")}</div>
            ) : null}
            {!loading && !current ? (
              <div className={styles.empty}>{t("audit.noReports")}</div>
            ) : null}
            {current?.status === "queued" || current?.status === "running" ? (
              <div className={styles.running}>
                <Loader2 className="spin" size={22} />
                <span>{statusLabel(current.status)}</span>
              </div>
            ) : null}
            {current?.status === "failed" ? (
              <div className="error-banner">{current.error}</div>
            ) : null}
            {current?.report ? (
              <>
                <div className={styles.reportHeader}>
                  <div className={styles.summary}>
                    <span>
                      <strong>{current.report.summary.claim_count}</strong>
                      {t("audit.claims")}
                    </span>
                    <span className={styles.supported}>
                      <strong>{current.report.summary.supported_count}</strong>
                      {t("audit.supported")}
                    </span>
                    <span className={styles.contradicted}>
                      <strong>{current.report.summary.contradicted_count}</strong>
                      {t("audit.contradicted")}
                    </span>
                    <span className={styles.insufficient}>
                      <strong>{current.report.summary.insufficient_count}</strong>
                      {t("audit.insufficient")}
                    </span>
                  </div>
                  <div className={styles.reportActions}>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={downloadJson}
                    >
                      <Download size={13} />
                      {t("audit.downloadJson")}
                    </button>
                    <a
                      className="secondary-button"
                      href={`/api/audits/${current.id}/report`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Printer size={13} />
                      {t("audit.print")}
                    </a>
                  </div>
                </div>

                <div className={styles.claimList}>
                  {current.report.claims.map((claim) => (
                    <article className={styles.claim} key={claim.id}>
                      <div className={styles.claimHeader}>
                        <span
                          className={
                            claim.verdict === "supported"
                              ? styles.supported
                              : claim.verdict === "contradicted"
                                ? styles.contradicted
                                : styles.insufficient
                          }
                        >
                          {claim.verdict === "supported" ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <ShieldAlert size={14} />
                          )}
                          {t(`audit.${claim.verdict}` as
                            | "audit.supported"
                            | "audit.contradicted"
                            | "audit.insufficient")}
                        </span>
                        <span className={styles.claimId}>{claim.id}</span>
                      </div>
                      <p>{claim.claim}</p>
                      <small>{claim.reason}</small>
                      <div className={styles.claimMeta}>
                        <span>
                          {t("audit.citationComplete")}:{" "}
                          {claim.citation_complete ? "✓" : "✗"}
                        </span>
                        <span>
                          {t("audit.evidence")}:{" "}
                          {claim.evidence
                            .map(
                              (item) =>
                                `${item.file_name} p.${item.page ?? "?"}`,
                            )
                            .join(", ") || "—"}
                        </span>
                        <span>
                          {t("audit.numeric")}:{" "}
                          {claim.numeric_checks
                            .map(
                              (item) =>
                                `${item.value} ${item.matched ? "✓" : "✗"}`,
                            )
                            .join(", ") || "—"}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
