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


class AuditRequest(BaseModel):
    question: str = Field(min_length=2, max_length=20_000)
    file_ids: list[str] | None = None
    language: str = "zh"


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


def _parse_citations(value: str, dedupe: bool = True) -> list[dict]:
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
        if dedupe and key in seen:
            continue
        if dedupe:
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


def _extract_citation_markers(value: str) -> list[int]:
    return sorted(
        {
            int(marker)
            for marker in re.findall(r"【(\d+)】", value or "")
        }
    )


def _extract_numbers(value: str) -> list[str]:
    matches = re.findall(
        r"(?<![A-Za-z])[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?",
        value or "",
    )
    return [match.replace(",", "") for match in matches]


def _llm_json(
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 4096,
) -> dict:
    from openai import OpenAI

    client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY", ""),
        base_url=os.getenv("OPENAI_API_BASE", ""),
        timeout=120,
        max_retries=1,
    )
    response = client.chat.completions.create(
        model=model,
        temperature=0.1,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = response.choices[0].message.content or "{}"
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    return json.loads(content)


def _fallback_claims(answer: str) -> list[dict]:
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[。！？.!?])\s*", answer)
        if len(sentence.strip()) >= 8
    ]
    return [
        {
            "id": f"C{index}",
            "claim": sentence,
            "citation_markers": _extract_citation_markers(sentence),
            "kind": "general",
        }
        for index, sentence in enumerate(sentences[:12], start=1)
    ]


def _extract_claims(
    answer: str,
    citations: list[dict],
    model: str,
) -> list[dict]:
    evidence_text = "\n".join(
        f"[{index}] {item['file_name']} page {item['page']}: "
        f"{item['snippet'][:1200]}"
        for index, item in enumerate(citations, start=1)
    )
    prompt = f"""
请从回答中抽取可独立核验的事实 Claim。只能使用回答中的内容。
返回 JSON 对象：{{"claims":[{{"id":"C1","claim":"...",
"citation_markers":[1],"kind":"numeric|general|comparison|method"}}]}}。
每条 Claim 尽量携带原回答中的引用编号；不要编造引用。

回答：
{answer}

可用证据：
{evidence_text}
""".strip()
    try:
        payload = _llm_json(
            model,
            "你是严格的科研证据审计员，输出必须是 JSON。",
            prompt,
        )
        claims = payload.get("claims") or []
        normalized = []
        for index, item in enumerate(claims[:20], start=1):
            claim_text = str(item.get("claim") or "").strip()
            if not claim_text:
                continue
            markers = item.get("citation_markers") or _extract_citation_markers(
                claim_text
            )
            markers = {
                int(marker)
                for marker in markers
                if str(marker).isdigit()
            }
            markers = {
                marker
                for marker in markers
                if 1 <= marker <= len(citations)
            }
            if not markers:
                claim_numbers = _extract_numbers(claim_text)
                markers = {
                    index
                    for index, citation in enumerate(citations, start=1)
                    if any(
                        number in citation.get("snippet", "").replace(",", "")
                        for number in claim_numbers
                    )
                }
            if not markers:
                claim_tokens = {
                    token.lower()
                    for token in re.findall(r"[A-Za-z]{2,}", claim_text)
                }
                markers = {
                    index
                    for index, citation in enumerate(citations, start=1)
                    if claim_tokens
                    & {
                        token.lower()
                        for token in re.findall(
                            r"[A-Za-z]{2,}",
                            citation.get("snippet", ""),
                        )
                    }
                }
            normalized.append(
                {
                    "id": str(item.get("id") or f"C{index}"),
                    "claim": claim_text,
                    "citation_markers": sorted(
                        markers
                    ),
                    "kind": str(item.get("kind") or "general"),
                }
            )
        return normalized or _fallback_claims(answer)
    except Exception:
        return _fallback_claims(answer)


def _semantic_verdicts(
    claims: list[dict],
    citations: list[dict],
    model: str,
) -> dict[str, dict]:
    pending = [
        claim
        for claim in claims
        if claim["kind"] not in {"numeric"}
    ]
    if not pending:
        return {}
    evidence_text = "\n\n".join(
        f"[{index}] {item['file_name']} page {item['page']}:\n"
        f"{item['snippet'][:1600]}"
        for index, item in enumerate(citations, start=1)
    )
    prompt = f"""
根据证据判定每条 Claim。verdict 只能是 supported、contradicted、
insufficient。只有证据明确支持时用 supported；证据明确冲突时用
contradicted；证据不足或无法确认时用 insufficient。
返回 JSON：{{"verdicts":[{{"id":"C1","verdict":"supported",
"reason":"简短理由"}}]}}。

Claims:
{json.dumps(pending, ensure_ascii=False)}

证据：
{evidence_text}
""".strip()
    try:
        payload = _llm_json(
            model,
            "你是科研证据核验器，只能依据给定证据判断。",
            prompt,
        )
        return {
            str(item.get("id")): {
                "verdict": str(item.get("verdict") or "insufficient"),
                "reason": str(item.get("reason") or ""),
            }
            for item in payload.get("verdicts") or []
        }
    except Exception:
        return {}


def _audit_markdown(report: dict) -> str:
    summary = report["summary"]
    lines = [
        "# 证据审计报告",
        "",
        f"- 问题：{report['question']}",
        f"- Claim 数量：{summary['claim_count']}",
        f"- 支持：{summary['supported_count']}",
        f"- 矛盾：{summary['contradicted_count']}",
        f"- 证据不足：{summary['insufficient_count']}",
        f"- 引用完整率：{summary['citation_integrity_rate']:.0%}",
        "",
        "## 审计结论",
        "",
    ]
    for claim in report["claims"]:
        evidence = "；".join(
            f"{item['file_name']} 第 {item['page']} 页"
            for item in claim["evidence"]
        ) or "无"
        numeric = "；".join(
            f"{item['value']}：{'命中' if item['matched'] else '未命中'}"
            for item in claim["numeric_checks"]
        ) or "无数字"
        lines.extend(
            [
                f"### {claim['id']} · {claim['verdict']}",
                "",
                claim["claim"],
                "",
                f"- 引用完整：{'是' if claim['citation_complete'] else '否'}",
                f"- 证据：{evidence}",
                f"- 数字核验：{numeric}",
                f"- 理由：{claim['reason']}",
                "",
            ]
        )
    lines.extend(["## 原始回答", "", report["answer"], ""])
    return "\n".join(lines)


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
            "version": "1.3",
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

    def audit(payload: AuditRequest, request: Request):
        _check_token(request)
        user_id = _default_user_id()
        available_items = _files_for_user(app, user_id)
        file_count = (
            len(available_items)
            if payload.file_ids is None
            else len(payload.file_ids)
        )
        chat_payload = ChatRequest(
            message=payload.question,
            file_ids=payload.file_ids,
            language=payload.language,
            citation_mode="inline",
            model_mode="auto",
        )
        llm_key, routed_model, routing_reason = _route_model(
            chat_payload,
            file_count,
        )
        settings = _settings_for_user(app, user_id)
        settings["reasoning.options.simple.llm"] = llm_key
        settings["index.options.1.reranking"] = "qwen3-rerank"
        settings["index.options.1.use_reranking"] = True
        settings["index.options.1.use_llm_reranking"] = False
        selecteds = (
            ("all", [], user_id)
            if payload.file_ids is None
            else ("select", payload.file_ids, user_id)
        )

        final_text = ""
        final_refs = ""
        generator = app.chat_page.chat_fn(
            str(uuid.uuid4()),
            [(payload.question, None)],
            settings,
            "simple",
            llm_key,
            False,
            "inline",
            payload.language,
            deepcopy(STATE),
            None,
            user_id,
            *selecteds,
        )
        for result in generator:
            if result and len(result) >= 5:
                rendered_history = result[0] or []
                final_text = (
                    rendered_history[-1][1] if rendered_history else ""
                ) or ""
                final_refs = result[1] or ""
        if not final_text:
            raise HTTPException(status_code=502, detail="Audit answer was empty")

        citations = _parse_citations(final_refs, dedupe=False)
        flash_model = os.getenv("OPENAI_CHAT_MODEL", "qwen3.8-flash")
        max_model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        raw_claims = _extract_claims(final_text, citations, flash_model)
        semantic_model = max_model if file_count > 1 else flash_model
        semantic = _semantic_verdicts(
            raw_claims,
            citations,
            semantic_model,
        )

        claim_results = []
        for claim in raw_claims:
            markers = claim["citation_markers"] or _extract_citation_markers(
                claim["claim"]
            )
            evidence = [
                citations[marker - 1]
                for marker in markers
                if 1 <= marker <= len(citations)
            ]
            citation_complete = bool(markers) and len(evidence) == len(markers)
            evidence_pages = {
                (item.get("file_name"), item.get("page"))
                for item in evidence
            }
            verification_evidence = {
                (
                    item.get("file_name"),
                    item.get("page"),
                    item.get("snippet"),
                ): item
                for item in citations
                if (item.get("file_name"), item.get("page"))
                in evidence_pages
            }
            evidence_text = " ".join(
                item.get("snippet", "")
                for item in verification_evidence.values()
            )
            numbers = _extract_numbers(claim["claim"])
            numeric_checks = [
                {
                    "value": number,
                    "matched": number in evidence_text.replace(",", ""),
                }
                for number in numbers
            ]

            if not evidence or not citation_complete:
                verdict = "insufficient"
                reason = "Claim 缺少可解析的页码证据或引用不完整。"
            elif numeric_checks and all(
                item["matched"] for item in numeric_checks
            ):
                verdict = "supported"
                reason = "Claim 中的数字均在对应证据页中出现。"
            elif numeric_checks and any(
                item["matched"] for item in numeric_checks
            ):
                verdict = "insufficient"
                reason = "部分数字能在证据中命中，但仍需人工复核。"
            elif numeric_checks:
                evidence_numbers = _extract_numbers(evidence_text)
                verdict = (
                    "contradicted"
                    if evidence_numbers
                    else "insufficient"
                )
                reason = (
                    "Claim 数字与证据中的数字不一致。"
                    if evidence_numbers
                    else "证据页未包含 Claim 所引用的数字。"
                )
            else:
                semantic_verdict = semantic.get(claim["id"], {})
                verdict = semantic_verdict.get("verdict", "insufficient")
                if verdict not in {
                    "supported",
                    "contradicted",
                    "insufficient",
                }:
                    verdict = "insufficient"
                reason = semantic_verdict.get(
                    "reason",
                    "语义证据不足，无法确认。",
                )

            claim_results.append(
                {
                    **claim,
                    "citation_markers": markers,
                    "citation_complete": citation_complete,
                    "evidence": evidence,
                    "numeric_checks": numeric_checks,
                    "verdict": verdict,
                    "reason": reason,
                }
            )

        supported = sum(
            item["verdict"] == "supported" for item in claim_results
        )
        contradicted = sum(
            item["verdict"] == "contradicted" for item in claim_results
        )
        insufficient = sum(
            item["verdict"] == "insufficient" for item in claim_results
        )
        complete = sum(
            item["citation_complete"] for item in claim_results
        )
        report = {
            "question": payload.question,
            "answer": final_text,
            "citations": citations,
            "claims": claim_results,
            "summary": {
                "claim_count": len(claim_results),
                "supported_count": supported,
                "contradicted_count": contradicted,
                "insufficient_count": insufficient,
                "citation_integrity_rate": (
                    complete / len(claim_results) if claim_results else 0
                ),
            },
            "models": {
                "answer": routed_model,
                "extraction": flash_model,
                "verification": semantic_model,
                "embedding": os.getenv(
                    "OPENAI_EMBEDDINGS_MODEL",
                    "qwen3.7-text-embedding",
                ),
                "rerank": os.getenv("OPENAI_RERANK_MODEL", "qwen3-rerank"),
            },
            "routing_reason": routing_reason,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        report["markdown"] = _audit_markdown(report)
        return report

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
        "/api/bff/audit",
        audit,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/chat/stream",
        chat_stream,
        methods=["POST"],
    )
