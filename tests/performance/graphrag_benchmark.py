from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
import tracemalloc
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/kotaemon/libs/ktem"))

from ktem.local_graphrag import LocalGraphRAG  # noqa: E402


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil(len(ordered) * ratio) - 1)
    return ordered[index]


def build_graph(papers_count: int, entities_per_paper: int) -> LocalGraphRAG:
    papers = []
    entity_nodes = []
    entity_edges = []
    citation_edges = []
    entity_types = ("topic", "method", "dataset", "metric", "claim")

    for index in range(papers_count):
        paper_id = f"paper-{index:05d}"
        papers.append(
            {
                "id": paper_id,
                "title": f"Research Paper {index} on Retrieval and Reasoning",
                "abstract": (
                    "This paper studies retrieval augmented generation, "
                    "graph reasoning, evidence selection and language models."
                ),
            }
        )
        if index:
            citation_edges.append(
                {
                    "source": paper_id,
                    "target": f"paper-{max(0, index - 1):05d}",
                }
            )
        if index % 3:
            citation_edges.append(
                {
                    "source": paper_id,
                    "target": f"paper-{max(0, index - 7):05d}",
                }
            )
        for offset in range(entities_per_paper):
            entity_type = entity_types[offset % len(entity_types)]
            entity_id = (
                f"{entity_type}:{index % 80:03d}:{offset // len(entity_types)}"
            )
            entity_nodes.append(
                {
                    "id": entity_id,
                    "type": entity_type,
                    "label": (
                        f"{entity_type.title()} Retrieval Topic {index % 80}"
                    ),
                    "paper_ids": [paper_id],
                }
            )
            entity_edges.append(
                {
                    "source": f"paper:{paper_id}",
                    "target": entity_id,
                    "relation": f"has_{entity_type}",
                    "evidence": f"Evidence for {entity_type} in paper {index}",
                    "confidence": 0.75,
                }
            )

    return LocalGraphRAG(
        papers=papers,
        citation_edges=citation_edges,
        entity_nodes=entity_nodes,
        entity_edges=entity_edges,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--papers", type=int, default=2000)
    parser.add_argument("--entities-per-paper", type=int, default=8)
    parser.add_argument("--requests", type=int, default=64)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--max-hops", type=int, default=2)
    parser.add_argument(
        "--output",
        default=str(ROOT / "work/performance-graphrag.json"),
    )
    args = parser.parse_args()

    tracemalloc.start()
    started = time.perf_counter()
    graph = build_graph(args.papers, args.entities_per_paper)
    build_ms = (time.perf_counter() - started) * 1000
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    queries = [
        "retrieval graph reasoning language models",
        "dual encoder dense retrieval",
        "claim evidence graph method",
        "dataset metric evaluation",
    ]

    def run_query(index: int) -> float:
        query = queries[index % len(queries)]
        begin = time.perf_counter()
        graph.retrieve(
            query,
            top_k=args.top_k,
            max_hops=args.max_hops,
        )
        return (time.perf_counter() - begin) * 1000

    warmup = [run_query(index) for index in range(8)]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        latencies = list(executor.map(run_query, range(args.requests)))
    total_seconds = time.perf_counter() - started

    payload = {
        "suite": "graphrag-large-graph",
        "graph": graph.stats(),
        "build_ms": round(build_ms, 2),
        "peak_memory_mb": round(peak / 1024 / 1024, 2),
        "warmup": {
            "requests": len(warmup),
            "mean_ms": round(statistics.mean(warmup), 2),
        },
        "concurrent": {
            "requests": args.requests,
            "concurrency": args.concurrency,
            "throughput_rps": round(args.requests / total_seconds, 2),
            "mean_ms": round(statistics.mean(latencies), 2),
            "p50_ms": round(percentile(latencies, 0.5), 2),
            "p95_ms": round(percentile(latencies, 0.95), 2),
            "p99_ms": round(percentile(latencies, 0.99), 2),
            "max_ms": round(max(latencies), 2),
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
