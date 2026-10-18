from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote, quote_plus

import networkx as nx
import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


OPENALEX_BASE = os.getenv("OPENALEX_BASE_URL", "https://api.openalex.org")
CROSSREF_BASE = os.getenv("CROSSREF_BASE_URL", "https://api.crossref.org")
OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "").strip()
CROSSREF_MAILTO = os.getenv("CROSSREF_MAILTO", "").strip()
CACHE_DIR = Path(
    os.getenv("CITATION_CACHE_DIR", "/home/lh/race/citation_graph/cache")
)
EXPORT_DIR = Path(
    os.getenv("CITATION_EXPORT_DIR", "/home/lh/race/citation_graph/exports")
)
CACHE_TTL = int(os.getenv("CITATION_CACHE_TTL", "86400"))
HTTP_TIMEOUT = int(os.getenv("CITATION_HTTP_TIMEOUT", "30"))

CACHE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


class FetchError(RuntimeError):
    pass


class GraphRequest(BaseModel):
    seed: str = Field(min_length=2)
    depth: int = Field(default=1, ge=1, le=2)
    direction: Literal["references", "citations", "both"] = "both"
    max_nodes: int = Field(default=20, ge=2, le=60)
    per_node_limit: int = Field(default=8, ge=1, le=25)
    enrich_crossref: bool = True


def _cache_path(url: str) -> Path:
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{key}.json"


def _read_cache(url: str):
    path = _cache_path(url)
    if not path.exists():
        return None
    if CACHE_TTL >= 0 and time.time() - path.stat().st_mtime > CACHE_TTL:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(url: str, payload) -> None:
    try:
        _cache_path(url).write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


def _curl_json(url: str):
    curl_path = shutil.which("curl.exe")
    if not curl_path:
        candidate = Path("/mnt/c/Windows/System32/curl.exe")
        curl_path = str(candidate) if candidate.exists() else None
    if not curl_path:
        raise FetchError("Windows curl.exe is unavailable")

    command = [
        curl_path,
        "-fsSL",
        "--max-time",
        str(HTTP_TIMEOUT),
        "-H",
        "Accept: application/json",
        "-H",
        "User-Agent: citation-graph/1.0",
        url,
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=HTTP_TIMEOUT + 5,
        check=False,
    )
    if result.returncode != 0:
        raise FetchError(
            f"curl failed ({result.returncode}): "
            f"{result.stderr.strip()[:300]}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise FetchError("API returned invalid JSON") from exc


def _requests_json(url: str):
    response = requests.get(
        url,
        timeout=HTTP_TIMEOUT,
        headers={
            "Accept": "application/json",
            "User-Agent": "citation-graph/1.0",
        },
    )
    response.raise_for_status()
    return response.json()


def fetch_json(url: str):
    cached = _read_cache(url)
    if cached is not None:
        return cached

    errors = []
    use_curl_first = Path("/mnt/c/Windows/System32/curl.exe").exists()
    fetchers = (
        [_curl_json, _requests_json]
        if use_curl_first
        else [_requests_json, _curl_json]
    )
    for fetcher in fetchers:
        try:
            payload = fetcher(url)
            _write_cache(url, payload)
            return payload
        except Exception as exc:
            errors.append(f"{fetcher.__name__}: {exc}")

    raise FetchError("; ".join(errors))


def _openalex_url(path: str, params: dict | None = None) -> str:
    parsed = dict(params or {})
    if OPENALEX_MAILTO:
        parsed["mailto"] = OPENALEX_MAILTO
    query = "&".join(
        f"{quote_plus(str(key))}={quote_plus(str(value))}"
        for key, value in parsed.items()
    )
    return f"{OPENALEX_BASE}{path}" + (f"?{query}" if query else "")


def _safe_work_id(value: str | None) -> str:
    if not value:
        return ""
    return value.rstrip("/").rsplit("/", 1)[-1]


def _normalize_doi(value: str | None) -> str:
    if not value:
        return ""
    doi = value.strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.lower().startswith(prefix):
            doi = doi[len(prefix) :]
    return doi


def _work_from_openalex(work: dict) -> dict:
    authors = []
    for authorship in work.get("authorships", []) or []:
        name = (authorship.get("author") or {}).get("display_name")
        if name:
            authors.append(name)

    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}
    return {
        "id": _safe_work_id(work.get("id")),
        "title": work.get("display_name") or work.get("title") or "Untitled",
        "doi": _normalize_doi(work.get("doi")),
        "year": work.get("publication_year"),
        "publication_date": work.get("publication_date"),
        "type": work.get("type"),
        "authors": authors[:20],
        "cited_by_count": int(work.get("cited_by_count") or 0),
        "referenced_works_count": int(
            work.get("referenced_works_count") or 0
        ),
        "openalex_url": work.get("id"),
        "landing_url": primary.get("landing_page_url"),
        "pdf_url": primary.get("pdf_url"),
        "source": source.get("display_name"),
        "is_open_access": bool((work.get("open_access") or {}).get("is_oa")),
    }


def _crossref_metadata(doi: str) -> dict:
    normalized = _normalize_doi(doi)
    if not normalized:
        return {}

    params = []
    if CROSSREF_MAILTO:
        params.append(f"mailto={quote_plus(CROSSREF_MAILTO)}")
    suffix = f"?{'&'.join(params)}" if params else ""
    url = f"{CROSSREF_BASE}/works/{quote(normalized, safe='')}{suffix}"
    payload = fetch_json(url)
    message = payload.get("message") or {}

    authors = []
    for author in message.get("author", []) or []:
        given = (author.get("given") or "").strip()
        family = (author.get("family") or "").strip()
        name = " ".join(part for part in (given, family) if part)
        if name:
            authors.append(name)

    issued = message.get("issued", {}).get("date-parts", [[None]])
    year = issued[0][0] if issued and issued[0] else None
    return {
        "title": " ".join(message.get("title", []) or []).strip(),
        "doi": _normalize_doi(message.get("DOI")),
        "year": year,
        "type": message.get("type"),
        "authors": authors[:20],
        "publisher": message.get("publisher"),
        "container_title": " ".join(
            message.get("container-title", []) or []
        ).strip(),
        "reference_count": int(message.get("reference-count") or 0),
        "crossref_cited_by_count": int(
            message.get("is-referenced-by-count") or 0
        ),
        "crossref_url": message.get("URL"),
    }


def _enrich_with_crossref(node: dict) -> dict:
    if not node.get("doi"):
        return node
    try:
        metadata = _crossref_metadata(node["doi"])
    except Exception:
        return node

    for key, value in metadata.items():
        if value not in (None, "", []):
            if key in {"title", "year", "authors", "type"}:
                if not node.get(key):
                    node[key] = value
            else:
                node[key] = value
    node["crossref_enriched"] = True
    return node


def resolve_seed(seed: str) -> dict:
    text = seed.strip()
    if text.upper().startswith("W") and text[1:].isdigit():
        url = _openalex_url(f"/works/{text.upper()}")
        return fetch_json(url)

    if "openalex.org/" in text:
        work_id = _safe_work_id(text)
        url = _openalex_url(f"/works/{work_id}")
        return fetch_json(url)

    doi = _normalize_doi(text)
    if doi.startswith("10."):
        url = _openalex_url(f"/works/https://doi.org/{doi}")
        try:
            return fetch_json(url)
        except Exception:
            payload = fetch_json(
                f"{CROSSREF_BASE}/works/{quote(doi, safe='')}"
            )
            message = payload.get("message") or {}
            if not message.get("DOI"):
                raise
            return {
                "id": f"doi:{_normalize_doi(message['DOI'])}",
                "display_name": " ".join(message.get("title", []) or []),
                "doi": f"https://doi.org/{_normalize_doi(message['DOI'])}",
                "publication_year": (
                    message.get("issued", {})
                    .get("date-parts", [[None]])[0][0]
                ),
                "type": message.get("type"),
                "authorships": [],
                "referenced_works": [
                    f"https://doi.org/{_normalize_doi(ref.get('DOI'))}"
                    for ref in message.get("reference", [])
                    if ref.get("DOI")
                ],
            }

    url = _openalex_url(
        "/works",
        {
            "search": text,
            "per-page": 1,
            "sort": "cited_by_count:desc",
        },
    )
    payload = fetch_json(url)
    results = payload.get("results") or []
    if not results:
        raise ValueError(f"No OpenAlex work matched: {seed}")
    return results[0]


def _batch_works(work_ids: list[str]) -> list[dict]:
    clean_ids = [_safe_work_id(item) for item in work_ids if item]
    if not clean_ids:
        return []
    works = []
    for start in range(0, len(clean_ids), 20):
        batch = clean_ids[start : start + 20]
        url = _openalex_url(
            "/works",
            {
                "filter": f"openalex:{'|'.join(batch)}",
                "per-page": len(batch),
            },
        )
        payload = fetch_json(url)
        works.extend(payload.get("results") or [])
    return works


def _citing_works(work_id: str, limit: int) -> list[dict]:
    url = _openalex_url(
        "/works",
        {
            "filter": f"cites:{_safe_work_id(work_id)}",
            "per-page": limit,
            "sort": "cited_by_count:desc",
        },
    )
    payload = fetch_json(url)
    return payload.get("results") or []


def _sort_neighbors(works: list[dict]) -> list[dict]:
    return sorted(
        works,
        key=lambda item: (
            int(item.get("cited_by_count") or 0),
            int(item.get("publication_year") or 0),
        ),
        reverse=True,
    )


def build_graph(request: GraphRequest) -> tuple[nx.DiGraph, dict]:
    root_raw = resolve_seed(request.seed)
    root = _work_from_openalex(root_raw)
    root["is_seed"] = True

    graph = nx.DiGraph()
    graph.add_node(root["id"], **root)
    work_cache = {root["id"]: root_raw}
    queue = deque([(root["id"], 0)])
    expanded = set()
    skipped = 0

    while queue and graph.number_of_nodes() < request.max_nodes:
        work_id, depth = queue.popleft()
        if depth >= request.depth or work_id in expanded:
            continue
        expanded.add(work_id)

        current_raw = work_cache.get(work_id) or {}
        neighbors = []
        neighbor_relation = {}

        if request.direction in {"references", "both"}:
            references = (
                current_raw.get("referenced_works")
                or current_raw.get("references")
                or []
            )
            try:
                reference_works = _batch_works(references[:50])
            except Exception:
                reference_works = []
            for work in _sort_neighbors(reference_works):
                node_id = _safe_work_id(work.get("id"))
                if node_id:
                    neighbors.append(work)
                    neighbor_relation[node_id] = "reference"

        if request.direction in {"citations", "both"}:
            try:
                citing_works = _citing_works(
                    work_id, request.per_node_limit
                )
            except Exception:
                citing_works = []
            for work in _sort_neighbors(citing_works):
                node_id = _safe_work_id(work.get("id"))
                if node_id:
                    neighbors.append(work)
                    neighbor_relation[node_id] = "citation"

        unique_neighbors = {}
        for work in neighbors:
            node_id = _safe_work_id(work.get("id"))
            if node_id and node_id not in unique_neighbors:
                unique_neighbors[node_id] = work

        for work in _sort_neighbors(list(unique_neighbors.values())):
            if len(graph) >= request.max_nodes:
                skipped += 1
                continue

            node_id = _safe_work_id(work.get("id"))
            node = _work_from_openalex(work)
            node["is_seed"] = False
            if node_id not in graph:
                graph.add_node(node_id, **node)
                work_cache[node_id] = work
                if depth + 1 < request.depth:
                    queue.append((node_id, depth + 1))

            relation = neighbor_relation.get(node_id, "related")
            if relation == "reference":
                graph.add_edge(work_id, node_id, relation="cites")
            elif relation == "citation":
                graph.add_edge(node_id, work_id, relation="cites")

    if request.enrich_crossref:
        for node_id, attrs in graph.nodes(data=True):
            enriched = _enrich_with_crossref(dict(attrs))
            graph.nodes[node_id].update(enriched)

    if graph.number_of_nodes() > 0:
        pagerank = nx.pagerank(graph)
    else:
        pagerank = {}
    in_degree = dict(graph.in_degree())
    out_degree = dict(graph.out_degree())

    for node_id, attrs in graph.nodes(data=True):
        attrs["pagerank"] = round(float(pagerank.get(node_id, 0)), 8)
        attrs["in_degree"] = int(in_degree.get(node_id, 0))
        attrs["out_degree"] = int(out_degree.get(node_id, 0))
        attrs["degree"] = attrs["in_degree"] + attrs["out_degree"]

    influential = sorted(
        (
            {
                "id": node_id,
                "title": attrs.get("title"),
                "year": attrs.get("year"),
                "pagerank": attrs.get("pagerank", 0),
                "in_degree": attrs.get("in_degree", 0),
            }
            for node_id, attrs in graph.nodes(data=True)
        ),
        key=lambda item: (item["pagerank"], item["in_degree"]),
        reverse=True,
    )[:10]

    summary = {
        "seed": request.seed,
        "root_id": root["id"],
        "root_title": root.get("title"),
        "direction": request.direction,
        "depth": request.depth,
        "node_count": graph.number_of_nodes(),
        "edge_count": graph.number_of_edges(),
        "truncated_neighbors": skipped,
        "influential_nodes": influential,
        "generated_at": datetime.now(UTC).isoformat(),
        "data_sources": ["OpenAlex", "Crossref"],
    }
    return graph, summary


def graph_payload(graph: nx.DiGraph, summary: dict) -> dict:
    nodes = []
    for node_id, attrs in graph.nodes(data=True):
        nodes.append({"id": node_id, **attrs})
    edges = []
    for source, target, attrs in graph.edges(data=True):
        edges.append(
            {
                "source": source,
                "target": target,
                "relation": attrs.get("relation", "cites"),
            }
        )
    return {"summary": summary, "nodes": nodes, "edges": edges}


def export_graph(graph: nx.DiGraph, summary: dict) -> dict:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    stem = f"citation_graph_{_safe_work_id(summary.get('root_id'))}_{timestamp}"
    json_path = EXPORT_DIR / f"{stem}.json"
    graphml_path = EXPORT_DIR / f"{stem}.graphml"

    payload = graph_payload(graph, summary)
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    graphml = nx.DiGraph()
    for node_id, attrs in graph.nodes(data=True):
        clean = {}
        for key, value in attrs.items():
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                clean[key] = value
            else:
                clean[key] = json.dumps(value, ensure_ascii=False)
        graphml.add_node(node_id, **clean)
    for source, target, attrs in graph.edges(data=True):
        graphml.add_edge(source, target, **attrs)
    nx.write_graphml(graphml, graphml_path)

    return {
        "json": str(json_path),
        "graphml": str(graphml_path),
    }


app = FastAPI(
    title="Citation Graph",
    description="NetworkX citation graph powered by OpenAlex and Crossref.",
    version="1.0.0",
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "network_backend": (
            "windows-curl"
            if Path("/mnt/c/Windows/System32/curl.exe").exists()
            else "requests"
        ),
        "cache_dir": str(CACHE_DIR),
    }


@app.get("/api/search")
def search(q: str = Query(min_length=2)):
    try:
        work = resolve_seed(q)
        return _work_from_openalex(work)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/graph")
def create_graph(request: GraphRequest):
    try:
        graph, summary = build_graph(request)
        payload = graph_payload(graph, summary)
        payload["files"] = export_graph(graph, summary)
        return payload
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/", response_class=HTMLResponse)
def index():
    return INDEX_HTML


INDEX_HTML = r"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Citation Graph</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f6;
      --panel: #ffffff;
      --text: #172126;
      --muted: #66737a;
      --border: #d8dee2;
      --accent: #0f766e;
      --accent-soft: #dff4ef;
      --citation: #d97706;
      --seed: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system,
        BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input, select { font: inherit; }
    .app { min-height: 100vh; display: flex; flex-direction: column; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 24px; padding: 18px 24px; border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .sub { color: var(--muted); margin-top: 2px; }
    .status { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .toolbar {
      display: grid; grid-template-columns: minmax(220px, 1fr) 100px 140px
        110px 120px auto; gap: 10px; padding: 14px 24px;
      border-bottom: 1px solid var(--border); background: var(--panel);
      align-items: end;
    }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    input, select {
      height: 38px; border: 1px solid var(--border); border-radius: 6px;
      padding: 0 10px; background: #fff; color: var(--text); min-width: 0;
    }
    input:focus, select:focus { outline: 2px solid #9fd9d0; border-color: var(--accent); }
    button {
      height: 38px; border: 0; border-radius: 6px; padding: 0 16px;
      background: var(--accent); color: white; cursor: pointer;
      font-weight: 650; white-space: nowrap;
    }
    button:hover { background: #0b5f59; }
    button.secondary {
      background: #fff; color: var(--text); border: 1px solid var(--border);
    }
    button:disabled { opacity: .55; cursor: wait; }
    .workspace {
      flex: 1; min-height: 0; display: grid;
      grid-template-columns: minmax(0, 1fr) 310px;
    }
    .graph-wrap { position: relative; min-height: 560px; overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; cursor: grab; }
    canvas:active { cursor: grabbing; }
    .legend {
      position: absolute; left: 18px; bottom: 18px; display: flex; gap: 16px;
      padding: 9px 12px; background: rgba(255,255,255,.94);
      border: 1px solid var(--border); border-radius: 6px; font-size: 12px;
    }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
      margin-right: 6px; }
    .inspector {
      border-left: 1px solid var(--border); background: var(--panel);
      padding: 18px; overflow: auto;
    }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .metric { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .metric b { display: block; font-size: 21px; }
    .metric span { color: var(--muted); font-size: 11px; }
    h2 { font-size: 13px; margin: 22px 0 10px; text-transform: uppercase;
      color: var(--muted); letter-spacing: .04em; }
    #details { color: var(--muted); }
    #details strong { color: var(--text); }
    #details a { color: var(--accent); word-break: break-all; }
    .error { color: #b42318; white-space: pre-wrap; }
    @media (max-width: 900px) {
      header { padding: 16px; align-items: flex-start; }
      .toolbar { grid-template-columns: 1fr 1fr; padding: 14px 16px; }
      .toolbar label:first-child { grid-column: 1 / -1; }
      .toolbar button { width: 100%; }
      .workspace { grid-template-columns: 1fr; }
      .inspector { border-left: 0; border-top: 1px solid var(--border); }
      .graph-wrap { min-height: 58vh; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>Citation Graph</h1>
        <div class="sub">OpenAlex 主数据 · Crossref 元数据补全</div>
      </div>
      <div class="status" id="status">就绪</div>
    </header>
    <form class="toolbar" id="form">
      <label>论文标题、DOI 或 OpenAlex ID
        <input id="seed" value="10.48550/arXiv.1706.03762" required />
      </label>
      <label>展开深度
        <select id="depth"><option value="1">1 层</option><option value="2">2 层</option></select>
      </label>
      <label>引用方向
        <select id="direction">
          <option value="both">双向</option>
          <option value="references">参考文献</option>
          <option value="citations">被引文献</option>
        </select>
      </label>
      <label>最大节点
        <input id="maxNodes" type="number" min="2" max="60" value="20" />
      </label>
      <label>每节点邻居
        <input id="perNode" type="number" min="1" max="25" value="8" />
      </label>
      <button id="build" type="submit">生成图谱</button>
    </form>
    <main class="workspace">
      <section class="graph-wrap">
        <canvas id="canvas"></canvas>
        <div class="legend">
          <span><i class="dot" style="background:var(--seed)"></i>种子论文</span>
          <span><i class="dot" style="background:var(--accent)"></i>参考文献</span>
          <span><i class="dot" style="background:var(--citation)"></i>被引文献</span>
        </div>
      </section>
      <aside class="inspector">
        <div class="metrics">
          <div class="metric"><b id="nodeCount">0</b><span>节点</span></div>
          <div class="metric"><b id="edgeCount">0</b><span>连边</span></div>
          <div class="metric"><b id="maxRank">0</b><span>最大 PageRank</span></div>
        </div>
        <h2>节点详情</h2>
        <div id="details"><p>点击图中的论文节点查看详情。</p></div>
        <h2>当前结果</h2>
        <div id="summary" class="sub">尚未生成图谱。</div>
      </aside>
    </main>
  </div>
  <script>
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const form = document.getElementById("form");
    const statusEl = document.getElementById("status");
    const detailsEl = document.getElementById("details");
    let graph = null;
    let nodes = [];
    let edges = [];
    let selected = null;
    let scale = 1;
    let offset = {x: 0, y: 0};
    let dragging = false;
    let last = null;
    let animation = 0;

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    window.addEventListener("resize", resize);

    function seedPosition(index, total) {
      const rect = canvas.parentElement.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * .32;
      const angle = (index / Math.max(1, total)) * Math.PI * 2;
      return {
        x: rect.width / 2 + Math.cos(angle) * radius,
        y: rect.height / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0
      };
    }

    function prepareNodes() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const seed = nodes.find(n => n.is_seed) || nodes[0];
      const others = nodes.filter(n => n !== seed);
      nodes.forEach((n, i) => Object.assign(n, seedPosition(i, nodes.length)));
      if (seed) { seed.x = rect.width / 2; seed.y = rect.height / 2; }
      edges = edges.map(e => ({
        ...e,
        sourceNode: nodes.find(n => n.id === e.source),
        targetNode: nodes.find(n => n.id === e.target)
      }));
    }

    function tick() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist2 = dx * dx + dy * dy + 70;
          let force = 1400 / dist2;
          let dist = Math.sqrt(dist2);
          dx /= dist; dy /= dist;
          a.vx -= dx * force; a.vy -= dy * force;
          b.vx += dx * force; b.vy += dy * force;
        }
        a.vx += (cx - a.x) * .0008;
        a.vy += (cy - a.y) * .0008;
      }
      for (const e of edges) {
        if (!e.sourceNode || !e.targetNode) continue;
        let dx = e.targetNode.x - e.sourceNode.x;
        let dy = e.targetNode.y - e.sourceNode.y;
        let dist = Math.sqrt(dx * dx + dy * dy + 1);
        let force = (dist - 150) * .0012;
        dx /= dist; dy /= dist;
        e.sourceNode.vx += dx * force; e.sourceNode.vy += dy * force;
        e.targetNode.vx -= dx * force; e.targetNode.vy -= dy * force;
      }
      for (const n of nodes) {
        n.vx *= .9; n.vy *= .9;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(35, Math.min(rect.width - 35, n.x));
        n.y = Math.max(35, Math.min(rect.height - 35, n.y));
      }
      draw();
      animation = requestAnimationFrame(tick);
    }

    function nodeColor(n) {
      if (n.is_seed) return "#b42318";
      if (n.in_degree > n.out_degree) return "#d97706";
      return "#0f766e";
    }

    function draw() {
      const rect = canvas.parentElement.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(scale, scale);
      ctx.lineWidth = 1;
      for (const e of edges) {
        if (!e.sourceNode || !e.targetNode) continue;
        ctx.strokeStyle = "#9aa6ac";
        ctx.beginPath();
        ctx.moveTo(e.sourceNode.x, e.sourceNode.y);
        ctx.lineTo(e.targetNode.x, e.targetNode.y);
        ctx.stroke();
        const angle = Math.atan2(
          e.targetNode.y - e.sourceNode.y,
          e.targetNode.x - e.sourceNode.x
        );
        const tx = e.targetNode.x - Math.cos(angle) * 14;
        const ty = e.targetNode.y - Math.sin(angle) * 14;
        ctx.fillStyle = "#7c8b92";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(angle - .45) * 8, ty - Math.sin(angle - .45) * 8);
        ctx.lineTo(tx - Math.cos(angle + .45) * 8, ty - Math.sin(angle + .45) * 8);
        ctx.closePath();
        ctx.fill();
      }
      for (const n of nodes) {
        const radius = n.is_seed ? 12 : Math.max(6, Math.min(10, 6 + Math.log10((n.cited_by_count || 0) + 1)));
        ctx.fillStyle = nodeColor(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (selected && selected.id === n.id) {
          ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(n.x, n.y, radius + 4, 0, Math.PI * 2); ctx.stroke();
        }
        if (scale > .72) {
          ctx.font = n.is_seed ? "600 12px system-ui" : "11px system-ui";
          ctx.fillStyle = "#253238";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const label = (n.title || "Untitled").slice(0, 36);
          ctx.fillText(label, n.x, n.y + radius + 4);
        }
      }
      ctx.restore();
    }

    function nodeAt(x, y) {
      const px = (x - offset.x) / scale;
      const py = (y - offset.y) / scale;
      return nodes.find(n => Math.hypot(n.x - px, n.y - py) < 15);
    }

    canvas.addEventListener("pointerdown", e => {
      const hit = nodeAt(e.offsetX, e.offsetY);
      if (hit) {
        selected = hit;
        renderDetails(hit);
      } else {
        dragging = true;
        last = {x: e.offsetX, y: e.offsetY};
      }
      draw();
    });
    canvas.addEventListener("pointermove", e => {
      if (!dragging || !last) return;
      offset.x += e.offsetX - last.x;
      offset.y += e.offsetY - last.y;
      last = {x: e.offsetX, y: e.offsetY};
      draw();
    });
    canvas.addEventListener("pointerup", () => { dragging = false; last = null; });
    canvas.addEventListener("pointerleave", () => { dragging = false; last = null; });
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      scale = Math.max(.45, Math.min(2.4, scale * (e.deltaY > 0 ? .92 : 1.08)));
      draw();
    }, {passive: false});

    function renderDetails(n) {
      const authors = (n.authors || []).slice(0, 6).join(", ");
      const link = n.doi
        ? `https://doi.org/${n.doi}`
        : (n.openalex_url || "");
      detailsEl.innerHTML = `
        <p><strong>${escapeHtml(n.title || "Untitled")}</strong></p>
        <p>${escapeHtml(String(n.year || "年份未知"))} · ${
          escapeHtml(n.source || n.container_title || n.type || "文献")
        }</p>
        <p>${escapeHtml(authors || "作者信息缺失")}</p>
        <p>被引 ${Number(n.cited_by_count || 0).toLocaleString()} ·
          入度 ${n.in_degree || 0} · 出度 ${n.out_degree || 0}</p>
        <p>PageRank ${Number(n.pagerank || 0).toFixed(5)}</p>
        ${link ? `<p><a target="_blank" rel="noreferrer" href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : ""}
      `;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, c => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
      }[c]));
    }

    async function build(event) {
      event.preventDefault();
      if (animation) cancelAnimationFrame(animation);
      const button = document.getElementById("build");
      button.disabled = true;
      statusEl.textContent = "正在查询 OpenAlex 与 Crossref…";
      statusEl.className = "status";
      detailsEl.innerHTML = "<p>正在构建引用关系。</p>";
      try {
        const response = await fetch("/api/graph", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            seed: document.getElementById("seed").value,
            depth: Number(document.getElementById("depth").value),
            direction: document.getElementById("direction").value,
            max_nodes: Number(document.getElementById("maxNodes").value),
            per_node_limit: Number(document.getElementById("perNode").value),
            enrich_crossref: true
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "构建失败");
        graph = data;
        nodes = data.nodes.map(n => ({...n}));
        edges = data.edges.map(e => ({...e}));
        selected = null;
        prepareNodes();
        document.getElementById("nodeCount").textContent = data.summary.node_count;
        document.getElementById("edgeCount").textContent = data.summary.edge_count;
        const maxRank = Math.max(0, ...nodes.map(n => n.pagerank || 0));
        document.getElementById("maxRank").textContent = maxRank.toFixed(3);
        document.getElementById("summary").innerHTML =
          `${escapeHtml(data.summary.root_title || data.summary.seed)}`;
        statusEl.textContent = `完成 · ${data.summary.node_count} 节点 · ${data.summary.edge_count} 连边`;
        tick();
      } catch (error) {
        statusEl.textContent = "查询失败";
        statusEl.className = "status error";
        detailsEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      } finally {
        button.disabled = false;
      }
    }

    form.addEventListener("submit", build);
    resize();
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("CITATION_HOST", "0.0.0.0"),
        port=int(os.getenv("CITATION_PORT", "8001")),
    )
