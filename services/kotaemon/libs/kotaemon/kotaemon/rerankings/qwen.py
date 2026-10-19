from __future__ import annotations

import time
from urllib.parse import urlparse

import requests

from kotaemon.base import Document, Param

from .base import BaseReranking


class QwenReranking(BaseReranking):
    """Alibaba Cloud Model Studio text reranking."""

    base_url: str = Param(
        required=True,
        help="OpenAI-compatible workspace base URL.",
    )
    api_key: str = Param(required=True, help="Workspace API key.")
    model_name: str = Param(
        "qwen3-rerank",
        help="Model Studio rerank model ID.",
    )
    endpoint_url: str | None = Param(
        None,
        help="Optional native rerank endpoint override.",
    )
    timeout: float = Param(30, help="Request timeout in seconds.")
    batch_size: int = Param(20, help="Maximum documents per request.")
    max_retries: int = Param(2, help="Retries before falling back to retrieval order.")

    def _endpoint(self) -> str:
        if self.endpoint_url:
            return self.endpoint_url
        parsed = urlparse(self.base_url)
        return (
            f"{parsed.scheme}://{parsed.netloc}"
            "/compatible-api/v1/reranks"
        )

    def run(self, documents: list[Document], query: str) -> list[Document]:
        if not documents:
            return []
        if isinstance(documents[0], str):
            documents = self.prepare_input(documents)

        reranked: list[Document] = []
        for start in range(0, len(documents), self.batch_size):
            batch = documents[start : start + self.batch_size]
            response = None
            payload = None
            for attempt in range(self.max_retries + 1):
                try:
                    response = requests.post(
                        self._endpoint(),
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model_name,
                            "query": query,
                            "documents": [doc.content for doc in batch],
                            "top_n": len(batch),
                            "return_documents": False,
                        },
                        timeout=self.timeout,
                    )
                    response.raise_for_status()
                    payload = response.json()
                    break
                except (requests.RequestException, ValueError) as exc:
                    if attempt >= self.max_retries:
                        print(
                            "Rerank unavailable; using retrieval order:",
                            type(exc).__name__,
                        )
                        return documents
                    time.sleep(0.5 * (attempt + 1))

            if payload is None:
                return documents
            results = (
                payload.get("results")
                or (
                    (payload.get("output") or {}).get("results")
                    if isinstance(payload.get("output"), dict)
                    else None
                )
                or []
            )

            for result in results:
                if isinstance(result, dict):
                    index = int(result["index"])
                    score = float(result["relevance_score"])
                elif isinstance(result, (list, tuple)) and len(result) >= 2:
                    index = int(result[0])
                    score = float(result[1])
                else:
                    continue
                if index < 0 or index >= len(batch):
                    continue
                document = batch[index]
                document.metadata["reranking_score"] = score
                reranked.append(document)

        ranked = sorted(
            reranked,
            key=lambda item: item.metadata.get("reranking_score", 0),
            reverse=True,
        )
        ranked_ids = {item.doc_id for item in ranked}
        ranked.extend(item for item in documents if item.doc_id not in ranked_ids)
        return ranked
