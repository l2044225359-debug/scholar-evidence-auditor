import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const baseUrl = "http://127.0.0.1:3000";
const accountsText =
  process.platform === "win32" && !process.env.DEMO_ACCOUNTS_PATH
    ? execFileSync(
        "wsl.exe",
        [
          "-d",
          "Ubuntu-24.04",
          "-u",
          "lh",
          "cat",
          "/home/lh/race/workbench/data/demo-accounts.json",
        ],
        { encoding: "utf8" },
      )
    : readFileSync(
        process.env.DEMO_ACCOUNTS_PATH ??
          resolve(repoRoot, "data/demo-accounts.json"),
        "utf8",
      );
const accounts = JSON.parse(accountsText);

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  ingest(response) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

const jar = new CookieJar();

async function browserFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  if (jar.cookies.size) headers.set("Cookie", jar.header());
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: options.redirect ?? "manual",
  });
  jar.ingest(response);
  return response;
}

function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"));
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"));
      if (!event || !data) return null;
      return {
        event: event.slice(6).trim(),
        data: JSON.parse(data.slice(5).trim()),
      };
    })
    .filter(Boolean);
}

async function askAttention(fileId) {
  const run = () =>
    browserFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Transformer 是否完全基于注意力机制？",
        history: [],
        file_ids: [fileId],
        language: "zh",
        citation_mode: "inline",
        model_mode: "fast",
      }),
      signal: AbortSignal.timeout(180_000),
    });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await run();
    if (response.status !== 200) {
      throw new Error(`Frontend SSE HTTP ${response.status}`);
    }
    const events = parseSse(await response.text());
    const error = events.find((event) => event.event === "error");
    if (!error) return events;
    if (attempt === 1) {
      throw new Error(`Frontend SSE failed: ${error.data.message}`);
    }
  }
  throw new Error("Frontend SSE retry exhausted");
}

const loginPage = await browserFetch("/login");
if (loginPage.status !== 200) throw new Error("Login page is unavailable");
if (loginPage.headers.get("x-powered-by")) {
  throw new Error("X-Powered-By is still exposed");
}
for (const header of [
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "permissions-policy",
]) {
  if (!loginPage.headers.get(header)) {
    throw new Error(`Missing security header: ${header}`);
  }
}

const unauthorizedGraph = await browserFetch("/citation-graph");
if (unauthorizedGraph.status !== 401) {
  throw new Error("Citation proxy did not reject anonymous access");
}
const unauthorizedFile = await browserFetch("/api/file-proxy?path=invalid");
if (unauthorizedFile.status !== 401) {
  throw new Error("File proxy did not reject anonymous access");
}
const unauthorizedVoice = await browserFetch("/api/voice/tts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Scholar narration.", speaker: "Carter" }),
});
if (unauthorizedVoice.status !== 401) {
  throw new Error("Voice BFF did not reject anonymous access");
}

const csrfResponse = await browserFetch("/api/auth/csrf");
const { csrfToken } = await csrfResponse.json();
const credentials = new URLSearchParams({
  csrfToken,
  username: "admin",
  password: accounts.admin.password,
  callbackUrl: `${baseUrl}/`,
  json: "true",
});
await browserFetch("/api/auth/callback/credentials", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: credentials,
});

const sessionResponse = await browserFetch("/api/auth/session");
const session = await sessionResponse.json();
if (!session.user) throw new Error("Credentials login failed");

const graphPage = await browserFetch("/citation-graph");
if (graphPage.status !== 200) {
  throw new Error(`Citation page HTTP ${graphPage.status}`);
}
if (!(await graphPage.text()).includes("Citation Graph")) {
  throw new Error("Citation page content is missing");
}

const graphHealth = await browserFetch("/citation-graph/api/health");
if (graphHealth.status !== 200) {
  throw new Error(`Citation health HTTP ${graphHealth.status}`);
}

const graphResponse = await browserFetch("/citation-graph/api/graph", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    seed: "10.48550/arXiv.1706.03762",
    depth: 1,
    direction: "references",
    max_nodes: 2,
    per_node_limit: 1,
    enrich_crossref: false,
  }),
  signal: AbortSignal.timeout(120_000),
});
if (graphResponse.status !== 200) {
  throw new Error(`Citation graph HTTP ${graphResponse.status}`);
}
const graph = await graphResponse.json();
if (!graph.summary?.root_title) {
  throw new Error("Citation graph response is incomplete");
}

const localGraphResponse = await browserFetch(
  "/api/citation/local?language=zh",
  {
    signal: AbortSignal.timeout(300_000),
  },
);
if (localGraphResponse.status !== 200) {
  throw new Error(`Local citation graph HTTP ${localGraphResponse.status}`);
}
const localGraph = await localGraphResponse.json();
if (
  !localGraph.nodes?.length ||
  localGraph.nodes.length > 20 ||
  !localGraph.foundational?.length ||
  !localGraph.nodes.every((node) =>
    typeof node.pagerank === "number",
  ) ||
  !localGraph.future_work?.summary_markdown
) {
  throw new Error("Local citation graph or Future Work synthesis is incomplete");
}

const filesResponse = await browserFetch("/api/files");
if (filesResponse.status !== 200) {
  throw new Error(`Files HTTP ${filesResponse.status}`);
}
const files = await filesResponse.json();
const attention = files.items.find((file) => file.name === "attention.pdf");
if (!attention) throw new Error("attention.pdf is not indexed");

const overviewResponse = await browserFetch(
  "/api/knowledge-overview?refresh=1",
  { signal: AbortSignal.timeout(180_000) },
);
if (overviewResponse.status !== 200) {
  throw new Error(`Knowledge overview HTTP ${overviewResponse.status}`);
}
const overview = await overviewResponse.json();
for (const key of ["documents", "pages", "chunks", "ocr_pages", "citation_edges"]) {
  if (!Number.isFinite(overview[key]) || overview[key] < 0) {
    throw new Error(`Knowledge overview has an invalid ${key}`);
  }
}
if (overview.documents !== files.items.length) {
  throw new Error("Knowledge overview document count is inconsistent");
}
if (overview.documents > 0 && (overview.pages === 0 || overview.chunks === 0)) {
  throw new Error("Knowledge overview is missing pages or chunks");
}
if (
  !Number.isFinite(overview.health?.score) ||
  overview.health.score < 0 ||
  overview.health.score > 100
) {
  throw new Error("Knowledge overview health score is invalid");
}

const events = await askAttention(attention.id);
const done = events.find((event) => event.event === "done");
if (!done?.data.answer) throw new Error("Frontend SSE is incomplete");
const citation = done.data.citations?.find((item) => item.preview_url);
if (!citation) throw new Error("No PDF preview URL was returned");

const preview = await browserFetch(
  `/api/file-proxy?path=${encodeURIComponent(citation.preview_url)}`,
);
if (preview.status !== 200) {
  throw new Error(`PDF proxy HTTP ${preview.status}`);
}
const previewBytes = await preview.arrayBuffer();
const previewType = preview.headers.get("content-type") ?? "";
if (!previewType.includes("application/pdf")) {
  throw new Error(
    `PDF proxy returned ${previewType || "no content type"} ` +
      `with ${previewBytes.byteLength} bytes`,
  );
}
if (previewBytes.byteLength < 1024) {
  throw new Error("PDF proxy returned an empty document");
}

const readerPage = await browserFetch(
  `/reader?path=${encodeURIComponent(citation.preview_url)}&page=${
    citation.page ?? 1
  }`,
);
if (readerPage.status !== 200) {
  throw new Error(`PDF reader page HTTP ${readerPage.status}`);
}

const translationResponse = await browserFetch("/api/translate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "The Transformer relies on attention mechanisms [1].",
    sourceLanguage: "en",
    targetLanguage: "zh",
  }),
  signal: AbortSignal.timeout(180_000),
});
if (translationResponse.status !== 200) {
  throw new Error(`Translation HTTP ${translationResponse.status}`);
}
const translation = await translationResponse.json();
if (
  !translation.text ||
  (!translation.text.includes("[1]") && !translation.text.includes("【1】"))
) {
  throw new Error("Academic translation is incomplete");
}

const arxivResponse = await browserFetch("/api/tools/arxiv", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "1706.03762" }),
  signal: AbortSignal.timeout(300_000),
});
if (arxivResponse.status !== 200) {
  throw new Error(`arXiv tool HTTP ${arxivResponse.status}`);
}
const arxivResult = await arxivResponse.json();
if (arxivResult.status !== "duplicate" || !arxivResult.steps?.length) {
  throw new Error("arXiv tool did not complete its duplicate workflow");
}

const csvForm = new FormData();
csvForm.append(
  "file",
  new Blob(
    [readFileSync(resolve(repoRoot, "tests/fixtures/agent_metrics.csv"))],
    { type: "text/csv" },
  ),
  "agent_metrics.csv",
);
csvForm.append(
  "question",
  "Compare method accuracy and describe the main trend.",
);
const csvResponse = await browserFetch("/api/tools/csv", {
  method: "POST",
  body: csvForm,
  signal: AbortSignal.timeout(300_000),
});
if (csvResponse.status !== 200) {
  throw new Error(`CSV tool HTTP ${csvResponse.status}`);
}
const csvResult = await csvResponse.json();
if (
  !csvResult.chart?.base64?.startsWith("iVBOR") ||
  !csvResult.caption ||
  !csvResult.scripts?.mermaid?.includes("xychart-beta") ||
  !csvResult.scripts?.tikz?.includes("\\begin{axis}") ||
  !csvResult.scripts?.tikz?.includes("\\addplot") ||
  !csvResult.steps?.length
) {
  throw new Error("CSV tool returned an incomplete analysis");
}

const writingResponse = await browserFetch("/api/tools/writing", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    idea:
      "将证据审计、引用图谱和混合检索结合起来，构建可验证的多论文综述 Agent。",
    fileIds: null,
    language: "zh",
  }),
  signal: AbortSignal.timeout(300_000),
});
if (writingResponse.status !== 200) {
  throw new Error(`Writing tool HTTP ${writingResponse.status}`);
}
const writingResult = await writingResponse.json();
if (
  !writingResult.framework?.includes("References") ||
  !writingResult.references?.length ||
  !writingResult.bibtex?.includes("@article") ||
  !writingResult.steps?.length
) {
  throw new Error("Writing tool returned an incomplete framework");
}

const voiceResponse = await browserFetch("/api/voice/tts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "Scholar turns research answers into verifiable evidence.",
    speaker: "Carter",
  }),
  signal: AbortSignal.timeout(180_000),
});
if (voiceResponse.status !== 200) {
  throw new Error(`Voice BFF HTTP ${voiceResponse.status}`);
}
const voiceBytes = new Uint8Array(await voiceResponse.arrayBuffer());
const voiceMagic = String.fromCharCode(...voiceBytes.slice(0, 4));
if (!voiceResponse.headers.get("content-type")?.includes("audio/wav")) {
  throw new Error("Voice BFF did not return audio/wav");
}
if (voiceBytes.byteLength < 1024 || voiceMagic !== "RIFF") {
  throw new Error("Voice BFF returned an invalid WAV payload");
}

console.log(
  "Authenticated proxy, PDF reader, local graph, Agent/Writing tools and VibeVoice smoke tests passed.",
);
