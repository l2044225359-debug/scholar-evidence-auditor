"use client";

import {
  Activity,
  BookOpen,
  Bot,
  Check,
  Copy,
  Cpu,
  ExternalLink,
  FileText,
  Gauge,
  Library,
  Loader2,
  Network,
  Send,
  Sparkles,
  Square,
  Volume2,
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
import type { Locale } from "@/lib/i18n";

import {
  AgentPanel,
  type AgentTraceEvent,
} from "./agent-panel";
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

function renderInline(
  value: string,
  onCitation?: (index: number) => void,
): ReactNode[] {
  const parts = cleanAnswer(value).split(/(\*\*[^*]+\*\*|【\d+】)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^【\d+】$/.test(part)) {
      return (
        <button
          type="button"
          className={styles.citationMark}
          key={index}
          onClick={() => onCitation?.(Number(part.slice(1, -1)) - 1)}
        >
          {part}
        </button>
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

function demoMessages(locale: Locale): ChatMessage[] {
  return [
    {
      id: "demo-user",
      role: "user",
      demo: true,
      content:
        locale === "zh"
          ? "示例问题：Transformer 的核心机制是什么？"
          : "Example question: What is the Transformer's core mechanism?",
    },
    {
      id: "demo-assistant",
      role: "assistant",
      demo: true,
      content:
        locale === "zh"
          ? "**示例结论：** Transformer 完全基于注意力机制，摒弃循环与卷积，并通过多头自注意力在不同表示子空间中并行建模【1】【2】。编码器与解码器均由 6 层堆栈构成，位置编码负责注入序列顺序【3】。"
          : "**Example answer:** The Transformer relies entirely on attention, dispensing with recurrence and convolutions, and uses multi-head attention across representation subspaces【1】【2】. Both encoder and decoder stack six layers, with positional encodings supplying sequence order【3】.",
    },
  ];
}

const demoCitations: Citation[] = [
  {
    file_name: "attention.pdf",
    page: 1,
    snippet:
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
    scores: { reranking_score: 0.71 },
    preview_url: null,
  },
  {
    file_name: "attention.pdf",
    page: 3,
    snippet:
      "The encoder is composed of a stack of N = 6 identical layers. Each layer has two sub-layers.",
    scores: { reranking_score: 0.67 },
    preview_url: null,
  },
];

export function Workspace() {
  const { locale, t } = useLanguage();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    demoMessages(locale),
  );
  const [demoSeeded, setDemoSeeded] = useState(true);
  const [citations, setCitations] = useState<Citation[]>(demoCitations);
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
  const [copiedMessage, setCopiedMessage] = useState<string>();
  const [speakingMessage, setSpeakingMessage] = useState<string>();
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceEvents, setTraceEvents] = useState<AgentTraceEvent[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | undefined>(undefined);

  function upsertTrace(event: AgentTraceEvent) {
    setTraceEvents((current) => {
      const index = current.findIndex((item) => item.id === event.id);
      if (index < 0) return [...current, event];
      const next = [...current];
      next[index] = { ...next[index], ...event };
      return next;
    });
  }

  async function refreshFiles() {
    const response = await fetch("/api/files", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(t("workspace.loadDocumentsError"));
    }
    const data = await response.json();
    setFiles(data.items ?? []);
  }

  useEffect(() => {
    if (demoSeeded) setMessages(demoMessages(locale));
  }, [demoSeeded, locale]);

  useEffect(() => {
    if (locale === "zh") stopVoice();
  }, [locale]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshFiles()
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
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

  const suggestions =
    locale === "zh"
      ? [
          "Transformer 的核心机制是什么？",
          "RAG 与 DPR 的关键区别是什么？",
          "Self-RAG 如何减少检索增强生成的幻觉？",
        ]
      : [
          "What is the core mechanism of the Transformer?",
          "How do RAG and DPR differ?",
          "How does Self-RAG reduce hallucination?",
        ];

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

    const previousMessages = demoSeeded ? [] : messages;
    if (demoSeeded) setDemoSeeded(false);
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
    const requestStartedAt = Date.now();

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
          language: locale,
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

          if (event === "trace") {
            upsertTrace({
              id: String(data.id ?? crypto.randomUUID()),
              kind: data.kind ?? "tool",
              title: String(data.title ?? "Agent step"),
              title_zh: data.title_zh,
              detail: data.detail,
              status:
                data.status === "running" ||
                data.status === "error" ||
                data.status === "info"
                  ? data.status
                  : "success",
              durationMs: data.duration_ms,
              createdAt: Date.now(),
            });
          } else if (event === "meta" && data.conversation_id) {
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
            upsertTrace({
              id: `chat-complete-${assistantId}`,
              kind: "result",
              title: "Answer complete",
              title_zh: "回答完成",
              detail: `${data.citations?.length ?? 0} citation anchor(s)`,
              status: "success",
              durationMs: Date.now() - requestStartedAt,
              createdAt: Date.now(),
            });
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
      upsertTrace({
        id: `chat-error-${assistantId}`,
        kind: "error",
        title: "Chat failed",
        title_zh: "聊天失败",
        detail,
        status: "error",
        createdAt: Date.now(),
      });
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

  async function copyMessage(id: string, content: string) {
    const text = cleanAnswer(content);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
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
    setCopiedMessage(id);
    window.setTimeout(() => {
      setCopiedMessage((current) => (current === id ? undefined : current));
    }, 1600);
  }

  function focusEvidence(index: number) {
    const element = document.getElementById(`evidence-${index}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  }

  function stopVoice() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = undefined;
    }
    setSpeakingMessage(undefined);
  }

  async function speakMessage(id: string, content: string) {
    if (speakingMessage === id) {
      stopVoice();
      return;
    }
    stopVoice();
    setSpeakingMessage(id);
    setError("");
    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanAnswer(content),
          speaker: "Carter",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ??
            payload.error ??
            (locale === "zh"
              ? "语音服务暂不可用"
              : "Voice service is unavailable"),
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = () => stopVoice();
      await audio.play();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : locale === "zh"
            ? "语音服务暂不可用"
            : "Voice service is unavailable",
      );
      stopVoice();
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
          <button
            className={`${styles.agentButton} ${
              traceOpen ? styles.agentButtonActive : ""
            }`}
            type="button"
            onClick={() => setTraceOpen((current) => !current)}
            aria-label={t("agent.open")}
          >
            <Activity size={13} />
            {t("agent.title")}
            <span>{traceEvents.length}</span>
          </button>
          <span className="tag accent">
            <Check size={13} />
            {t("workspace.hybrid")}
          </span>
          <span className="tag">
            <Network size={12} />
            {routeInfo.model ?? t("workspace.autoRoute")}
          </span>
          <span className="tag">
            {filesLoading
              ? t("common.loading")
              : `${numberFormatter.format(files.length)} ${t("workspace.papers")}`}
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
            <span>{filesLoading ? "…" : files.length}</span>
          </div>
          <div className={styles.fileList}>
            {filesLoading ? (
              <div className={styles.railEmpty}>{t("common.loading")}</div>
            ) : null}
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
                <div className={styles.suggestions}>
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        composerRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
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
                    <div className={styles.messageMeta}>
                      <div className={styles.messageRole}>
                        {isUser ? t("workspace.you") : t("workspace.assistant")}
                        {message.demo
                          ? locale === "zh"
                            ? " · 示例"
                            : " · Example"
                          : ""}
                      </div>
                      {!isUser && message.content ? (
                        <div className={styles.messageActions}>
                          {locale === "en" ? (
                            <button
                              type="button"
                              className={styles.copyButton}
                              aria-label={
                                speakingMessage === message.id
                                  ? "Stop narration"
                                  : "Read answer aloud"
                              }
                              title={
                                speakingMessage === message.id
                                  ? "Stop narration"
                                  : "Read answer aloud"
                              }
                              onClick={() =>
                                void speakMessage(
                                  message.id,
                                  message.content,
                                )
                              }
                            >
                              {speakingMessage === message.id ? (
                                <Square size={11} />
                              ) : (
                                <Volume2 size={12} />
                              )}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.copyButton}
                            aria-label={
                              locale === "zh" ? "复制回答" : "Copy answer"
                            }
                            title={
                              locale === "zh" ? "复制回答" : "Copy answer"
                            }
                            onClick={() =>
                              void copyMessage(message.id, message.content)
                            }
                          >
                            {copiedMessage === message.id ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.messageText}>
                      {message.content ? (
                        renderInline(message.content, focusEvidence)
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
                ref={composerRef}
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
                  id={`evidence-${index}`}
                  tabIndex={-1}
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
                        href={`/reader?path=${encodeURIComponent(
                          citation.preview_url,
                        )}&page=${citation.page ?? 1}`}
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
      <AgentPanel
        open={traceOpen}
        events={traceEvents}
        onClose={() => setTraceOpen(false)}
        onTrace={upsertTrace}
        onClear={() => setTraceEvents([])}
        onFilesChanged={() => {
          void refreshFiles().catch((reason: Error) =>
            setError(reason.message),
          );
        }}
        selectedFileIds={[...selectedFiles]}
      />
    </div>
  );
}
