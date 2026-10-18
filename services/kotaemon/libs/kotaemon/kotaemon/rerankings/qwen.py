from __future__ import annotations

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
    timeout: float = Param(60, help="Request timeout in seconds.")
    batch_size: int = Param(20, help="Maximum documents per request.")

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
            results = (
                payload.get("results")
                or (payload.get("output") or {}).get("results")
                or []
            )

            for result in results:
                index = int(result["index"])
                document = batch[index]
                document.metadata["reranking_score"] = float(
                    result["relevance_score"]
                )
                reranked.append(document)

        return sorted(
            reranked,
            key=lambda item: item.metadata.get("reranking_score", 0),
            reverse=True,
        )
