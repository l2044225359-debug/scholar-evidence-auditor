"use client";

import {
  CheckCircle2,
  Clock3,
  FileText,
  Library,
  Loader2,
  RefreshCw,
  Search,
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

import type { SourceFile } from "@/lib/types";

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

function sizeLabel(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsView() {
  const { t } = useLanguage();
  const { data: session } = useSession();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [jobs, setJobs] = useState<IndexJob[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
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

  const refresh = useCallback(async () => {
    setError("");
    try {
      await Promise.all([loadFiles(), loadJobs()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("documents.loadError"));
    }
  }, [loadFiles, loadJobs, t]);

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
    const file = event.target.files?.[0] ?? null;
    if (
      !file ||
      !file.name.toLowerCase().endsWith(".pdf") ||
      file.size > 100 * 1024 * 1024
    ) {
      setSelectedFile(null);
      if (file) setError(t("documents.invalidPdf"));
      return;
    }
    setSelectedFile(file);
  }

  async function uploadPdf() {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await fetch("/api/admin/documents/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t("documents.invalidPdf"));
      }
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setNotice(t("documents.uploadSuccess"));
      await loadJobs();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("documents.invalidPdf"),
      );
    } finally {
      setUploading(false);
    }
  }

  async function retryJob(id: string) {
    await fetch(`/api/admin/jobs/${id}/retry`, {
      method: "POST",
      credentials: "include",
    });
    await loadJobs();
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
  }

  function jobStatus(job: IndexJob) {
    if (job.status === "queued") return t("documents.waiting");
    if (job.status === "running") return t("documents.processing");
    if (job.status === "completed") return t("documents.completed");
    return t("documents.failed");
  }

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
              onChange={selectPdf}
              aria-label={t("documents.selectPdf")}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              <FileText size={14} />
              {selectedFile?.name ?? t("documents.selectPdf")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!selectedFile || uploading}
              onClick={() => void uploadPdf()}
            >
              {uploading ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Upload size={14} />
              )}
              {t("documents.uploadPdf")}
            </button>
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
                onClick={() => void refresh()}
                aria-label={t("system.refresh")}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className={styles.jobList}>
              {!jobs.length ? (
                <div className={styles.jobsEmpty}>{t("documents.noJobs")}</div>
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
                        onClick={() => void retryJob(job.id)}
                      >
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
                        onClick={() => void deleteDocument(file)}
                      >
                        <Trash2 size={13} />
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
