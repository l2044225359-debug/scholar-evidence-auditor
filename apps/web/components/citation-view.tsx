"use client";

import { ExternalLink, Network } from "lucide-react";

import { useLanguage } from "./language-provider";
import styles from "./data-views.module.css";

const citationUrl =
  process.env.NEXT_PUBLIC_CITATION_GRAPH_URL ?? "http://localhost:8001";

export function CitationView() {
  const { t } = useLanguage();
  return (
    <div className={styles.citationPage}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t("citations.title")}</h1>
          <p>{t("citations.subtitle")}</p>
        </div>
        <a
          className="secondary-button"
          href={citationUrl}
          target="_blank"
          rel="noreferrer"
        >
          <Network size={14} />
          {t("citations.open")}
          <ExternalLink size={12} />
        </a>
      </header>
      <div className={styles.citationFrame}>
        <iframe src={citationUrl} title={t("citations.title")} />
      </div>
    </div>
  );
}
