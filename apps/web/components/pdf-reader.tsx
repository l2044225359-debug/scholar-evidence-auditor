"use client";

import {
  ArrowLeft,
  BookOpen,
  Languages,
  Link2,
  ListTree,
  Loader2,
  RefreshCw,
  ScrollText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useLanguage } from "./language-provider";
import styles from "./pdf-reader.module.css";

type PdfDocument = any;

type TextLine = {
  text: string;
  page: number;
  fontSize: number;
  bold: boolean;
};

type ReaderPage = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
};

type HeadingItem = {
  id: string;
  title: string;
  page: number;
  level: number;
};

type CitationOccurrence = {
  number: number;
  page: number;
  marker: string;
  context: string;
};

type ReferenceEntry = {
  number: number;
  text: string;
  page: number;
  occurrences: CitationOccurrence[];
};

type AnalysisResult = {
  pages: ReaderPage[];
  headings: HeadingItem[];
  references: ReferenceEntry[];
  occurrences: CitationOccurrence[];
  outlineUsed: boolean;
};

type TranslationState = {
  status: "idle" | "loading" | "done" | "error";
  text?: string;
  error?: string;
};

const CITATION_PATTERN = /\[[0-9][0-9,\s–—-]*\]/g;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fileNameFromPath(path: string) {
  try {
    const decoded = decodeURIComponent(path);
    return decoded.split("/").filter(Boolean).pop() ?? "PDF";
  } catch {
    return path.split("/").filter(Boolean).pop() ?? "PDF";
  }
}

function boldFont(fontName: string) {
  return /bold|black|heavy|semibold|demi/i.test(fontName);
}

function expandCitationNumbers(marker: string) {
  const inner = marker.slice(1, -1);
  const numbers = new Set<number>();
  for (const piece of inner.split(/[,，]/)) {
    const range = piece.match(/^\s*(\d+)\s*[–—-]\s*(\d+)\s*$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 100) {
        for (let value = start; value <= end; value += 1) {
          numbers.add(value);
        }
      }
      continue;
    }
    const number = Number(piece.trim());
    if (Number.isInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers];
}

function extractPageText(content: any) {
  const lines: Array<{
    text: string;
    fontSize: number;
    bold: boolean;
  }> = [];
  let buffer = "";
  let fontSize = 10;
  let bold = false;
  let lastY: number | null = null;

  const flush = () => {
    const text = cleanText(buffer);
    if (text) lines.push({ text, fontSize, bold });
    buffer = "";
    fontSize = 10;
    bold = false;
  };

  for (const item of content.items ?? []) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const y = Number(transform[5] ?? 0);
    const itemSize =
      Math.hypot(Number(transform[2] ?? 0), Number(transform[3] ?? 0)) ||
      Number(item.height ?? 0) ||
      10;
    if (
      buffer &&
      lastY !== null &&
      Math.abs(y - lastY) > Math.max(2, itemSize * 0.45)
    ) {
      flush();
    }
    buffer += `${buffer ? " " : ""}${item.str}`;
    fontSize = Math.max(fontSize, itemSize);
    bold = bold || boldFont(String(item.fontName ?? ""));
    lastY = y;
    if (item.hasEOL) flush();
  }
  flush();
  return {
    text: lines.map((line) => line.text).join("\n"),
    lines,
  };
}

function buildFallbackHeadings(allLines: TextLine[]) {
  const weighted = allLines
    .filter((line) => line.text.length > 20)
    .map((line) => line.fontSize)
    .sort((left, right) => left - right);
  const bodySize =
    weighted[Math.floor(weighted.length * 0.55)] ||
    weighted[Math.floor(weighted.length / 2)] ||
    10;
  const ignored =
    /^(abstract|references|bibliography|arxiv|figure|table)\b/i;
  const seen = new Set<string>();
  const headings: HeadingItem[] = [];
  for (const line of allLines) {
    if (
      line.text.length < 4 ||
      line.text.length > 150 ||
      /^\d+$/.test(line.text) ||
      ignored.test(line.text)
    ) {
      continue;
    }
    const ratio = line.fontSize / bodySize;
    const candidate = ratio >= 1.16 || (line.bold && line.text.length < 90);
    if (!candidate) continue;
    const key = `${line.page}:${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const level = ratio >= 1.45 ? 1 : ratio >= 1.24 ? 2 : 3;
    headings.push({
      id: `heading-${line.page}-${headings.length}`,
      title: line.text,
      page: line.page,
      level,
    });
    if (headings.length >= 120) break;
  }
  return headings;
}

async function outlinePageNumber(pdf: PdfDocument, destination: any) {
  try {
    const resolved =
      typeof destination === "string"
        ? await pdf.getDestination(destination)
        : destination;
    const reference = resolved?.[0];
    if (typeof reference === "number") return reference + 1;
    if (reference) {
      return (await pdf.getPageIndex(reference)) + 1;
    }
  } catch {
    // Fall back to the first page.
  }
  return 1;
}

async function buildOutlineHeadings(pdf: PdfDocument) {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const flattened: HeadingItem[] = [];
  async function visit(items: any[], level: number) {
    for (const item of items) {
      const page = await outlinePageNumber(pdf, item.dest);
      flattened.push({
        id: `outline-${flattened.length}`,
        title: cleanText(String(item.title ?? "Untitled")),
        page,
        level,
      });
      if (item.items?.length) await visit(item.items, level + 1);
      if (flattened.length >= 160) return;
    }
  }
  await visit(outline, 1);
  return flattened;
}

function parseCitations(pages: ReaderPage[]) {
  const referenceStart = pages.findIndex((page) =>
    /(?:^|\n)\s*(references|bibliography)\s*(?:\n|$)/i.test(page.text),
  );
  const bodyPages =
    referenceStart >= 0 ? pages.slice(0, referenceStart) : pages;
  const occurrences: CitationOccurrence[] = [];

  for (const page of bodyPages) {
    const matcher = new RegExp(CITATION_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(page.text))) {
      const contextStart = Math.max(0, match.index - 90);
      const contextEnd = Math.min(
        page.text.length,
        match.index + match[0].length + 130,
      );
      for (const number of expandCitationNumbers(match[0])) {
        occurrences.push({
          number,
          page: page.pageNumber,
          marker: match[0],
          context: cleanText(
            page.text.slice(contextStart, contextEnd),
          ),
        });
      }
    }
  }

  const entries: ReferenceEntry[] = [];
  if (referenceStart >= 0) {
    const combined = pages
      .slice(referenceStart)
      .map(
        (page) =>
          `\n[[PAGE:${page.pageNumber}]]\n${page.text}`,
      )
      .join("\n");
    const matcher =
      /(?:^|\n)\s*(?:\[(\d+)\]|(\d+)\.)\s+/gm;
    const matches = [...combined.matchAll(matcher)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const number = Number(match[1] ?? match[2]);
      if (!number) continue;
      const start = (match.index ?? 0) + match[0].length;
      const end = next?.index ?? combined.length;
      const pageMarkers = [
        ...combined.slice(0, match.index ?? 0).matchAll(
          /\[\[PAGE:(\d+)\]\]/g,
        ),
      ];
      const page = Number(
        pageMarkers[pageMarkers.length - 1]?.[1] ?? pages[referenceStart].pageNumber,
      );
      const text = combined
        .slice(start, end)
        .replace(/\[\[PAGE:\d+\]\]\s*/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      entries.push({
        number,
        text,
        page,
        occurrences: occurrences.filter(
          (occurrence) => occurrence.number === number,
        ),
      });
    }
  }
  return { occurrences, references: entries };
}

async function analyzePdf(
  pdf: PdfDocument,
  onProgress: (current: number, total: number) => void,
): Promise<AnalysisResult> {
  const pages: ReaderPage[] = [];
  const allLines: TextLine[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const extracted = extractPageText(content);
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text: extracted.text,
    });
    allLines.push(
      ...extracted.lines.map((line) => ({
        ...line,
        page: pageNumber,
      })),
    );
    onProgress(pageNumber, pdf.numPages);
  }

  const outlineHeadings = await buildOutlineHeadings(pdf);
  const headings =
    outlineHeadings.length > 0
      ? outlineHeadings
      : buildFallbackHeadings(allLines);
  const parsed = parseCitations(pages);
  return {
    pages,
    headings,
    references: parsed.references,
    occurrences: parsed.occurrences,
    outlineUsed: outlineHeadings.length > 0,
  };
}

function CitationText({
  text,
  onCitation,
}: {
  text: string;
  onCitation: (marker: string) => void;
}) {
  const nodes: ReactNode[] = [];
  const matcher = new RegExp(CITATION_PATTERN.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const marker = match[0];
    nodes.push(
      <button
        className={styles.inlineCitation}
        key={`${marker}-${match.index}`}
        type="button"
        onClick={() => onCitation(marker)}
        title={marker}
      >
        {marker}
      </button>,
    );
    lastIndex = match.index + marker.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

function PdfPage({
  pdf,
  page,
  availableWidth,
  zoom,
  scrollRoot,
  highlighted,
  onActive,
}: {
  pdf: PdfDocument;
  page: ReaderPage;
  availableWidth: number;
  zoom: number;
  scrollRoot: HTMLDivElement | null;
  highlighted: boolean;
  onActive: (page: number) => void;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(page.pageNumber <= 2);
  const [renderError, setRenderError] = useState("");
  const baseScale = Math.max(
    0.35,
    Math.min((availableWidth - 44) / page.width, 1.8),
  );
  const scale = baseScale * zoom;
  const displayWidth = page.width * scale;
  const displayHeight = page.height * scale;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !scrollRoot) return;
    const renderObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          renderObserver.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: "900px 0px" },
    );
    const activeObserver = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) =>
              entry.isIntersecting && entry.intersectionRatio >= 0.35,
          )
        ) {
          onActive(page.pageNumber);
        }
      },
      { root: scrollRoot, threshold: [0.35, 0.6] },
    );
    renderObserver.observe(element);
    activeObserver.observe(element);
    return () => {
      renderObserver.disconnect();
      activeObserver.disconnect();
    };
  }, [onActive, page.pageNumber, scrollRoot]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: any;
    (async () => {
      try {
        const loadedPage = await pdf.getPage(page.pageNumber);
        if (cancelled || !canvasRef.current) return;
        const viewport = loadedPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        renderTask = loadedPage.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        setRenderError("");
      } catch (error: any) {
        if (error?.name !== "RenderingCancelledException") {
          setRenderError(
            error instanceof Error ? error.message : "Render failed",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [page.pageNumber, pdf, scale, shouldRender]);

  return (
    <article
      className={`${styles.pdfPage} ${
        highlighted ? styles.pageHighlighted : ""
      }`}
      id={`pdf-page-${page.pageNumber}`}
      ref={containerRef}
      style={{ width: displayWidth, minHeight: displayHeight }}
    >
      <div className={styles.pageBadge}>{page.pageNumber}</div>
      {shouldRender ? (
        <canvas ref={canvasRef} className={styles.pageCanvas} />
      ) : (
        <div className={styles.pagePlaceholder}>p.{page.pageNumber}</div>
      )}
      {renderError ? (
        <div className={styles.pageRenderError}>{renderError}</div>
      ) : null}
    </article>
  );
}

export function PdfReader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useLanguage();
  const path = searchParams.get("path") ?? "";
  const initialPage = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const proxyUrl = useMemo(
    () =>
      path
        ? `/api/file-proxy?path=${encodeURIComponent(path)}`
        : "",
    [path],
  );
  const documentName = useMemo(() => fileNameFromPath(path), [path]);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const initialJumpDoneRef = useRef(false);
  const pagesRef = useRef<ReaderPage[]>([]);
  const translationQueueRef = useRef<number[]>([]);
  const translationStatesRef = useRef<
    Record<number, TranslationState>
  >({});
  const translationRequestedRef = useRef(new Set<number>());
  const translationInFlightRef = useRef(0);

  const [pdfDoc, setPdfDoc] = useState<PdfDocument>(null);
  const [pages, setPages] = useState<ReaderPage[]>([]);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [references, setReferences] = useState<ReferenceEntry[]>([]);
  const [occurrences, setOccurrences] = useState<CitationOccurrence[]>([]);
  const [outlineUsed, setOutlineUsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"outline" | "references">(
    "outline",
  );
  const [activePage, setActivePage] = useState(1);
  const [activeReference, setActiveReference] = useState<number | null>(
    null,
  );
  const [highlightedPage, setHighlightedPage] = useState<number | null>(
    null,
  );
  const [bilingual, setBilingual] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [leftWidth, setLeftWidth] = useState(760);
  const [translations, setTranslations] = useState<
    Record<number, TranslationState>
  >({});

  const sourceLanguage = useMemo(() => {
    const sample = pages
      .slice(0, 3)
      .map((page) => page.text)
      .join(" ")
      .slice(0, 12000);
    const chinese = (sample.match(/[\u3400-\u9fff]/g) ?? []).length;
    return chinese > Math.max(40, sample.length * 0.08) ? "zh" : "en";
  }, [pages]);
  const targetLanguage = sourceLanguage === "zh" ? "en" : "zh";

  useEffect(() => {
    const element = leftScrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setLeftWidth(element.clientWidth);
    });
    observer.observe(element);
    setLeftWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!proxyUrl) {
      setError(t("reader.missingPath"));
      setLoading(false);
      return;
    }
    let disposed = false;
    let activeDocument: PdfDocument = null;
    (async () => {
      setLoading(true);
      setError("");
      setProgress(0);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          url: proxyUrl,
          withCredentials: true,
        });
        activeDocument = await task.promise;
        if (disposed) {
          await activeDocument.destroy();
          return;
        }
        setPdfDoc(activeDocument);
        const analysis = await analyzePdf(activeDocument, (current, total) => {
          if (!disposed) setProgress(Math.round((current / total) * 100));
        });
        if (disposed) return;
        setPages(analysis.pages);
        pagesRef.current = analysis.pages;
        setHeadings(analysis.headings);
        setReferences(analysis.references);
        setOccurrences(analysis.occurrences);
        setOutlineUsed(analysis.outlineUsed);
      } catch (reason) {
        if (!disposed) {
          setError(
            reason instanceof Error
              ? reason.message
              : t("reader.loadError"),
          );
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      activeDocument?.destroy?.();
    };
  }, [proxyUrl, t]);

  function setPageTranslation(
    pageNumber: number,
    state: TranslationState,
  ) {
    translationStatesRef.current = {
      ...translationStatesRef.current,
      [pageNumber]: state,
    };
    setTranslations(translationStatesRef.current);
  }

  async function runTranslationQueue() {
    while (
      translationInFlightRef.current < 2 &&
      translationQueueRef.current.length > 0
    ) {
      const pageNumber = translationQueueRef.current.shift();
      if (!pageNumber) continue;
      const page = pagesRef.current.find(
        (item) => item.pageNumber === pageNumber,
      );
      if (!page) continue;
      translationInFlightRef.current += 1;
      if (!page.text.trim()) {
        setPageTranslation(pageNumber, {
          status: "done",
          text: t("reader.noExtractableText"),
        });
        translationInFlightRef.current -= 1;
        continue;
      }
      setPageTranslation(pageNumber, { status: "loading" });
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: page.text,
            sourceLanguage,
            targetLanguage,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            payload.detail ??
              payload.error ??
              t("reader.translationFailed"),
          );
        }
        setPageTranslation(pageNumber, {
          status: "done",
          text: String(payload.text ?? ""),
        });
      } catch (reason) {
        setPageTranslation(pageNumber, {
          status: "error",
          error:
            reason instanceof Error
              ? reason.message
              : t("reader.translationFailed"),
        });
      } finally {
        translationInFlightRef.current -= 1;
      }
    }
  }

  function enqueueTranslation(pageNumber: number) {
    if (
      !bilingual ||
      pageNumber < 1 ||
      pageNumber > pagesRef.current.length ||
      translationRequestedRef.current.has(pageNumber)
    ) {
      return;
    }
    const current = translationStatesRef.current[pageNumber];
    if (current?.status === "done" || current?.status === "loading") return;
    translationRequestedRef.current.add(pageNumber);
    translationQueueRef.current.push(pageNumber);
    void runTranslationQueue();
  }

  useEffect(() => {
    if (!bilingual || !pages.length) return;
    enqueueTranslation(activePage);
    enqueueTranslation(activePage + 1);
  }, [activePage, bilingual, pages.length]);

  useEffect(() => {
    if (
      loading ||
      !pages.length ||
      initialJumpDoneRef.current
    ) {
      return;
    }
    initialJumpDoneRef.current = true;
    const pageNumber = Math.min(initialPage, pages.length);
    setActivePage(pageNumber);
    window.setTimeout(() => {
      document
        .getElementById(`pdf-page-${pageNumber}`)
        ?.scrollIntoView({ block: "center" });
      document
        .getElementById(`translation-page-${pageNumber}`)
        ?.scrollIntoView({ block: "center" });
    }, 120);
  }, [initialPage, loading, pages.length]);

  function jumpToPage(pageNumber: number, reference?: number) {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    document
      .getElementById(`pdf-page-${pageNumber}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (right) {
      document
        .getElementById(`translation-page-${pageNumber}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setActivePage(pageNumber);
    setHighlightedPage(pageNumber);
    if (reference) setActiveReference(reference);
    enqueueTranslation(pageNumber);
    if (!left) return;
    window.setTimeout(() => setHighlightedPage(null), 2200);
  }

  function jumpToReference(number: number) {
    setSidebarTab("references");
    setActiveReference(number);
    window.setTimeout(() => {
      document
        .getElementById(`reference-${number}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  }

  function citationClick(marker: string) {
    const numbers = expandCitationNumbers(marker);
    if (numbers.length) jumpToReference(numbers[0]);
  }

  function syncFrom(source: "left" | "right") {
    if (!syncScroll || !bilingual || syncingRef.current) return;
    const from =
      source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to =
      source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!from || !to) return;
    const fromRange = from.scrollHeight - from.clientHeight;
    const toRange = to.scrollHeight - to.clientHeight;
    if (fromRange <= 0 || toRange <= 0) return;
    syncingRef.current = true;
    to.scrollTop = (from.scrollTop / fromRange) * toRange;
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }

  const translationLabel =
    targetLanguage === "zh" ? "中文译文" : "English translation";

  if (loading) {
    return (
      <div className={styles.readerLoading}>
        <BookOpen size={24} />
        <strong>{t("reader.loading")}</strong>
        <div className={styles.loadingTrack}>
          <span style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <small>{progress}%</small>
      </div>
    );
  }

  if (error || !pdfDoc) {
    return (
      <div className={styles.readerError}>
        <strong>{t("reader.loadError")}</strong>
        <p>{error || t("reader.missingPath")}</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => router.back()}
        >
          <ArrowLeft size={14} />
          {t("reader.back")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.reader}>
      <header className={styles.readerToolbar}>
        <button
          className={styles.iconButton}
          type="button"
          onClick={() => router.back()}
          aria-label={t("reader.back")}
          title={t("reader.back")}
        >
          <ArrowLeft size={16} />
        </button>
        <div className={styles.documentTitle}>
          <strong title={documentName}>{documentName}</strong>
          <span>
            {t("reader.page")} {activePage} / {pages.length}
          </span>
        </div>
        <div className={styles.readerStats}>
          <span>
            {t("reader.pageCount")} <b>{pages.length}</b>
          </span>
          <span>
            {t("reader.citations")} <b>{occurrences.length}</b>
          </span>
        </div>
        <div className={styles.toolbarActions}>
          <button
            className={`${styles.toolbarButton} ${
              bilingual ? styles.activeToolbarButton : ""
            }`}
            type="button"
            onClick={() => setBilingual((current) => !current)}
          >
            <Languages size={14} />
            {t("reader.bilingual")}
          </button>
          <button
            className={`${styles.toolbarButton} ${
              syncScroll ? styles.activeToolbarButton : ""
            }`}
            type="button"
            onClick={() => setSyncScroll((current) => !current)}
          >
            <ScrollText size={14} />
            {t("reader.sync")}
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}
            aria-label={t("reader.zoomOut")}
            title={t("reader.zoomOut")}
          >
            <ZoomOut size={15} />
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => setZoom((value) => Math.min(2.1, value + 0.1))}
            aria-label={t("reader.zoomIn")}
            title={t("reader.zoomIn")}
          >
            <ZoomIn size={15} />
          </button>
        </div>
      </header>

      <div
        className={`${styles.readerBody} ${
          bilingual ? styles.readerBodyBilingual : ""
        }`}
      >
        <aside className={styles.readerSidebar}>
          <div className={styles.sidebarTabs}>
            <button
              className={sidebarTab === "outline" ? styles.activeTab : ""}
              type="button"
              onClick={() => setSidebarTab("outline")}
            >
              <ListTree size={13} />
              {t("reader.outline")}
            </button>
            <button
              className={
                sidebarTab === "references" ? styles.activeTab : ""
              }
              type="button"
              onClick={() => setSidebarTab("references")}
            >
              <Link2 size={13} />
              {t("reader.references")}
            </button>
          </div>
          {sidebarTab === "outline" ? (
            <div className={styles.sidebarScroll}>
              {!outlineUsed ? (
                <p className={styles.sidebarNote}>
                  {t("reader.headingFallback")}
                </p>
              ) : null}
              {headings.length ? (
                headings.map((heading) => (
                  <button
                    className={`${styles.outlineItem} ${
                      activePage === heading.page
                        ? styles.outlineItemActive
                        : ""
                    }`}
                    key={heading.id}
                    type="button"
                    style={{
                      paddingLeft: `${10 + Math.min(heading.level, 4) * 10}px`,
                    }}
                    onClick={() => jumpToPage(heading.page)}
                  >
                    <span>{heading.title}</span>
                    <small>p.{heading.page}</small>
                  </button>
                ))
              ) : (
                <p className={styles.sidebarNote}>
                  {t("reader.outlineEmpty")}
                </p>
              )}
            </div>
          ) : (
            <div className={styles.sidebarScroll}>
              {references.length ? (
                references.map((entry) => (
                  <article
                    className={`${styles.referenceItem} ${
                      activeReference === entry.number
                        ? styles.referenceActive
                        : ""
                    }`}
                    id={`reference-${entry.number}`}
                    key={entry.number}
                  >
                    <div className={styles.referenceHeader}>
                      <button
                        type="button"
                        onClick={() => jumpToPage(entry.page, entry.number)}
                      >
                        [{entry.number}] p.{entry.page}
                      </button>
                      <span>
                        {t("reader.citedOn")} {entry.occurrences.length}
                      </span>
                    </div>
                    <p>{entry.text}</p>
                    {entry.occurrences.length ? (
                      <div className={styles.referencePages}>
                        {entry.occurrences.slice(0, 12).map((item, index) => (
                          <button
                            type="button"
                            key={`${entry.number}-${item.page}-${index}`}
                            onClick={() =>
                              jumpToPage(item.page, entry.number)
                            }
                          >
                            p.{item.page}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className={styles.sidebarNote}>
                  {t("reader.noReferences")}
                </p>
              )}
            </div>
          )}
        </aside>

        <section
          className={styles.pdfColumn}
          ref={leftScrollRef}
          onScroll={() => syncFrom("left")}
        >
          <div className={styles.paneLabel}>
            <BookOpen size={13} />
            {t("reader.original")}
          </div>
          <div className={styles.pdfPages}>
            {pages.map((page) => (
              <PdfPage
                key={page.pageNumber}
                pdf={pdfDoc}
                page={page}
                availableWidth={leftWidth}
                zoom={zoom}
                scrollRoot={leftScrollRef.current}
                highlighted={highlightedPage === page.pageNumber}
                onActive={setActivePage}
              />
            ))}
          </div>
        </section>

        {bilingual ? (
          <section
            className={styles.translationColumn}
            ref={rightScrollRef}
            onScroll={() => syncFrom("right")}
          >
            <div className={styles.paneLabel}>
              <Languages size={13} />
              {translationLabel}
            </div>
            <div className={styles.translationPages}>
              {pages.map((page) => {
                const state = translations[page.pageNumber] ?? {
                  status: "idle",
                };
                return (
                  <article
                    className={`${styles.translationPage} ${
                      highlightedPage === page.pageNumber
                        ? styles.pageHighlighted
                        : ""
                    }`}
                    id={`translation-page-${page.pageNumber}`}
                    key={page.pageNumber}
                  >
                    <header>
                      <span>
                        {t("reader.page")} {page.pageNumber}
                      </span>
                      {state.status === "loading" ? (
                        <Loader2 className="spin" size={12} />
                      ) : null}
                    </header>
                    {state.status === "error" ? (
                      <div className={styles.translationError}>
                        <span>{state.error}</span>
                        <button
                          type="button"
                          onClick={() => {
                            translationRequestedRef.current.delete(
                              page.pageNumber,
                            );
                            enqueueTranslation(page.pageNumber);
                          }}
                        >
                          <RefreshCw size={12} />
                          {t("reader.retry")}
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`${styles.pageText} ${
                          state.status !== "done"
                            ? styles.originalFallback
                            : ""
                        }`}
                      >
                        <CitationText
                          text={state.text || page.text}
                          onCitation={citationClick}
                        />
                      </div>
                    )}
                    {state.status === "loading" ? (
                      <span className={styles.translationStatus}>
                        {t("reader.translating")}
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
