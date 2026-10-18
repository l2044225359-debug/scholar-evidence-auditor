"use client";

import { FileText, Library, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SourceFile } from "@/lib/types";

import { useLanguage } from "./language-provider";
import styles from "./data-views.module.css";

function sizeLabel(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsView() {
  const { t } = useLanguage();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/files", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("documents.loadError"));
        return response.json();
      })
      .then((data) => setFiles(data.items ?? []))
      .catch((reason: Error) => setError(reason.message));
  }, [t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.name.toLowerCase().includes(needle));
  }, [files, query]);

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
