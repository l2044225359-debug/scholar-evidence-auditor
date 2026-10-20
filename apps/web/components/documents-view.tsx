"use client";

import {
  Activity,
  BookOpen,
  CheckCircle2,
  Clock3,
  Database,
  Files,
  FileText,
  GitBranch,
  GitCompareArrows,
  Layers,
  Library,
  Loader2,
  RefreshCw,
  ScanText,
  Search,
  ShieldAlert,
  Table2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useSession } from "next-auth/react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { KnowledgeOverview, SourceFile } from "@/lib/types";

import { useLanguage } from "./language-provider";
import styles from "./data-views.module.css";

type IndexJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string | null;
  fileName: string;
  size: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type DuplicateMatch = {
  existing_id: string;
  existing_name: string;
  existing_version: number;
  incoming_version: number;
  canonical_id: string;
  recommendation: "keep_existing" | "keep_incoming" | "review";
  relationship: string;
  similarity: number;
  changed_ratio: number;
  changes: {
    added: string[];
    removed: string[];
  };
};

type DedupePreflight = {
  file_name: string;
  canonical_id: string;
  version: number;
  page_count: number;
  duplicate: boolean;
  recommended_action: string;
  matches: DuplicateMatch[];
  summary_zh: string;
  summary_en: string;
};

type PendingDuplicate = {
  file: File;
  preflight: DedupePreflight;
  remaining: File[];
  completed: number;
};

type DedupeAction = "keep_existing" | "replace" | "coexist";

function sizeLabel(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function versionLabel(version?: number) {
  return version && version > 0 ? `v${version}` : "—";
}

function relationshipLabel(relationship: string, locale: "zh" | "en") {
  const labels: Record<string, [string, string]> = {
    exact_duplicate: ["内容完全相同", "Exact duplicate"],
    incoming_newer: ["新文件版本更新", "Incoming version is newer"],
    incoming_older: ["新文件版本较旧", "Incoming version is older"],
    same_version_revision: ["同一版本内容有修订", "Same-version revision"],
    semantic_duplicate: ["正文高度相似", "Highly similar content"],
  };
  const label = labels[relationship];
  return label ? label[locale === "zh" ? 0 : 1] : relationship;
}

export function DocumentsView() {
  const { locale, t } = useLanguage();
  const { data: session } = useSession();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [jobs, setJobs] = useState<IndexJob[]>([]);
  const [overview, setOverview] = useState<KnowledgeOverview>();
  const [overviewError, setOverviewError] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingJob, setPendingJob] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [duplicatePrompt, setDuplicatePrompt] =
    useState<PendingDuplicate>();
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = session?.user?.role === "admin";

  const loadFiles = useCallback(async () => {
    const response = await fetch("/api/files", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) throw new Error(t("documents.loadError"));
    const payload = await response.json();
    setFiles(payload.items ?? []);
  }, [t]);

  const loadJobs = useCallback(async () => {
    if (!isAdmin) return;
    const response = await fetch("/api/admin/jobs", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) throw new Error(t("documents.loadError"));
    const payload = await response.json();
    setJobs(payload.items ?? []);
  }, [isAdmin, t]);

  const loadOverview = useCallback(async (force = false) => {
    setOverviewError("");
    try {
      const response = await fetch(
        `/api/knowledge-overview${force ? "?refresh=1" : ""}`,
        {
          cache: "no-store",
          credentials: "include",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ??
            payload.error ??
            t("knowledge.loadError"),
        );
      }
      setOverview(payload);
    } catch (reason) {
      setOverviewError(
        reason instanceof Error ? reason.message : t("knowledge.loadError"),
      );
    }
  }, [t]);

  const refresh = useCallback(async (forceOverview = false) => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([
        loadFiles(),
        loadJobs(),
        loadOverview(forceOverview),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("documents.loadError"));
    } finally {
      setLoading(false);
    }
  }, [loadFiles, loadJobs, loadOverview, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    const hasActiveJob = jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isAdmin, jobs, refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.name.toLowerCase().includes(needle));
  }, [files, query]);

  function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    setNotice("");
    const files = Array.from(event.target.files ?? []);
    const invalid = files.find(
      (file) =>
        !file.name.toLowerCase().endsWith(".pdf") ||
        file.size <= 0 ||
        file.size > 100 * 1024 * 1024,
    );
    if (invalid || files.length > 20) {
      setSelectedFiles([]);
      setError(t("documents.invalidPdf"));
      return;
    }
    setSelectedFiles(files);
  }

  async function enqueuePdf(file: File, action?: DedupeAction) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("locale", locale);
    if (action) formData.append("dedupe_action", action);
    return fetch("/api/admin/documents/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  }

  async function enqueueFiles(files: File[], completed = 0) {
    let accepted = completed;
    const total = completed + files.length;
    setUploadProgress({ done: completed, total });
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const response = await enqueuePdf(file);
      const payload = await response.json().catch(() => ({}));
      if (
        response.status === 409 &&
        payload.error === "semantic_duplicate"
      ) {
        setDuplicatePrompt({
          file,
          preflight: payload.preflight,
          remaining: files.slice(index + 1),
          completed: accepted,
        });
        setNotice(t("documents.dedupePaused"));
        return false;
      }
      if (!response.ok) {
        throw new Error(
          payload.detail ??
            payload.error ??
            t("documents.invalidPdf"),
        );
      }
      accepted += 1;
      setUploadProgress({ done: accepted, total });
    }
    return true;
  }

  async function uploadPdfs() {
    if (!selectedFiles.length || uploading) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const completed = await enqueueFiles(selectedFiles);
      if (completed) {
        setSelectedFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        setNotice(t("documents.uploadBatchSuccess"));
        await loadJobs();
        await loadOverview(true);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("documents.invalidPdf"),
      );
    } finally {
      setUploading(false);
    }
  }

  async function resolveDuplicate(action: DedupeAction | "cancel") {
    const pending = duplicatePrompt;
    if (!pending) return;
    setDuplicatePrompt(undefined);
    setError("");
    if (action === "cancel") {
      setNotice(t("documents.dedupeCancelled"));
      setSelectedFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setUploading(true);
    try {
      if (action !== "keep_existing") {
        const response = await enqueuePdf(pending.file, action);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            payload.detail ??
              payload.error ??
              t("documents.invalidPdf"),
          );
        }
      }
      const completed = await enqueueFiles(
        pending.remaining,
        pending.completed + 1,
      );
      if (completed) {
        setSelectedFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        setNotice(
          action === "keep_existing"
            ? t("documents.duplicateKept")
            : t("documents.uploadBatchSuccess"),
        );
        await loadJobs();
        await loadOverview(true);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("documents.invalidPdf"),
      );
      setDuplicatePrompt(pending);
    } finally {
      setUploading(false);
    }
  }

  async function retryJob(id: string) {
    setPendingJob(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/jobs/${id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? t("common.requestFailed"));
        return;
      }
      await loadJobs();
    } finally {
      setPendingJob(undefined);
    }
  }

  async function deleteDocument(file: SourceFile) {
    if (
      !window.confirm(
        `${t("documents.delete")} ${file.name}?`,
      )
    ) {
      return;
    }
    setError("");
    setPendingDelete(file.id);
    try {
      const response = await fetch(`/api/admin/documents/${file.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.detail ?? payload.error ?? t("documents.loadError"));
        return;
      }
      await loadFiles();
      await loadOverview(true);
    } finally {
      setPendingDelete(undefined);
    }
  }

  function jobStatus(job: IndexJob) {
    if (job.status === "queued") return t("documents.waiting");
    if (job.status === "running") return t("documents.processing");
    if (job.status === "completed") return t("documents.completed");
    return t("documents.failed");
  }

  function numberLabel(value: number) {
    return value.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
  }

  function healthLabel(status?: KnowledgeOverview["health"]["status"]) {
    if (status === "healthy") return t("knowledge.healthy");
    if (status === "attention") return t("knowledge.attention");
    if (status === "degraded") return t("knowledge.degraded");
    if (status === "indexing") return t("knowledge.indexing");
    return t("knowledge.empty");
  }

  const duplicateMatch = duplicatePrompt?.preflight.matches[0];
  const duplicateSummary =
    locale === "zh"
      ? duplicatePrompt?.preflight.summary_zh
      : duplicatePrompt?.preflight.summary_en;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t("documents.title")}</h1>
          <p>{t("documents.subtitle")}</p>
        </div>
        <span className="tag accent">
          <Library size={13} />
          {files.length} {t("documents.indexed")}
        </span>
      </header>
      <main className={styles.content}>
        {error ? <div className="error-banner">{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <section className={styles.overviewPanel}>
          <div className={styles.overviewHeader}>
            <div className={styles.overviewHeading}>
              <span className={styles.overviewEyebrow}>
                <Database size={14} />
                {t("knowledge.eyebrow")}
              </span>
              <div>
                <h2>{t("knowledge.title")}</h2>
                <p>{t("knowledge.subtitle")}</p>
              </div>
            </div>
            <span className={styles.overviewTimestamp}>
              {overview?.generated_at
                ? `${t("knowledge.updated")} ${new Date(
                    overview.generated_at,
                  ).toLocaleString(
                    locale === "zh" ? "zh-CN" : "en-US",
                    {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}`
                : t("knowledge.syncing")}
            </span>
          </div>

          {overviewError ? (
            <div className={styles.overviewUnavailable}>
              <ShieldAlert size={15} />
              <span>{overviewError}</span>
              <button
                type="button"
                onClick={() => void loadOverview(true)}
              >
                {t("documents.retry")}
              </button>
            </div>
          ) : (
            <div className={styles.overviewGrid}>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <Files size={14} />
                  {t("knowledge.documents")}
                </span>
                <strong>{overview ? numberLabel(overview.documents) : "—"}</strong>
                <small>{t("knowledge.documentsHint")}</small>
              </div>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <BookOpen size={14} />
                  {t("knowledge.pages")}
                </span>
                <strong>{overview ? numberLabel(overview.pages) : "—"}</strong>
                <small>{t("knowledge.pagesHint")}</small>
              </div>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <Layers size={14} />
                  {t("knowledge.chunks")}
                </span>
                <strong>{overview ? numberLabel(overview.chunks) : "—"}</strong>
                <small>{t("knowledge.chunksHint")}</small>
              </div>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <ScanText size={14} />
                  {t("knowledge.ocrPages")}
                </span>
                <strong>{overview ? numberLabel(overview.ocr_pages) : "—"}</strong>
                <small>{t("knowledge.ocrPagesHint")}</small>
              </div>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <GitBranch size={14} />
                  {t("knowledge.citationEdges")}
                </span>
                <strong>
                  {overview ? numberLabel(overview.citation_edges) : "—"}
                </strong>
                <small>{t("knowledge.citationEdgesHint")}</small>
              </div>
              <div className={styles.overviewMetric}>
                <span className={styles.overviewLabel}>
                  <Table2 size={14} />
                  {t("knowledge.structuredEvidence")}
                </span>
                <strong>
                  {overview?.structured_evidence
                    ? numberLabel(
                        overview.structured_evidence.tables +
                          overview.structured_evidence.formulas +
                          overview.structured_evidence.figures,
                      )
                    : "—"}
                </strong>
                <small>
                  {overview?.structured_evidence
                    ? `${overview.structured_evidence.tables} T · ${overview.structured_evidence.formulas} F · ${overview.structured_evidence.figures} Fig`
                    : t("knowledge.structuredEvidenceHint")}
                </small>
              </div>
              <div
                className={styles.overviewMetric}
                data-health={overview?.health.status ?? "empty"}
              >
                <span className={styles.overviewLabel}>
                  <Activity size={14} />
                  {t("knowledge.health")}
                </span>
                <strong>
                  {overview ? numberLabel(overview.health.score) : "—"}
                  {overview ? <em>%</em> : null}
                </strong>
                <div className={styles.healthTrack}>
                  <span
                    style={{
                      width: `${overview?.health.score ?? 0}%`,
                    }}
                  />
                </div>
                <small>
                  {overview
                    ? healthLabel(overview.health.status)
                    : t("knowledge.syncing")}
                </small>
              </div>
            </div>
          )}
        </section>

        {isAdmin ? (
          <section className={styles.uploadPanel}>
            <div className={styles.uploadText}>
              <Upload size={18} />
              <span>
                <strong>{t("documents.uploadPdf")}</strong>
                <small>{t("documents.uploadHint")}</small>
              </span>
            </div>
            <input
              ref={fileInput}
              className={styles.hiddenInput}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={selectPdf}
              aria-label={t("documents.selectPdf")}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              <Files size={14} />
              {selectedFiles.length
                ? `${selectedFiles.length} ${t("documents.filesSelected")}`
                : t("documents.selectPdf")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!selectedFiles.length || uploading}
              onClick={() => void uploadPdfs()}
            >
              {uploading ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Upload size={14} />
              )}
              {uploading && uploadProgress.total
                ? `${uploadProgress.done}/${uploadProgress.total}`
                : t("documents.uploadBatch")}
            </button>
          </section>
        ) : null}

        {isAdmin && selectedFiles.length ? (
          <section className={styles.batchQueue}>
            <div className={styles.batchQueueTitle}>
              <Files size={15} />
              <strong>{t("documents.batchQueue")}</strong>
              <span>{selectedFiles.length}</span>
            </div>
            <div className={styles.batchFileList}>
              {selectedFiles.slice(0, 6).map((file) => (
                <span key={`${file.name}-${file.lastModified}`}>
                  {file.name}
                </span>
              ))}
              {selectedFiles.length > 6 ? (
                <span>+{selectedFiles.length - 6}</span>
              ) : null}
            </div>
          </section>
        ) : null}

        {duplicatePrompt && duplicateMatch ? (
          <section className={styles.duplicatePanel}>
            <div className={styles.duplicateHeader}>
              <ShieldAlert size={18} />
              <div>
                <h2>{t("documents.duplicateTitle")}</h2>
                <p>{duplicateSummary}</p>
              </div>
            </div>
            <div className={styles.duplicateGrid}>
              <div>
                <span>{t("documents.incomingFile")}</span>
                <strong>{duplicatePrompt.file.name}</strong>
                <small>
                  {versionLabel(duplicatePrompt.preflight.version)}
                  {duplicatePrompt.preflight.canonical_id
                    ? ` · ${duplicatePrompt.preflight.canonical_id}`
                    : ""}
                </small>
              </div>
              <div>
                <span>{t("documents.existingFile")}</span>
                <strong>{duplicateMatch.existing_name}</strong>
                <small>{versionLabel(duplicateMatch.existing_version)}</small>
              </div>
              <div>
                <span>{t("documents.versionRelation")}</span>
                <strong>
                  {relationshipLabel(duplicateMatch.relationship, locale)}
                </strong>
                <small>
                  {t("documents.textChange")}{" "}
                  {(duplicateMatch.changed_ratio * 100).toFixed(1)}%
                </small>
              </div>
            </div>
            {duplicateMatch.changes.added.length ||
            duplicateMatch.changes.removed.length ? (
              <div className={styles.diffGrid}>
                <div>
                  <span>{t("documents.addedText")}</span>
                  {duplicateMatch.changes.added.length ? (
                    duplicateMatch.changes.added.map((item, index) => (
                      <p key={`added-${index}`}>{item}</p>
                    ))
                  ) : (
                    <p>—</p>
                  )}
                </div>
                <div>
                  <span>{t("documents.removedText")}</span>
                  {duplicateMatch.changes.removed.length ? (
                    duplicateMatch.changes.removed.map((item, index) => (
                      <p key={`removed-${index}`}>{item}</p>
                    ))
                  ) : (
                    <p>—</p>
                  )}
                </div>
              </div>
            ) : null}
            <div className={styles.duplicateActions}>
              <button
                className={
                  duplicateMatch.recommendation === "keep_existing"
                    ? "primary-button"
                    : "secondary-button"
                }
                type="button"
                onClick={() => void resolveDuplicate("keep_existing")}
              >
                {t("documents.keepExisting")}
              </button>
              <button
                className={
                  duplicateMatch.recommendation === "keep_incoming"
                    ? "primary-button"
                    : "secondary-button"
                }
                type="button"
                onClick={() => void resolveDuplicate("replace")}
              >
                <GitCompareArrows size={14} />
                {t("documents.replaceExisting")}
              </button>
              <button
                className={
                  duplicateMatch.recommendation === "review"
                    ? "primary-button"
                    : "secondary-button"
                }
                type="button"
                onClick={() => void resolveDuplicate("coexist")}
              >
                {t("documents.keepBoth")}
              </button>
              <button
                className={styles.cancelButton}
                type="button"
                onClick={() => void resolveDuplicate("cancel")}
              >
                {t("documents.cancelRemaining")}
              </button>
            </div>
          </section>
        ) : null}

        {isAdmin ? (
          <section className={styles.jobsPanel}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <Clock3 size={16} />
                <h2>{t("documents.queue")}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => void refresh(true)}
                aria-label={t("system.refresh")}
              >
                <RefreshCw className={loading ? "spin" : ""} size={14} />
              </button>
            </div>
            <div className={styles.jobList}>
              {!jobs.length ? (
                <div className={styles.jobsEmpty}>
                  {loading ? t("common.loading") : t("documents.noJobs")}
                </div>
              ) : null}
              {jobs.map((job) => {
                const active =
                  job.status === "queued" || job.status === "running";
                return (
                  <article className={styles.job} key={job.id}>
                    <span
                      className={
                        job.status === "failed"
                          ? styles.jobFailed
                          : job.status === "completed"
                            ? styles.jobComplete
                            : styles.jobActive
                      }
                    >
                      {job.status === "completed" ? (
                        <CheckCircle2 size={15} />
                      ) : job.status === "failed" ? (
                        <XCircle size={15} />
                      ) : (
                        <Loader2 className="spin" size={15} />
                      )}
                    </span>
                    <div className={styles.jobBody}>
                      <div className={styles.jobTitle}>
                        <strong>{job.fileName}</strong>
                        <span>{sizeLabel(job.size)}</span>
                      </div>
                      <div className={styles.jobStatus}>
                        {jobStatus(job)}
                        {job.error ? `: ${job.error}` : ""}
                      </div>
                      <div className={styles.progressTrack}>
                        <span
                          style={{
                            width: `${Math.max(
                              job.status === "failed" ? 0 : job.progress,
                              active ? 15 : 0,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    {job.status === "failed" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={pendingJob === job.id}
                        onClick={() => void retryJob(job.id)}
                      >
                        {pendingJob === job.id ? (
                          <Loader2 className="spin" size={13} />
                        ) : null}
                        {t("documents.retry")}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <Search size={15} />
            <input
              aria-label={t("documents.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("documents.searchPlaceholder")}
            />
          </label>
          <span className={styles.smallMuted}>
            {filtered.length} {t("documents.results")}
          </span>
        </div>
        <div className={styles.tableShell}>
          <table className={styles.documentTable}>
            <thead>
              <tr>
                <th>{t("documents.document")}</th>
                <th>{t("documents.size")}</th>
                <th>{t("documents.tokens")}</th>
                <th>{t("documents.parser")}</th>
                <th>{t("documents.status")}</th>
                {isAdmin ? <th>{t("admin.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading && !filtered.length ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5}>
                    <div className={styles.loadingState}>
                      {t("common.loading")}
                    </div>
                  </td>
                </tr>
              ) : null}
              {filtered.map((file) => (
                <tr key={file.id}>
                  <td>
                    <div className={styles.documentName}>
                      <FileText size={15} />
                      <span title={file.name}>{file.name}</span>
                    </div>
                  </td>
                  <td>{sizeLabel(file.size)}</td>
                  <td>
                    {file.note?.tokens
                      ? file.note.tokens.toLocaleString("zh-CN")
                      : "—"}
                  </td>
                  <td>{file.note?.loader ?? t("documents.pending")}</td>
                  <td>
                    <span className={styles.sourceBadge}>
                      {file.note?.loader
                        ? t("documents.indexedStatus")
                        : t("documents.registeredStatus")}
                    </span>
                  </td>
                  {isAdmin ? (
                    <td>
                      <button
                        className={styles.deleteButton}
                        type="button"
                        disabled={pendingDelete === file.id}
                        onClick={() => void deleteDocument(file)}
                      >
                        {pendingDelete === file.id ? (
                          <Loader2 className="spin" size={13} />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        {t("documents.delete")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
