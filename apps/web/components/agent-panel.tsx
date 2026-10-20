"use client";

import {
  Activity,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  FileSpreadsheet,
  Loader2,
  Play,
  PenLine,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { useLanguage } from "./language-provider";
import styles from "./agent-panel.module.css";

export type AgentTraceEvent = {
  id: string;
  kind: "plan" | "retrieval" | "model" | "tool" | "result" | "error";
  title: string;
  title_zh?: string;
  detail?: string;
  status: "running" | "success" | "error" | "info";
  phase?: "plan" | "call" | "observe" | "replan" | "complete";
  iteration?: number;
  tool?: string;
  arguments?: Record<string, unknown>;
  resultPreview?: string;
  durationMs?: number;
  createdAt?: number;
};

type ArxivResult = {
  status: "indexed" | "duplicate";
  arxiv_id: string;
  title?: string;
  version?: number;
  files?: Array<{ name: string }>;
  matches?: Array<{
    existing_name: string;
    existing_version: number;
    relationship: string;
  }>;
  steps?: Array<{
    id: string;
    title: string;
    detail?: string;
    status: string;
    duration_ms?: number;
  }>;
};

type CsvResult = {
  status: "completed";
  file_name: string;
  caption: string;
  profile: {
    rows: number;
    columns: number;
  };
  chart: {
    type: string;
    x: string;
    y: string;
    base64: string;
  };
  scripts: {
    mermaid: string;
    tikz: string;
  };
  steps?: Array<{
    id: string;
    title: string;
    detail?: string;
    status: string;
    duration_ms?: number;
  }>;
};

type WritingResult = {
  status: "completed";
  framework: string;
  references: Array<{
    key: string;
    title: string;
    year?: number;
    formatted: string;
  }>;
  bibtex: string;
  model: string;
  steps?: Array<{
    id: string;
    title: string;
    detail?: string;
    status: string;
    duration_ms?: number;
  }>;
};

export function AgentPanel({
  open,
  events,
  onClose,
  onTrace,
  onClear,
  onFilesChanged,
  selectedFileIds,
}: {
  open: boolean;
  events: AgentTraceEvent[];
  onClose: () => void;
  onTrace: (event: AgentTraceEvent) => void;
  onClear: () => void;
  onFilesChanged: () => void;
  selectedFileIds: string[];
}) {
  const { locale, t } = useLanguage();
  const [tab, setTab] = useState<
    "trace" | "arxiv" | "csv" | "writing"
  >("trace");
  const [arxivId, setArxivId] = useState("");
  const [arxivRunning, setArxivRunning] = useState(false);
  const [arxivResult, setArxivResult] = useState<ArxivResult>();
  const [arxivError, setArxivError] = useState("");
  const [csvFile, setCsvFile] = useState<File>();
  const [csvQuestion, setCsvQuestion] = useState("");
  const [csvRunning, setCsvRunning] = useState(false);
  const [csvResult, setCsvResult] = useState<CsvResult>();
  const [csvError, setCsvError] = useState("");
  const [codeTab, setCodeTab] = useState<"mermaid" | "tikz">("mermaid");
  const [copiedScript, setCopiedScript] = useState(false);
  const [writingIdea, setWritingIdea] = useState("");
  const [writingRunning, setWritingRunning] = useState(false);
  const [writingResult, setWritingResult] = useState<WritingResult>();
  const [writingError, setWritingError] = useState("");
  const [copiedWriting, setCopiedWriting] = useState<
    "framework" | "bibtex"
  >();
  const csvInputRef = useRef<HTMLInputElement>(null);

  function eventTitle(event: AgentTraceEvent) {
    return locale === "zh" ? event.title_zh ?? event.title : event.title;
  }

  function appendSteps(
    parentId: string,
    steps:
      | Array<{
          id: string;
          title: string;
          detail?: string;
          status: string;
          duration_ms?: number;
        }>
      | undefined,
  ) {
    for (const step of steps ?? []) {
      onTrace({
        id: `${parentId}-${step.id}`,
        kind: "tool",
        title: step.title,
        detail: step.detail,
        status: step.status === "error" ? "error" : "success",
        durationMs: step.duration_ms,
        createdAt: Date.now(),
      });
    }
  }

  async function runArxiv() {
    const identifier = arxivId.trim();
    if (!identifier || arxivRunning) return;
    const parentId = `arxiv-${crypto.randomUUID()}`;
    setArxivRunning(true);
    setArxivError("");
    setArxivResult(undefined);
    onTrace({
      id: parentId,
      kind: "tool",
      title: "Download and index arXiv paper",
      title_zh: "下载并索引 arXiv 论文",
      detail: identifier,
      status: "running",
      createdAt: Date.now(),
    });
    try {
      const response = await fetch("/api/tools/arxiv", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? t("agent.runFailed"),
        );
      }
      appendSteps(parentId, payload.steps);
      setArxivResult(payload as ArxivResult);
      onTrace({
        id: parentId,
        kind: payload.status === "duplicate" ? "result" : "tool",
        title:
          payload.status === "duplicate"
            ? "Research paper already indexed"
            : "arXiv paper indexed",
        title_zh:
          payload.status === "duplicate"
            ? "论文已存在于文档库"
            : "arXiv 论文已入库",
        detail:
          payload.status === "duplicate"
            ? `${payload.matches?.[0]?.existing_name ?? "Existing paper"}`
            : payload.title,
        status: "success",
        durationMs: payload.steps?.reduce(
          (sum: number, step: { duration_ms?: number }) =>
            sum + Number(step.duration_ms ?? 0),
          0,
        ),
        createdAt: Date.now(),
      });
      if (payload.status === "indexed") onFilesChanged();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : t("agent.runFailed");
      setArxivError(message);
      onTrace({
        id: parentId,
        kind: "error",
        title: "arXiv tool failed",
        title_zh: "arXiv 工具执行失败",
        detail: message,
        status: "error",
        createdAt: Date.now(),
      });
    } finally {
      setArxivRunning(false);
    }
  }

  function selectCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCsvError("");
    setCsvResult(undefined);
    if (
      !file ||
      !file.name.toLowerCase().endsWith(".csv") ||
      file.size > 10 * 1024 * 1024
    ) {
      setCsvFile(undefined);
      if (file) setCsvError(t("agent.invalidCsv"));
      return;
    }
    setCsvFile(file);
  }

  async function runCsv() {
    if (!csvFile || csvRunning) return;
    const parentId = `csv-${crypto.randomUUID()}`;
    setCsvRunning(true);
    setCsvError("");
    setCsvResult(undefined);
    setCodeTab("mermaid");
    setCopiedScript(false);
    onTrace({
      id: parentId,
      kind: "tool",
      title: "Analyze CSV with pandas",
      title_zh: "使用 pandas 分析 CSV",
      detail: csvFile.name,
      status: "running",
      createdAt: Date.now(),
    });
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("question", csvQuestion);
      const response = await fetch("/api/tools/csv", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? t("agent.runFailed"),
        );
      }
      appendSteps(parentId, payload.steps);
      setCsvResult(payload as CsvResult);
      onTrace({
        id: parentId,
        kind: "result",
        title: "CSV analysis completed",
        title_zh: "CSV 分析完成",
        detail: `${payload.profile.rows} rows · ${payload.profile.columns} columns`,
        status: "success",
        durationMs: payload.steps?.reduce(
          (sum: number, step: { duration_ms?: number }) =>
            sum + Number(step.duration_ms ?? 0),
          0,
        ),
        createdAt: Date.now(),
      });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : t("agent.runFailed");
      setCsvError(message);
      onTrace({
        id: parentId,
        kind: "error",
        title: "CSV tool failed",
        title_zh: "CSV 工具执行失败",
        detail: message,
        status: "error",
        createdAt: Date.now(),
      });
    } finally {
      setCsvRunning(false);
    }
  }

  async function copyScript() {
    if (!csvResult) return;
    const text =
      codeTab === "mermaid"
        ? csvResult.scripts.mermaid
        : csvResult.scripts.tikz;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiedScript(true);
    window.setTimeout(() => setCopiedScript(false), 1400);
  }

  async function runWriting() {
    const idea = writingIdea.trim();
    if (!idea || writingRunning) return;
    const parentId = `writing-${crypto.randomUUID()}`;
    setWritingRunning(true);
    setWritingError("");
    setWritingResult(undefined);
    setCopiedWriting(undefined);
    onTrace({
      id: parentId,
      kind: "tool",
      title: "Generate paper framework",
      title_zh: "生成论文框架",
      detail: idea.slice(0, 180),
      status: "running",
      createdAt: Date.now(),
    });
    try {
      const response = await fetch("/api/tools/writing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          fileIds: selectedFileIds.length ? selectedFileIds : null,
          language: locale,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? t("agent.runFailed"),
        );
      }
      appendSteps(parentId, payload.steps);
      setWritingResult(payload as WritingResult);
      onTrace({
        id: parentId,
        kind: "result",
        title: "Paper framework and References ready",
        title_zh: "论文框架与 References 已生成",
        detail: `${payload.references?.length ?? 0} grounded reference(s)`,
        status: "success",
        durationMs: payload.steps?.reduce(
          (sum: number, step: { duration_ms?: number }) =>
            sum + Number(step.duration_ms ?? 0),
          0,
        ),
        createdAt: Date.now(),
      });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : t("agent.runFailed");
      setWritingError(message);
      onTrace({
        id: parentId,
        kind: "error",
        title: "Writing tool failed",
        title_zh: "论文框架工具执行失败",
        detail: message,
        status: "error",
        createdAt: Date.now(),
      });
    } finally {
      setWritingRunning(false);
    }
  }

  async function copyWriting(kind: "framework" | "bibtex") {
    if (!writingResult) return;
    const text =
      kind === "framework"
        ? writingResult.framework
        : writingResult.bibtex;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiedWriting(kind);
    window.setTimeout(() => setCopiedWriting(undefined), 1400);
  }

  if (!open) return null;

  return (
    <aside className={styles.panel} aria-label={t("agent.title")}>
      <header className={styles.panelHeader}>
        <div>
          <Activity size={17} />
          <span>
            <strong>{t("agent.title")}</strong>
            <small>{events.length} trace events</small>
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("agent.close")}
          title={t("agent.close")}
        >
          <X size={15} />
        </button>
      </header>

      <nav className={styles.tabs}>
        <button
          className={tab === "trace" ? styles.activeTab : ""}
          type="button"
          onClick={() => setTab("trace")}
        >
          <Activity size={13} />
          Trace
        </button>
        <button
          className={tab === "arxiv" ? styles.activeTab : ""}
          type="button"
          onClick={() => setTab("arxiv")}
        >
          <Download size={13} />
          arXiv
        </button>
        <button
          className={tab === "csv" ? styles.activeTab : ""}
          type="button"
          onClick={() => setTab("csv")}
        >
          <FileSpreadsheet size={13} />
          CSV
        </button>
        <button
          className={tab === "writing" ? styles.activeTab : ""}
          type="button"
          onClick={() => setTab("writing")}
        >
          <PenLine size={13} />
          Writing
        </button>
      </nav>

      <div className={styles.panelBody}>
        {tab === "trace" ? (
          <div className={styles.traceList}>
            {!events.length ? (
              <div className={styles.empty}>{t("agent.emptyTrace")}</div>
            ) : null}
            {events.map((event, index) => (
              <article
                className={`${styles.traceEvent} ${
                  event.status === "running"
                    ? styles.eventRunning
                    : event.status === "error"
                      ? styles.eventError
                      : ""
                }`}
                key={event.id}
              >
                <span className={styles.traceIndex}>{index + 1}</span>
                <div>
                  <div className={styles.traceTitle}>
                    <strong>{eventTitle(event)}</strong>
                    {event.status === "running" ? (
                      <Loader2 className="spin" size={12} />
                    ) : null}
                  </div>
                  {event.detail ? <p>{event.detail}</p> : null}
                  <div className={styles.traceMeta}>
                    <span>{event.kind}</span>
                    {event.phase ? <span>{event.phase}</span> : null}
                    {event.iteration ? (
                      <span>step {event.iteration}</span>
                    ) : null}
                    {event.tool ? <span>{event.tool}</span> : null}
                    {event.durationMs ? (
                      <span>{event.durationMs} ms</span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {tab === "arxiv" ? (
          <div className={styles.toolForm}>
            <h3>{t("agent.arxivTitle")}</h3>
            <p>{t("agent.arxivHint")}</p>
            <label>
              <span>{t("agent.arxivId")}</span>
              <input
                value={arxivId}
                onChange={(event) => setArxivId(event.target.value)}
                placeholder="1706.03762 or https://arxiv.org/abs/..."
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!arxivId.trim() || arxivRunning}
              onClick={() => void runArxiv()}
            >
              {arxivRunning ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Play size={14} />
              )}
              {t("agent.runTool")}
            </button>
            {arxivError ? (
              <div className="error-banner">{arxivError}</div>
            ) : null}
            {arxivResult ? (
              <section className={styles.toolResult}>
                <span>
                  {arxivResult.status === "duplicate"
                    ? t("agent.duplicate")
                    : t("agent.indexed")}
                </span>
                <strong>{arxivResult.title ?? arxivResult.arxiv_id}</strong>
                {arxivResult.status === "duplicate" ? (
                  <p>
                    {arxivResult.matches?.[0]?.existing_name} v
                    {arxivResult.matches?.[0]?.existing_version}
                  </p>
                ) : (
                  <p>
                    {arxivResult.files
                      ?.map((file) => file.name)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "csv" ? (
          <div className={styles.toolForm}>
            <h3>{t("agent.csvTitle")}</h3>
            <p>{t("agent.csvHint")}</p>
            <input
              ref={csvInputRef}
              className={styles.hiddenInput}
              type="file"
              accept=".csv,text/csv"
              onChange={selectCsv}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => csvInputRef.current?.click()}
            >
              <FileSpreadsheet size={14} />
              {csvFile?.name ?? t("agent.selectCsv")}
            </button>
            <label>
              <span>{t("agent.csvQuestion")}</span>
              <textarea
                value={csvQuestion}
                onChange={(event) => setCsvQuestion(event.target.value)}
                placeholder={t("agent.csvQuestionPlaceholder")}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!csvFile || csvRunning}
              onClick={() => void runCsv()}
            >
              {csvRunning ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <Play size={14} />
              )}
              {t("agent.runTool")}
            </button>
            {csvError ? (
              <div className="error-banner">{csvError}</div>
            ) : null}
            {csvResult ? (
              <section className={styles.csvResult}>
                <img
                  src={`data:image/png;base64,${csvResult.chart.base64}`}
                  alt={t("agent.csvChartAlt")}
                />
                <div>
                  <strong>
                    {csvResult.profile.rows} × {csvResult.profile.columns}
                  </strong>
                  <p>{csvResult.caption}</p>
                </div>
                <div className={styles.scriptBlock}>
                  <div className={styles.scriptHeader}>
                    <div>
                      <button
                        type="button"
                        className={
                          codeTab === "mermaid"
                            ? styles.activeScriptTab
                            : ""
                        }
                        onClick={() => setCodeTab("mermaid")}
                      >
                        <Code2 size={12} />
                        {t("agent.mermaid")}
                      </button>
                      <button
                        type="button"
                        className={
                          codeTab === "tikz" ? styles.activeScriptTab : ""
                        }
                        onClick={() => setCodeTab("tikz")}
                      >
                        <Code2 size={12} />
                        {t("agent.tikz")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyScript()}
                      title={t("agent.copyScript")}
                    >
                      {copiedScript ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                      {copiedScript
                        ? t("agent.copied")
                        : t("agent.copyScript")}
                    </button>
                  </div>
                  <pre>
                    <code>
                      {codeTab === "mermaid"
                        ? csvResult.scripts.mermaid
                        : csvResult.scripts.tikz}
                    </code>
                  </pre>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "writing" ? (
          <div className={styles.toolForm}>
            <h3>{t("agent.writingTitle")}</h3>
            <p>{t("agent.writingHint")}</p>
            <div className={styles.sourceScope}>
              <FileText size={13} />
              <span>
                {selectedFileIds.length
                  ? `${selectedFileIds.length} ${t("agent.selectedSources")}`
                  : t("agent.allSources")}
              </span>
            </div>
            <label>
              <span>{t("agent.researchIdea")}</span>
              <textarea
                value={writingIdea}
                onChange={(event) => setWritingIdea(event.target.value)}
                placeholder={t("agent.researchIdeaPlaceholder")}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!writingIdea.trim() || writingRunning}
              onClick={() => void runWriting()}
            >
              {writingRunning ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <PenLine size={14} />
              )}
              {t("agent.generatePaper")}
            </button>
            {writingError ? (
              <div className="error-banner">{writingError}</div>
            ) : null}
            {writingResult ? (
              <section className={styles.writingResult}>
                <div className={styles.writingActions}>
                  <span>
                    {writingResult.references.length}{" "}
                    {t("agent.groundedReferences")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyWriting("framework")}
                  >
                    {copiedWriting === "framework" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedWriting === "framework"
                      ? t("agent.copied")
                      : t("agent.copyFramework")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyWriting("bibtex")}
                  >
                    {copiedWriting === "bibtex" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedWriting === "bibtex"
                      ? t("agent.copied")
                      : t("agent.copyBibtex")}
                  </button>
                </div>
                <pre className={styles.writingDraft}>
                  <code>{writingResult.framework}</code>
                </pre>
                <details>
                  <summary>{t("agent.referenceList")}</summary>
                  <ol className={styles.generatedReferences}>
                    {writingResult.references.map((reference) => (
                      <li key={reference.key}>
                        <span>{reference.formatted}</span>
                      </li>
                    ))}
                  </ol>
                </details>
                <details>
                  <summary>BibTeX</summary>
                  <pre className={styles.bibtex}>
                    <code>{writingResult.bibtex}</code>
                  </pre>
                </details>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className={styles.panelFooter}>
        <button type="button" onClick={onClear}>
          <Trash2 size={12} />
          {t("agent.clear")}
        </button>
      </footer>
    </aside>
  );
}
