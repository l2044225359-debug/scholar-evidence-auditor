"use client";

import {
  BookOpen,
  Bot,
  Check,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  Library,
  Loader2,
  Network,
  Send,
  Sparkles,
} from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ChatMessage, Citation, SourceFile } from "@/lib/types";

import { useLanguage } from "./language-provider";
import styles from "./workspace.module.css";

const numberFormatter = new Intl.NumberFormat("zh-CN");

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function cleanAnswer(value: string) {
  return value.replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1");
}

function renderInline(value: string): ReactNode[] {
  const parts = cleanAnswer(value).split(/(\*\*[^*]+\*\*|【\d+】)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^【\d+】$/.test(part)) {
      return (
        <span className={styles.citationMark} key={index}>
          {part}
        </span>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function parseEventBlock(block: string) {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export function Workspace() {
  const { locale, t } = useLanguage();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [modelMode, setModelMode] = useState<"auto" | "fast" | "deep">(
    "auto",
  );
  const [routeInfo, setRouteInfo] = useState<{
    model?: string;
    reason?: string;
    rerank?: string;
  }>({});
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/files", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(t("workspace.loadDocumentsError"));
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setFiles(data.items ?? []);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const selectedLabel = useMemo(() => {
    if (!selectedFiles.size) return t("workspace.allPapers");
    if (selectedFiles.size === 1) {
      const id = [...selectedFiles][0];
      return (
        files.find((file) => file.id === id)?.name ??
        (locale === "zh" ? "1 篇论文" : "1 paper")
      );
    }
    return `${selectedFiles.size} ${t("workspace.papers")}`;
  }, [files, locale, selectedFiles, t]);

  function toggleFile(fileId: string) {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function sendMessage() {
    const message = input.trim();
    if (!message || loading) return;

    const previousMessages = messages;
    const assistantId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    setMessages([
      ...previousMessages,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setError("");
    setCitations([]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          history: previousMessages.map(({ role, content }) => ({
            role,
            content,
          })),
          file_ids: selectedFiles.size ? [...selectedFiles] : null,
          language: "zh",
          citation_mode: "inline",
          model_mode: modelMode,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text();
        throw new Error(detail || "Chat request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseEventBlock(block);
          if (!parsed) continue;
          const { event, data } = parsed;

          if (event === "meta" && data.conversation_id) {
            setConversationId(data.conversation_id);
            setRouteInfo({
              model: data.model,
              reason: data.routing_reason,
              rerank: data.rerank_model,
            });
          } else if (event === "delta") {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? { ...item, content: item.content + data.text }
                  : item,
              ),
            );
          } else if (event === "replace") {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? { ...item, content: data.text ?? "" }
                  : item,
              ),
            );
          } else if (event === "citations") {
            setCitations(data.items ?? []);
          } else if (event === "done") {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? { ...item, content: data.answer ?? item.content }
                  : item,
              ),
            );
            setCitations(data.citations ?? []);
            if (data.conversation_id) {
              setConversationId(data.conversation_id);
            }
            if (data.model) {
              setRouteInfo((current) => ({
                ...current,
                model: data.model,
                reason: data.routing_reason,
              }));
            }
          } else if (event === "error") {
            throw new Error(data.message ?? "Chat stream failed");
          }
        }
      }
    } catch (reason) {
      const detail =
        reason instanceof Error ? reason.message : "Chat request failed";
      setError(detail);
      setMessages((current) =>
        current.filter((item) => item.id !== assistantId),
      );
    } finally {
      setLoading(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div className={styles.workspaceTitle}>
          <h1>{t("workspace.title")}</h1>
          <p>{selectedLabel}</p>
        </div>
        <div className={styles.headerMeta}>
          <div
            className={styles.modelModes}
            aria-label={t("workspace.modelRoute")}
          >
            <button
              type="button"
              className={modelMode === "auto" ? styles.activeMode : ""}
              onClick={() => setModelMode("auto")}
            >
              <Sparkles size={12} />
              {t("workspace.auto")}
            </button>
            <button
              type="button"
              className={modelMode === "fast" ? styles.activeMode : ""}
              onClick={() => setModelMode("fast")}
            >
              <Gauge size={12} />
              {t("workspace.flash")}
            </button>
            <button
              type="button"
              className={modelMode === "deep" ? styles.activeMode : ""}
              onClick={() => setModelMode("deep")}
            >
              <Cpu size={12} />
              {t("workspace.deep")}
            </button>
          </div>
          <span className="tag accent">
            <Check size={13} />
            {t("workspace.hybrid")}
          </span>
          <span className="tag">
            <Network size={12} />
            {routeInfo.model ?? t("workspace.autoRoute")}
          </span>
          <span className="tag">
            {numberFormatter.format(files.length)} {t("workspace.papers")}
          </span>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.fileRail}>
          <div className={styles.railHeader}>
            <div className={styles.railTitle}>
              <Library size={15} />
              {t("workspace.documents")}
            </div>
            <span>{files.length}</span>
          </div>
          <div className={styles.fileList}>
            <button
              type="button"
              className={
                selectedFiles.size
                  ? styles.allFiles
                  : `${styles.allFiles} ${styles.active}`
              }
              onClick={() => setSelectedFiles(new Set())}
            >
              <Library size={15} />
              <span>{t("workspace.allPapers")}</span>
            </button>
            <div className={styles.fileDivider} />
            {files.map((file) => (
              <label className={styles.fileItem} key={file.id}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.id)}
                  onChange={() => toggleFile(file.id)}
                />
                <span>
                  <span className={styles.fileName} title={file.name}>
                    {file.name}
                  </span>
                  <span className={styles.fileMeta}>
                    <span>{sizeLabel(file.size)}</span>
                    {file.note?.loader ? (
                      <span>{file.note.loader.replace("Reader", "")}</span>
                    ) : null}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </aside>

        <section className={styles.chatPane}>
          <div className={styles.chatToolbar}>
            <div className={styles.contextLabel}>
              {t("workspace.context")}: <strong>{selectedLabel}</strong>
            </div>
            <div className={styles.toolbarTags}>
              <span className="tag">Docling + qwen3.5-ocr</span>
              <span className="tag">
                {routeInfo.rerank ?? "qwen3-rerank"}
              </span>
            </div>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}

          <div className={styles.messageList} ref={listRef}>
            {!messages.length ? (
              <div className={styles.emptyConversation}>
                <div className={styles.emptyConversationInner}>
                  <BookOpen size={28} strokeWidth={1.6} />
                  <span>{t("workspace.noConversation")}</span>
                </div>
              </div>
            ) : null}
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <article
                  className={
                    isUser
                      ? `${styles.message} ${styles.messageUser}`
                      : styles.message
                  }
                  key={message.id}
                >
                  {!isUser ? (
                    <span
                      className={`${styles.avatar} ${styles.avatarAssistant}`}
                    >
                      <Bot size={16} />
                    </span>
                  ) : null}
                  <div className={styles.messageBody}>
                    <div className={styles.messageRole}>
                      {isUser ? t("workspace.you") : t("workspace.assistant")}
                    </div>
                    <div className={styles.messageText}>
                      {message.content ? (
                        renderInline(message.content)
                      ) : loading ? (
                        <span className={styles.thinking}>
                          <Loader2 className="spin" size={14} />
                          {t("workspace.retrieving")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isUser ? (
                    <span className={styles.avatar}>{t("workspace.you")}</span>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className={styles.composerWrap}>
            <div className={styles.composer}>
              <textarea
                aria-label={t("workspace.placeholder")}
                placeholder={t("workspace.placeholder")}
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t("workspace.send")}
                disabled={loading || !input.trim()}
                onClick={() => void sendMessage()}
              >
                {loading ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <Send size={17} />
                )}
              </button>
            </div>
          </div>
        </section>

        <aside className={styles.evidenceRail}>
          <div className={styles.evidenceHeader}>
            <div className={styles.evidenceTitle}>
              <FileText size={15} />
              {t("workspace.evidence")}
            </div>
            <span>{citations.length}</span>
          </div>
          <div className={styles.evidenceList}>
            {!citations.length ? (
              <div className={styles.railEmpty}>
                {t("workspace.noEvidence")}
              </div>
            ) : null}
            {citations.map((citation, index) => {
              const displayScore =
                citation.scores.reranking_score ??
                citation.scores.vectorstore_score ??
                citation.scores.relevance_score;
              return (
                <article
                  className={styles.evidenceCard}
                  key={`${citation.file_name}-${citation.page}-${index}`}
                >
                  <div className={styles.evidenceCardHeader}>
                    <div className={styles.evidenceFile}>
                      <FileText size={13} />
                      <span title={citation.file_name}>
                        {citation.file_name}
                      </span>
                    </div>
                    {citation.page ? (
                      <span className={styles.pageBadge}>
                        p.{citation.page}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.evidenceSnippet}>
                    {citation.snippet}
                  </div>
                  <div className={styles.evidenceMeta}>
                    <span>
                      {typeof displayScore === "number"
                        ? `${
                            "reranking_score" in citation.scores
                              ? t("workspace.rerank")
                              : t("workspace.score")
                          } ${displayScore.toFixed(2)}`
                        : t("workspace.indexedSource")}
                    </span>
                    {citation.preview_url ? (
                      <a
                        href={`http://localhost:7860${citation.preview_url}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("workspace.preview")} <ExternalLink size={10} />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
