from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / "apps/web/.env.local"
BFF = os.getenv("KOTAEMON_BFF_URL", "http://127.0.0.1:7860").rstrip("/")


def token() -> str:
    if not ENV_PATH.exists():
        return ""
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("CHAT_BFF_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil(len(ordered) * ratio) - 1)
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=int, default=32)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--question", default="实体与引用图如何支持 RAG 推理？")
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--max-hops", type=int, default=2)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument(
        "--output",
        default=str(ROOT / "work/performance-graphrag-http.json"),
    )
    args = parser.parse_args()
    auth = token()
    body = json.dumps(
        {
            "question": args.question,
            "language": "zh",
            "top_k": args.top_k,
            "max_hops": args.max_hops,
            "refresh": args.refresh,
        },
        ensure_ascii=False,
    ).encode("utf-8")

    def request_once(_: int) -> tuple[float, dict]:
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["X-BFF-Token"] = auth
        request = Request(
            f"{BFF}/api/bff/graphrag/retrieve",
            data=body,
            headers=headers,
            method="POST",
        )
        started = time.perf_counter()
        with urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return (time.perf_counter() - started) * 1000, payload

    warm_latency, warm_payload = request_once(0)
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        responses = list(executor.map(request_once, range(args.requests)))
    total_seconds = time.perf_counter() - started
    latencies = [item[0] for item in responses]
    payloads = [item[1] for item in responses]

    result = {
        "suite": "graphrag-http-concurrency",
        "requests": args.requests,
        "concurrency": args.concurrency,
        "warmup_ms": round(warm_latency, 2),
        "throughput_rps": round(args.requests / total_seconds, 2),
        "mean_ms": round(statistics.mean(latencies), 2),
        "p50_ms": round(percentile(latencies, 0.5), 2),
        "p95_ms": round(percentile(latencies, 0.95), 2),
        "p99_ms": round(percentile(latencies, 0.99), 2),
        "max_ms": round(max(latencies), 2),
        "papers_returned": [
            len(item.get("papers", [])) for item in payloads
        ],
        "graph": payloads[0].get("graph"),
        "build": payloads[0].get("build"),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
