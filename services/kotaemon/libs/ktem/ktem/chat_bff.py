from __future__ import annotations

import html
import json
import os
import re
import tempfile
import time
import uuid
from collections import OrderedDict
from copy import deepcopy
from pathlib import Path
from threading import Lock
from typing import Literal

from bs4 import BeautifulSoup
from fastapi import File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from ktem.db.engine import engine
from ktem.db.models import User
from ktem.pages.chat.common import STATE


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=100_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=50_000)
    conversation_id: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)
    file_ids: list[str] | None = None
    language: str = "zh"
    citation_mode: Literal["off", "inline", "highlight"] = "inline"
    include_citations_html: bool = False
    model_mode: Literal["auto", "fast", "deep"] = "auto"
    reasoning_type: Literal["simple", "complex", "ReAct", "ReWOO"] = "simple"
    llm_type: str = ""


class SessionStore:
    def __init__(self, max_items: int = 200, ttl_seconds: int = 86400):
        self._items: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._lock = Lock()
        self._max_items = max_items
        self._ttl_seconds = ttl_seconds

    def get(self, session_id: str) -> dict:
        now = time.time()
        with self._lock:
            item = self._items.get(session_id)
            if item is None:
                return deepcopy(STATE)
            updated_at, state = item
            if now - updated_at > self._ttl_seconds:
                self._items.pop(session_id, None)
                return deepcopy(STATE)
            self._items.move_to_end(session_id)
            return deepcopy(state)

    def put(self, session_id: str, state: dict) -> None:
        with self._lock:
            self._items[session_id] = (time.time(), deepcopy(state))
            self._items.move_to_end(session_id)
            while len(self._items) > self._max_items:
                self._items.popitem(last=False)


SESSIONS = SessionStore()


def _sse(event: str, data: dict) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    )


def _check_token(request: Request) -> None:
    expected = os.getenv("CHAT_BFF_TOKEN", "").strip()
    if not expected:
        return
    provided = request.headers.get("X-BFF-Token", "")
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid BFF token")


def _plain_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _parse_citations(value: str) -> list[dict]:
    if not value:
        return []

    soup = BeautifulSoup(value, "html.parser")
    citations = []
    seen = set()

    for evidence in soup.find_all("details", class_="evidence"):
        summary = evidence.find("summary", recursive=False)
        if summary is None:
            continue
        label = summary.find("i")
        if label is None:
            continue

        label_text = _plain_html(str(label))
        page_match = re.search(r"\[Page\s+(\d+)\]", label_text, re.I)
        file_name = re.sub(
            r"^\[Page\s+\d+\]\s*",
            "",
            label_text,
            flags=re.I,
        ).strip()
        page = int(page_match.group(1)) if page_match else None
        key = (file_name, page)
        if key in seen:
            continue
        seen.add(key)

        content = evidence.find("div", class_="evidence-content")
        snippet = _plain_html(str(content or evidence))
        scores = {}
        for score_name in (
            "Relevance score",
            "Vectorstore score",
            "LLM relevant score",
            "Reranking score",
        ):
            match = re.search(
                rf"{re.escape(score_name)}\s*:\s*(-?\d+(?:\.\d+)?)",
                _plain_html(str(evidence)),
                re.I,
            )
            if match:
                scores[score_name.lower().replace(" ", "_")] = float(
                    match.group(1)
                )

        link = summary.find("a", class_="pdf-link")
        citations.append(
            {
                "file_name": file_name,
                "page": page,
                "snippet": snippet[:1200],
                "scores": scores,
                "preview_url": link.get("data-src") if link else None,
            }
        )

    return citations


def _history_pairs(messages: list[ChatMessage]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    pending_user: str | None = None
    for message in messages:
        if message.role == "user":
            pending_user = message.content
        elif pending_user is not None:
            pairs.append((pending_user, message.content))
            pending_user = None
    return pairs


def _settings_for_user(app, user_id: str) -> dict:
    loaded = app.settings_page.load_setting(user_id)
    if not loaded:
        return {}
    return loaded[0]


def _default_user_id() -> str:
    configured = os.getenv("CHAT_BFF_DEFAULT_USER_ID", "").strip()
    if configured:
        return configured

    with Session(engine) as session:
        statement = select(User).where(User.admin == True)  # noqa: E712
        user = session.exec(statement).first()
    return user.id if user else ""


def _ensure_routed_models() -> None:
    from copy import deepcopy

    from ktem.llms.manager import llms
    from ktem.rerankings.manager import reranking_models_manager

    flash_key = "openai"
    complex_key = "qwen3.8-max"
    rerank_key = "qwen3-rerank"

    if flash_key not in llms:
        raise RuntimeError("Default qwen3.8-flash model is not configured")

    if complex_key not in llms:
        spec = deepcopy(llms.info()[flash_key]["spec"])
        spec["model"] = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        spec["timeout"] = max(float(spec.get("timeout") or 0), 120)
        llms.add(complex_key, spec=spec, default=False)
    else:
        info = llms.info()[complex_key]
        spec = deepcopy(info["spec"])
        expected_model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        if spec.get("model") != expected_model:
            spec["model"] = expected_model
            llms.update(
                complex_key,
                spec=spec,
                default=bool(info.get("default")),
            )

    rerank_spec = {
        "__type__": "kotaemon.rerankings.QwenReranking",
        "base_url": os.getenv("OPENAI_API_BASE", ""),
        "api_key": os.getenv("OPENAI_API_KEY", ""),
        "model_name": os.getenv(
            "OPENAI_RERANK_MODEL",
            "qwen3-rerank",
        ),
        "timeout": 60,
        "batch_size": 20,
    }
    if rerank_key not in reranking_models_manager:
        reranking_models_manager.add(
            rerank_key,
            spec=rerank_spec,
            default=True,
        )
    else:
        info = reranking_models_manager.info()[rerank_key]
        reranking_models_manager.update(
            rerank_key,
            spec=rerank_spec,
            default=True,
        )


def _route_model(
    payload: ChatRequest,
    file_count: int,
) -> tuple[str, str, str]:
    complex_key = "qwen3.8-max"
    flash_model = os.getenv("OPENAI_CHAT_MODEL", "qwen3.8-flash")
    max_model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
    complex_terms = re.compile(
        r"比较|对比|综合|汇总|归纳|综述|交叉|多篇|全部文档|所有文档|"
        r"审计|差异|演进|趋势|文献|元分析|compare|synthesi[sz]e|"
        r"across papers|multi[- ]document|review",
        re.I,
    )

    if payload.model_mode == "deep":
        return complex_key, max_model, "manual_deep"
    if payload.model_mode == "fast":
        return "openai", flash_model, "manual_fast"
    if payload.llm_type:
        return payload.llm_type, payload.llm_type, "explicit_llm"
    if payload.reasoning_type != "simple":
        return complex_key, max_model, "complex_reasoning"
    if (
        file_count > 1
        and (
            len(payload.message) >= 500
            or complex_terms.search(payload.message)
        )
    ):
        return complex_key, max_model, "multi_document"
    return "openai", flash_model, "routine"


def _files_for_user(app, user_id: str) -> list[dict]:
    index = app.index_manager.indices[0]
    source_model = index._resources["Source"]
    statement = select(source_model)
    if index.config.get("private", False):
        statement = statement.where(source_model.user == user_id)

    with Session(engine) as session:
        sources = session.execute(statement).all()

    files = []
    for (source,) in sources:
        files.append(
            {
                "id": source.id,
                "name": source.name,
                "size": source.size,
                "user_id": source.user,
                "note": source.note or {},
            }
        )
    return sorted(files, key=lambda item: item["name"].lower())


def register_chat_bff(api, app) -> None:
    _ensure_routed_models()

    def health():
        from ktem.llms.manager import llms
        from ktem.rerankings.manager import reranking_models_manager

        return {
            "status": "ok",
            "service": "kotaemon-chat-bff",
            "version": "1.2",
            "default_user_id": _default_user_id(),
            "sessions": len(SESSIONS._items),
            "pdf_indexing": True,
            "models": {
                "flash": os.getenv("OPENAI_CHAT_MODEL", "qwen3.8-flash"),
                "complex": os.getenv(
                    "OPENAI_COMPLEX_MODEL",
                    "qwen3.8-max",
                ),
                "embedding": os.getenv(
                    "OPENAI_EMBEDDINGS_MODEL",
                    "qwen3.7-text-embedding",
                ),
                "rerank": os.getenv(
                    "OPENAI_RERANK_MODEL",
                    "qwen3-rerank",
                ),
                "llm_keys": list(llms.options().keys()),
                "rerank_keys": list(reranking_models_manager.options().keys()),
            },
        }

    def files(request: Request):
        _check_token(request)
        user_id = _default_user_id()
        try:
            return {"items": _files_for_user(app, user_id)}
        except Exception as exc:
            return JSONResponse(
                status_code=500,
                content={"error": "files_unavailable", "message": str(exc)},
            )

    def delete_file(file_id: str, request: Request):
        _check_token(request)
        user_id = _default_user_id()
        existing = {
            item["id"]
            for item in _files_for_user(app, user_id)
        }
        if file_id not in existing:
            raise HTTPException(status_code=404, detail="File not found")
        app._index_1.delete_event(file_id)
        return {"status": "deleted", "file_id": file_id}

    async def index_pdf(
        request: Request,
        file: UploadFile = File(...),
    ):
        _check_token(request)
        user_id = _default_user_id()
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")

        safe_name = Path(file.filename).name
        if not safe_name.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Invalid PDF name")
        try:
            with tempfile.TemporaryDirectory(
                prefix="kotaemon_upload_"
            ) as temp_dir:
                temp_path = os.path.join(temp_dir, safe_name)
                total = 0
                first_chunk = True
                with open(temp_path, "wb") as temp_file:
                    while chunk := await file.read(1024 * 1024):
                        if first_chunk:
                            first_chunk = False
                            if not chunk.startswith(b"%PDF"):
                                raise HTTPException(
                                    status_code=400,
                                    detail="Invalid PDF signature",
                                )
                        total += len(chunk)
                        if total > 100 * 1024 * 1024:
                            raise HTTPException(
                                status_code=413,
                                detail="PDF exceeds 100 MB",
                            )
                        temp_file.write(chunk)

                if total == 0:
                    raise HTTPException(status_code=400, detail="Empty PDF")

                settings = _settings_for_user(app, user_id)
                ids = await run_in_threadpool(
                    app._index_1.index_fn_file_with_default_loaders,
                    [temp_path],
                    False,
                    settings,
                    user_id,
                )
                available_items = _files_for_user(app, user_id)
                items = {item["id"]: item for item in available_items}
                matched_items = [
                    item
                    for item in available_items
                    if item["name"] == safe_name
                ]
                if not any(ids):
                    ids = [item["id"] for item in matched_items]
                return {
                    "status": "indexed",
                    "file_ids": ids,
                    "files": [
                        items[file_id]
                        for file_id in ids
                        if file_id in items
                    ],
                }
        except Exception:
            raise

    def chat_stream(payload: ChatRequest, request: Request):
        _check_token(request)
        user_id = _default_user_id()
        conversation_id = payload.conversation_id or str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        chat_state = SESSIONS.get(conversation_id)

        pairs = _history_pairs(payload.history)
        history = pairs + [(payload.message, None)]
        if payload.file_ids is None:
            selecteds = ("all", [], user_id)
        else:
            selecteds = ("select", payload.file_ids, user_id)

        try:
            settings = _settings_for_user(app, user_id)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Unable to load Kotaemon settings: {exc}",
            ) from exc

        try:
            available_files = _files_for_user(app, user_id)
            file_count = (
                len(available_files)
                if payload.file_ids is None
                else len(payload.file_ids)
            )
        except Exception:
            file_count = len(payload.file_ids or [])

        llm_key, routed_model, routing_reason = _route_model(
            payload,
            file_count,
        )
        settings["reasoning.options.simple.llm"] = llm_key
        settings["index.options.1.reranking"] = "qwen3-rerank"
        settings["index.options.1.use_reranking"] = True
        settings["index.options.1.use_llm_reranking"] = False

        def event_stream():
            nonlocal chat_state
            yield _sse(
                "meta",
                {
                    "request_id": request_id,
                    "conversation_id": conversation_id,
                    "user_id": user_id,
                    "model": routed_model,
                    "model_key": llm_key,
                    "routing_reason": routing_reason,
                    "embedding_model": os.getenv(
                        "OPENAI_EMBEDDINGS_MODEL",
                        "qwen3.7-text-embedding",
                    ),
                    "rerank_model": os.getenv(
                        "OPENAI_RERANK_MODEL",
                        "qwen3-rerank",
                    ),
                },
            )
            yield _sse("status", {"phase": "thinking"})

            previous_text = ""
            previous_refs = ""
            previous_citation_signature = ""
            final_text = ""
            final_refs = ""

            try:
                generator = app.chat_page.chat_fn(
                    conversation_id,
                    history,
                    settings,
                    payload.reasoning_type,
                    llm_key,
                    False,
                    payload.citation_mode,
                    payload.language,
                    chat_state,
                    None,
                    user_id,
                    *selecteds,
                )

                for result in generator:
                    if not result or len(result) < 5:
                        continue

                    rendered_history = result[0] or []
                    final_text = (
                        rendered_history[-1][1]
                        if rendered_history
                        else ""
                    ) or ""
                    final_refs = result[1] or ""
                    chat_state = result[4] or chat_state
                    SESSIONS.put(conversation_id, chat_state)

                    if final_text.strip() == "Thinking ...":
                        continue

                    if final_text.startswith(previous_text):
                        delta = final_text[len(previous_text) :]
                        if delta:
                            yield _sse("delta", {"text": delta})
                    elif final_text != previous_text:
                        yield _sse("replace", {"text": final_text})
                    previous_text = final_text

                    if final_refs != previous_refs:
                        citations = _parse_citations(final_refs)
                        signature = json.dumps(
                            citations,
                            ensure_ascii=False,
                            sort_keys=True,
                        )
                        if citations and signature != previous_citation_signature:
                            yield _sse(
                                "citations",
                                {
                                    "items": citations,
                                    "count": len(citations),
                                },
                            )
                            previous_citation_signature = signature
                        previous_refs = final_refs

                citations = _parse_citations(final_refs)
                done_payload = {
                    "request_id": request_id,
                    "conversation_id": conversation_id,
                    "answer": final_text,
                    "citations": citations,
                    "citation_count": len(citations),
                    "model": routed_model,
                    "routing_reason": routing_reason,
                }
                if payload.include_citations_html:
                    done_payload["citations_html"] = final_refs
                    done_payload["citations_text"] = _plain_html(final_refs)

                yield _sse(
                    "done",
                    done_payload,
                )
            except Exception as exc:
                yield _sse(
                    "error",
                    {
                        "request_id": request_id,
                        "conversation_id": conversation_id,
                        "code": "chat_failed",
                        "message": str(exc),
                    },
                )

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Request-Id": request_id,
            },
        )

    api.add_api_route("/api/bff/health", health, methods=["GET"])
    api.add_api_route("/api/bff/files", files, methods=["GET"])
    api.add_api_route(
        "/api/bff/files/{file_id}",
        delete_file,
        methods=["DELETE"],
    )
    api.add_api_route("/api/bff/index", index_pdf, methods=["POST"])
    api.add_api_route(
        "/api/bff/chat/stream",
        chat_stream,
        methods=["POST"],
    )
