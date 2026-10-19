"use client";

import { ExternalLink, Network } from "lucide-react";
import { useState } from "react";

import { LocalCitationGraph } from "./local-citation-graph";
import { useLanguage } from "./language-provider";
import styles from "./data-views.module.css";

export function CitationView() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"local" | "online">("local");
  return (
    <div className={styles.citationPage}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t("citations.title")}</h1>
          <p>{t("citations.subtitle")}</p>
        </div>
        <div className={styles.citationHeaderActions}>
          <div className={styles.citationTabs}>
            <button
              type="button"
              className={mode === "local" ? styles.citationTabActive : ""}
              onClick={() => setMode("local")}
            >
              <Network size={13} />
              {t("citations.local")}
            </button>
            <button
              type="button"
              className={mode === "online" ? styles.citationTabActive : ""}
              onClick={() => setMode("online")}
            >
              {t("citations.online")}
            </button>
          </div>
          <a
            className="secondary-button"
            href="/citation-graph/"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={12} />
            {t("citations.open")}
          </a>
        </div>
      </header>
      {mode === "local" ? (
        <LocalCitationGraph />
      ) : (
        <div className={styles.citationFrame}>
          <iframe src="/citation-graph/" title={t("citations.title")} />
        </div>
      )}
    </div>
  );
}
