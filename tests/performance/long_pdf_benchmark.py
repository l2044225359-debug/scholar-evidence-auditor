from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

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


def generate_pdf(path: Path, pages: int) -> float:
    started = time.perf_counter()
    document = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    for page in range(1, pages + 1):
        document.setFont("Helvetica-Bold", 13)
        document.drawString(42, height - 48, f"Long Benchmark Paper - Page {page}")
        document.setFont("Helvetica", 8)
        y = height - 76
        for line in range(42):
            text = (
                f"Section {page}.{line + 1}: retrieval augmented generation "
                "uses dense evidence, graph relations, numeric verification "
                "and citation alignment for reproducible research."
            )
            document.drawString(42, y, text[:112])
            y -= 16
        if page % 10 == 0:
            document.setFont("Helvetica-Bold", 9)
            document.drawString(42, 48, "Formula: P(q|d) = softmax(QK^T / sqrt(d))")
        document.showPage()
    document.save()
    return (time.perf_counter() - started) * 1000


def multipart_upload(path: Path) -> dict:
    boundary = f"----Scholar{uuid.uuid4().hex}"
    content = path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }
    token_value = token()
    if token_value:
        headers["X-BFF-Token"] = token_value
    request = Request(
        f"{BFF}/api/bff/index",
        data=body,
        headers=headers,
        method="POST",
    )
    started = time.perf_counter()
    with urlopen(request, timeout=1800) as response:
        payload = json.loads(response.read().decode("utf-8"))
    payload["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)
    return payload


def cleanup(file_ids: list[str]) -> None:
    token_value = token()
    for file_id in file_ids:
        request = Request(
            f"{BFF}/api/bff/files/{file_id}",
            headers={"X-BFF-Token": token_value} if token_value else {},
            method="DELETE",
        )
        with urlopen(request, timeout=120):
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=240)
    parser.add_argument("--upload", action="store_true")
    parser.add_argument(
        "--output",
        default=str(ROOT / "work/performance-long-pdf.json"),
    )
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf_path = output.with_suffix(".pdf")
    generation_ms = generate_pdf(pdf_path, args.pages)

    started = time.perf_counter()
    reader = PdfReader(str(pdf_path))
    page_count = len(reader.pages)
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    parse_ms = (time.perf_counter() - started) * 1000

    words = text.split()
    chunk_size = 1024
    overlap = 128
    chunks = []
    for start in range(0, len(words), chunk_size - overlap):
        chunk = words[start : start + chunk_size]
        if not chunk:
            break
        chunks.append(" ".join(chunk))

    payload = {
        "suite": "long-pdf",
        "pages": page_count,
        "file_size_mb": round(pdf_path.stat().st_size / 1024 / 1024, 2),
        "extracted_chars": len(text),
        "simulated_chunks": len(chunks),
        "generation_ms": round(generation_ms, 2),
        "pypdf_parse_ms": round(parse_ms, 2),
        "pdf_path": str(pdf_path),
    }
    if args.upload:
        indexed = multipart_upload(pdf_path)
        file_ids = [str(item) for item in indexed.get("file_ids", []) if item]
        payload["indexing"] = indexed
        try:
            cleanup(file_ids)
        finally:
            payload["cleanup_file_ids"] = file_ids

    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
