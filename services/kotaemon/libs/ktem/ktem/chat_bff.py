from __future__ import annotations

import html
import hashlib
import json
import logging
import os
import re
import shutil
import time
import unicodedata
import uuid
from collections import OrderedDict
from copy import deepcopy
from difflib import SequenceMatcher
from pathlib import Path
from threading import Lock
from typing import Literal

from bs4 import BeautifulSoup
from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from ktem.components import filestorage_path
from ktem.db.engine import engine
from ktem.db.models import User
from ktem.pages.chat.common import STATE

logger = logging.getLogger(__name__)


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


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=30_000)
    source_language: Literal["en", "zh"] = "en"
    target_language: Literal["en", "zh"] = "zh"


class ArxivToolRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=300)


class WritingToolRequest(BaseModel):
    idea: str = Field(min_length=5, max_length=4000)
    file_ids: list[str] | None = None
    language: Literal["zh", "en"] = "zh"


class FutureWorkPaper(BaseModel):
    title: str
    year: int | None = None
    future_work: list[str] = Field(default_factory=list)


class FutureWorkRequest(BaseModel):
    papers: list[FutureWorkPaper]
    foundational: list[dict] = Field(default_factory=list)
    language: Literal["zh", "en"] = "zh"


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
TRANSLATION_CACHE: OrderedDict[str, str] = OrderedDict()
TRANSLATION_LOCK = Lock()


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
        extra_body={"enable_thinking": False},
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


def _apply_language_instruction(settings: dict, language: str) -> dict:
    instructions = {
        "zh": (
            "你必须始终使用简体中文撰写最终回答。论文标题、作者、专有名词和"
            "必要引文可以保留英文，但解释、结论和推理必须使用简体中文。"
        ),
        "en": "You must write the final answer entirely in English.",
    }
    instruction = instructions.get(language)
    if not instruction:
        return settings
    key = "reasoning.options.simple.system_prompt"
    current = str(settings.get(key) or "").strip()
    if instruction not in current:
        settings[key] = f"{current}\n{instruction}".strip()
    return settings


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

    flash_info = llms.info()[flash_key]
    flash_spec = deepcopy(flash_info["spec"])
    desired_max_tokens = int(os.getenv("OPENAI_CHAT_MAX_TOKENS", "1000"))
    extra_body = dict(flash_spec.get("extra_body") or {})
    extra_body["enable_thinking"] = False
    if (
        flash_spec.get("max_tokens") != desired_max_tokens
        or flash_spec.get("extra_body") != extra_body
    ):
        flash_spec["max_tokens"] = desired_max_tokens
        flash_spec["extra_body"] = extra_body
        llms.update(
            flash_key,
            spec=flash_spec,
            default=bool(flash_info.get("default")),
        )

    if complex_key not in llms:
        spec = deepcopy(flash_spec)
        spec["model"] = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        spec["timeout"] = max(float(spec.get("timeout") or 0), 120)
        llms.add(complex_key, spec=spec, default=False)
    else:
        info = llms.info()[complex_key]
        spec = deepcopy(info["spec"])
        expected_model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        expected_timeout = max(float(spec.get("timeout") or 0), 120)
        if (
            spec.get("model") != expected_model
            or spec.get("max_tokens") != desired_max_tokens
            or spec.get("extra_body") != extra_body
            or spec.get("timeout") != expected_timeout
        ):
            spec["model"] = expected_model
            spec["max_tokens"] = desired_max_tokens
            spec["extra_body"] = extra_body
            spec["timeout"] = expected_timeout
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
        "timeout": float(os.getenv("OPENAI_RERANK_TIMEOUT", "60")),
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


_ARXIV_PATTERN = re.compile(
    r"arxiv[:\s/]*(\d{4}\.\d{4,5})(v\d+)?",
    re.IGNORECASE,
)
_SENTENCE_PATTERN = re.compile(r"(?<=[。！？.!?])\s+")
_FINGERPRINT_CACHE: dict[str, tuple[int, int, dict]] = {}
_ARXIV_METADATA_CACHE: dict[str, tuple[float, dict]] = {}
_ARXIV_METADATA_LOCK = Lock()


def _normalize_pdf_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    return re.sub(r"\s+", " ", value).strip()


def _text_shingles(value: str, width: int = 5, limit: int = 6000) -> set:
    tokens = re.findall(r"[a-z0-9]{2,}|[\u3400-\u9fff]", value.lower())
    tokens = tokens[:limit]
    if len(tokens) < width:
        return set(tokens)
    return {
        tuple(tokens[index : index + width])
        for index in range(len(tokens) - width + 1)
    }


def _guess_pdf_title(page_text: str, metadata_title: str = "") -> str:
    title = _normalize_pdf_text(metadata_title)
    if title and title.lower() not in {"untitled", "title", "document"}:
        return title[:500]

    ignored = (
        "arxiv",
        "published as",
        "proceedings of",
        "conference on",
        "abstract",
    )
    for line in (page_text or "").splitlines()[:24]:
        candidate = _normalize_pdf_text(line)
        lowered = candidate.lower()
        if (
            len(candidate) >= 12
            and not any(token in lowered for token in ignored)
            and not candidate.isdigit()
        ):
            return candidate[:500]
    return ""


def _extract_abstract(value: str) -> str:
    match = re.search(
        r"\babstract\b(.*?)(?:\bintroduction\b|\b1\s+introduction\b)",
        value,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return _normalize_pdf_text(match.group(1))[:6000]
    return _normalize_pdf_text(value)[:3000]


def _fingerprint_pdf_bytes(data: bytes, file_name: str) -> dict:
    import fitz

    with fitz.open(stream=data, filetype="pdf") as document:
        if document.needs_pass:
            raise ValueError("Encrypted PDFs are not supported")
        metadata = document.metadata or {}
        page_count = document.page_count
        pages = min(page_count, 8)
        page_text = "\n".join(
            document.load_page(index).get_text("text", sort=True)
            for index in range(pages)
        )

    normalized = _normalize_pdf_text(page_text)
    # Limit identifier detection to the opening pages to avoid treating a
    # cited arXiv identifier in the body or references as the paper itself.
    arxiv_match = _ARXIV_PATTERN.search(normalized[:12000])
    canonical_id = ""
    version = 0
    if arxiv_match:
        canonical_id = f"arxiv:{arxiv_match.group(1)}"
        version_text = arxiv_match.group(2) or ""
        if version_text[1:].isdigit():
            version = int(version_text[1:])

    return {
        "file_name": file_name,
        "content_sha256": hashlib.sha256(data).hexdigest(),
        "title": _guess_pdf_title(page_text, metadata.get("title", "")),
        "canonical_id": canonical_id,
        "version": version,
        "page_count": page_count,
        "normalized_text": normalized,
        "abstract": _extract_abstract(normalized),
        "shingles": _text_shingles(normalized),
    }


def _fingerprint_pdf_path(path: Path, file_name: str) -> dict:
    stat = path.stat()
    key = str(path.resolve())
    cached = _FINGERPRINT_CACHE.get(key)
    if cached and cached[0] == stat.st_size and cached[1] == stat.st_mtime_ns:
        return cached[2]

    fingerprint = _fingerprint_pdf_bytes(path.read_bytes(), file_name)
    _FINGERPRINT_CACHE[key] = (stat.st_size, stat.st_mtime_ns, fingerprint)
    return fingerprint


def _existing_document_fingerprints(app, user_id: str) -> list[dict]:
    index = app.index_manager.indices[0]
    source_model = index._resources["Source"]
    storage_path = Path(index._resources["FileStoragePath"])
    statement = select(source_model)
    if index.config.get("private", False):
        statement = statement.where(source_model.user == user_id)

    with Session(engine) as session:
        sources = session.execute(statement).all()

    results = []
    for (source,) in sources:
        stored_path = storage_path / (source.path or "")
        if not source.path or not stored_path.exists():
            continue
        try:
            fingerprint = _fingerprint_pdf_path(stored_path, source.name)
        except Exception as exc:
            logger.warning(
                "Unable to fingerprint indexed PDF %s: %s",
                source.name,
                exc,
            )
            continue
        results.append(
            {
                "id": source.id,
                "name": source.name,
                "size": source.size,
                "path": str(stored_path),
                "fingerprint": fingerprint,
            }
        )
    return results


def _sentence_changes(older: str, newer: str) -> dict:
    old_sentences = [
        item.strip()
        for item in _SENTENCE_PATTERN.split(older)
        if len(item.strip()) >= 30
    ]
    new_sentences = [
        item.strip()
        for item in _SENTENCE_PATTERN.split(newer)
        if len(item.strip()) >= 30
    ]
    matcher = SequenceMatcher(
        None,
        old_sentences,
        new_sentences,
        autojunk=False,
    )
    removed = []
    added = []
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag not in {"replace", "delete", "insert"}:
            continue
        removed.extend(old_sentences[old_start:old_end])
        added.extend(new_sentences[new_start:new_end])
    return {
        "added": [item[:320] for item in added[:6]],
        "removed": [item[:320] for item in removed[:6]],
    }


def _compare_document_fingerprints(
    existing: dict,
    incoming: dict,
    existing_id: str = "",
    existing_name: str = "",
) -> dict | None:
    existing_shingles = existing["shingles"]
    incoming_shingles = incoming["shingles"]
    union = existing_shingles | incoming_shingles
    text_similarity = (
        len(existing_shingles & incoming_shingles) / len(union)
        if union
        else 0.0
    )
    title_similarity = SequenceMatcher(
        None,
        existing["title"].lower(),
        incoming["title"].lower(),
        autojunk=False,
    ).ratio()
    abstract_similarity = SequenceMatcher(
        None,
        existing["abstract"].lower(),
        incoming["abstract"].lower(),
        autojunk=False,
    ).ratio()

    same_canonical = bool(
        existing["canonical_id"]
        and existing["canonical_id"] == incoming["canonical_id"]
    )
    likely_same = (
        same_canonical
        or text_similarity >= 0.72
        or (
            title_similarity >= 0.94
            and abstract_similarity >= 0.55
        )
    )
    if not likely_same:
        return None

    existing_version = int(existing.get("version") or 0)
    incoming_version = int(incoming.get("version") or 0)
    if existing["content_sha256"] == incoming["content_sha256"]:
        relationship = "exact_duplicate"
        recommendation = "keep_existing"
    elif incoming_version and existing_version:
        if incoming_version > existing_version:
            relationship = "incoming_newer"
            recommendation = "keep_incoming"
        elif incoming_version < existing_version:
            relationship = "incoming_older"
            recommendation = "keep_existing"
        else:
            relationship = "same_version_revision"
            recommendation = "review"
    else:
        relationship = "semantic_duplicate"
        recommendation = "review"

    char_ratio = SequenceMatcher(
        None,
        existing["normalized_text"][:50000],
        incoming["normalized_text"][:50000],
        autojunk=False,
    ).ratio()
    changes = _sentence_changes(
        existing["normalized_text"],
        incoming["normalized_text"],
    )
    similarity = (
        1.0
        if same_canonical
        else max(text_similarity, title_similarity * 0.85)
    )
    return {
        "existing_id": existing_id or existing.get("id", ""),
        "existing_name": (
            existing_name
            or existing.get("name")
            or incoming.get("file_name", "")
        ),
        "existing_version": existing_version,
        "incoming_version": incoming_version,
        "canonical_id": incoming.get("canonical_id")
        or existing.get("canonical_id")
        or "",
        "relationship": relationship,
        "recommendation": recommendation,
        "similarity": round(similarity, 4),
        "text_similarity": round(text_similarity, 4),
        "title_similarity": round(title_similarity, 4),
        "abstract_similarity": round(abstract_similarity, 4),
        "changed_ratio": round(max(0.0, 1.0 - char_ratio), 4),
        "changes": changes,
    }


def _tool_step(
    steps: list[dict],
    key: str,
    title: str,
    detail: str,
    started_at: float,
    status: str = "success",
) -> None:
    steps.append(
        {
            "id": key,
            "title": title,
            "detail": detail,
            "status": status,
            "duration_ms": round((time.perf_counter() - started_at) * 1000),
        }
    )


def _parse_arxiv_identifier(value: str) -> str:
    match = re.search(
        r"(?:\d{4}\.\d{4,5})(?:v\d+)?",
        value or "",
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError("A valid arXiv identifier is required")
    return match.group(0)


def _fetch_arxiv_metadata(arxiv_id: str) -> dict:
    import subprocess
    import xml.etree.ElementTree as ET

    now = time.time()
    with _ARXIV_METADATA_LOCK:
        cached = _ARXIV_METADATA_CACHE.get(arxiv_id)
        if cached and now - cached[0] < 86400:
            return cached[1]

    curl_path = shutil.which("curl")
    if not curl_path:
        return {}
    response = subprocess.run(
        [
            curl_path,
            "-fsSL",
            "--max-time",
            "30",
            f"https://export.arxiv.org/api/query?id_list={arxiv_id}",
        ],
        capture_output=True,
        text=True,
        timeout=40,
        check=False,
    )
    if response.returncode != 0:
        return {}
    root = ET.fromstring(response.stdout)
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    entry = root.find("atom:entry", namespace)
    if entry is None:
        return {}
    published = entry.findtext("atom:published", "", namespace)
    year = None
    if published[:4].isdigit():
        year = int(published[:4])
    metadata = {
        "title": re.sub(
            r"\s+",
            " ",
            entry.findtext("atom:title", "", namespace),
        ).strip(),
        "summary": re.sub(
            r"\s+",
            " ",
            entry.findtext("atom:summary", "", namespace),
        ).strip(),
        "authors": [
            re.sub(
                r"\s+",
                " ",
                author.findtext("atom:name", "", namespace),
            ).strip()
            for author in entry.findall("atom:author", namespace)
        ],
        "year": year,
    }
    with _ARXIV_METADATA_LOCK:
        _ARXIV_METADATA_CACHE[arxiv_id] = (now, metadata)
    return metadata


def _normalize_for_match(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").lower()
    return re.sub(r"[^a-z0-9\u3400-\u9fff]+", " ", value).strip()


def _extract_pdf_citation_sections(path: Path) -> dict:
    import fitz

    with fitz.open(str(path)) as document:
        page_texts = [
            document.load_page(index).get_text("text", sort=True)
            for index in range(document.page_count)
        ]
    full_text = "\n".join(page_texts)
    normalized = _normalize_pdf_text(full_text)

    reference_match = re.search(
        r"(?i)(?:^|\n)\s*(references|bibliography)\s*(?:\n|$)",
        full_text,
    )
    reference_text = (
        full_text[reference_match.start() :]
        if reference_match
        else full_text[-30000:]
    )
    matches = list(
        re.finditer(
            r"(?m)(?:^|\n)\s*(?:\[(\d+)\]|(\d+)\.)\s+",
            reference_text,
        )
    )
    references = []
    for index, match in enumerate(matches[:120]):
        start = match.end()
        end = (
            matches[index + 1].start()
            if index + 1 < len(matches)
            else len(reference_text)
        )
        item = _normalize_pdf_text(reference_text[start:end])[:1800]
        if item:
            references.append(item)

    future_work = []
    for match in re.finditer(
        r"(?i)\b(future work|future directions|future research)\b",
        normalized,
    ):
        snippet = normalized[match.start() : match.start() + 2400]
        cutoff = re.search(
            r"(?i)\b(references|acknowledg|appendix)\b",
            snippet[40:],
        )
        if cutoff:
            snippet = snippet[: cutoff.start() + 40]
        snippet = _normalize_pdf_text(snippet)
        if len(snippet) >= 80:
            future_work.append(snippet[:1800])

    return {
        "references": references,
        "future_work": future_work[:4],
        "full_text": normalized,
    }


def _analyze_csv_bytes(data: bytes, question: str) -> dict:
    import base64
    from io import BytesIO, StringIO

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import pandas as pd

    text = None
    for encoding in ("utf-8-sig", "gb18030", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Unable to decode CSV")

    frame = pd.read_csv(StringIO(text))
    if frame.empty and len(frame.columns) == 0:
        raise ValueError("CSV contains no columns")
    frame.columns = [str(column) for column in frame.columns]

    columns = []
    for name in frame.columns:
        series = frame[name]
        columns.append(
            {
                "name": name,
                "dtype": str(series.dtype),
                "missing": int(series.isna().sum()),
                "unique": int(series.nunique(dropna=True)),
            }
        )

    numeric_columns = list(
        frame.select_dtypes(include="number").columns
    )
    categorical_columns = [
        name
        for name in frame.columns
        if name not in numeric_columns
        and int(frame[name].nunique(dropna=True)) <= max(30, len(frame) // 3)
    ]
    datetime_columns = [
        name
        for name in frame.columns
        if (
            "date" in name.lower()
            or "time" in name.lower()
            or "year" in name.lower()
        )
    ]

    mentioned = [
        name
        for name in frame.columns
        if name.lower() in (question or "").lower()
    ]
    mentioned_numeric = [
        name for name in mentioned if name in numeric_columns
    ]
    mentioned_categorical = [
        name
        for name in mentioned
        if name not in numeric_columns
    ]

    x_column = ""
    y_column = ""
    chart_type = "line"
    chart_frame = frame
    if datetime_columns and numeric_columns:
        x_column = (
            next(
                (
                    name
                    for name in mentioned
                    if name in datetime_columns
                ),
                datetime_columns[0],
            )
        )
        y_column = (
            next(
                (
                    name
                    for name in mentioned
                    if name in numeric_columns
                ),
                numeric_columns[0],
            )
        )
        chart_frame = (
            frame.assign(
                __x=pd.to_datetime(frame[x_column], errors="coerce")
            )
            .dropna(subset=["__x"])
            .groupby("__x", as_index=False)[y_column]
            .mean()
        )
        x_column = "__x"
        chart_type = "line"
    elif mentioned_categorical and numeric_columns:
        x_column = mentioned_categorical[0]
        y_column = (
            mentioned_numeric[0] if mentioned_numeric else numeric_columns[0]
        )
        chart_frame = (
            frame.groupby(x_column, dropna=False)[y_column]
            .mean()
            .sort_values(ascending=False)
            .head(15)
            .reset_index()
        )
        chart_type = "bar"
    elif len(numeric_columns) >= 2:
        x_column = (
            mentioned_numeric[0] if mentioned_numeric else numeric_columns[0]
        )
        y_column = next(
            (
                name
                for name in mentioned_numeric
                if name != x_column
            ),
            next(
                (name for name in numeric_columns if name != x_column),
                numeric_columns[1],
            ),
        )
        chart_type = "scatter"
    elif numeric_columns:
        x_column = "row"
        y_column = (
            mentioned_numeric[0] if mentioned_numeric else numeric_columns[0]
        )
        chart_frame = frame.copy()
        chart_frame[x_column] = range(1, len(chart_frame) + 1)
        chart_type = "line"
    elif categorical_columns:
        x_column = mentioned_categorical[0] if mentioned_categorical else categorical_columns[0]
        frame_series = frame[x_column].astype(str).value_counts().head(15)
        chart_frame = frame_series.rename_axis(x_column).reset_index(name="count")
        y_column = "count"
        chart_type = "bar"
    else:
        raise ValueError("CSV has no numeric or categorical column to plot")

    figure, axis = plt.subplots(figsize=(8.2, 4.6))
    try:
        if chart_type == "bar":
            axis.bar(
                chart_frame[x_column].astype(str),
                chart_frame[y_column],
                color="#315d68",
            )
            axis.tick_params(axis="x", rotation=35, labelsize=8)
        elif chart_type == "scatter":
            axis.scatter(
                chart_frame[x_column],
                chart_frame[y_column],
                s=24,
                alpha=0.72,
                color="#315d68",
            )
        else:
            axis.plot(
                chart_frame[x_column],
                chart_frame[y_column],
                color="#315d68",
                linewidth=1.8,
            )
        axis.set_xlabel(str(x_column))
        axis.set_ylabel(str(y_column))
        axis.set_title(f"{y_column} by {x_column}", fontsize=11)
        axis.grid(axis="y", color="#d8dfdb", linewidth=0.6)
        axis.spines["top"].set_visible(False)
        axis.spines["right"].set_visible(False)
        figure.tight_layout()
        image = BytesIO()
        figure.savefig(image, format="png", dpi=150)
        chart_base64 = base64.b64encode(image.getvalue()).decode("ascii")
    finally:
        plt.close(figure)

    chart_points = []
    for _, row in chart_frame.head(40).iterrows():
        raw_x = row[x_column]
        raw_y = row[y_column]
        try:
            numeric_y = float(raw_y)
        except (TypeError, ValueError):
            continue
        numeric_x = None
        try:
            numeric_x = float(raw_x)
        except (TypeError, ValueError):
            pass
        x_label = (
            raw_x.strftime("%Y-%m-%d")
            if hasattr(raw_x, "strftime")
            else str(raw_x)
        )
        chart_points.append(
            {
                "x": x_label[:80],
                "numeric_x": numeric_x,
                "y": numeric_y,
            }
        )

    profile = {
        "rows": int(len(frame)),
        "columns": len(frame.columns),
        "fields": columns[:80],
        "numeric_columns": numeric_columns[:30],
        "categorical_columns": categorical_columns[:30],
    }
    numeric_summary = {}
    if numeric_columns:
        numeric_summary = json.loads(
            frame[numeric_columns]
            .describe()
            .round(4)
            .to_json(force_ascii=False)
        )
    categorical_summary = {}
    for name in categorical_columns[:8]:
        categorical_summary[name] = {
            str(key): int(value)
            for key, value in (
                frame[name]
                .astype(str)
                .value_counts(dropna=False)
                .head(8)
                .items()
            )
        }
    return {
        "profile": profile,
        "numeric_summary": numeric_summary,
        "categorical_summary": categorical_summary,
        "chart": {
            "type": chart_type,
            "x": str(x_column),
            "y": str(y_column),
            "base64": chart_base64,
            "points": chart_points,
        },
    }


def _mermaid_chart_script(chart: dict) -> str:
    points = chart.get("points") or []
    if not points:
        return "xychart-beta\n    title \"No chart data\""
    values = [float(point["y"]) for point in points]
    minimum = min(values)
    maximum = max(values)
    if minimum == maximum:
        minimum -= 1
        maximum += 1
    labels = [
        point["x"].replace('"', "'").replace("\n", " ")
        for point in points
    ]
    series_type = "bar" if chart.get("type") == "bar" else "line"
    x_axis = ", ".join(json.dumps(label, ensure_ascii=False) for label in labels)
    y_series = ", ".join(f"{value:.6g}" for value in values)
    return "\n".join(
        [
            "xychart-beta",
            f"    title \"{chart['y']} by {chart['x']}\"",
            f"    x-axis \"{chart['x']}\" [{x_axis}]",
            f"    y-axis \"{chart['y']}\" {minimum:.6g} --> {maximum:.6g}",
            f"    {series_type} [{y_series}]",
        ]
    )


def _latex_escape(value: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in str(value))


def _tikz_chart_script(chart: dict) -> str:
    points = chart.get("points") or []
    if not points:
        return "% No chart data available"
    all_numeric = all(point.get("numeric_x") is not None for point in points)
    chart_type = chart.get("type", "line")
    labels = [
        _latex_escape(point["x"])
        for point in points
    ]
    coordinates = []
    if all_numeric:
        for point in points:
            coordinates.append(
                f"({float(point['numeric_x']):.6g},{float(point['y']):.6g})"
            )
        plot_options = (
            "only marks, mark=*, mark size=2pt"
            if chart_type == "scatter"
            else "mark=*, mark size=1.5pt"
        )
        axis_options = []
    else:
        for label, point in zip(labels, points):
            coordinates.append(f"({label},{float(point['y']):.6g})")
        plot_options = "ybar, bar width=8pt" if chart_type == "bar" else "mark=*"
        axis_options = [
            "  symbolic x coords={" + ",".join(labels) + "},",
            "  xtick=data,",
            "  x tick label style={rotate=30,anchor=east,font=\\small},",
        ]
    lines = [
        "% Requires \\usepackage{pgfplots}",
        "\\begin{tikzpicture}",
        "\\begin{axis}[",
        "  width=0.92\\linewidth,",
        "  height=7cm,",
        "  grid=major,",
        f"  title={{{_latex_escape(chart['y'])}}},",
        f"  xlabel={{{_latex_escape(chart['x'])}}},",
        f"  ylabel={{{_latex_escape(chart['y'])}}},",
        *axis_options,
        "]",
        f"\\addplot[{plot_options}] coordinates {{",
        "  " + "\n  ".join(coordinates),
        "};",
        "\\end{axis}",
        "\\end{tikzpicture}",
    ]
    return "\n".join(lines)


def _csv_caption(question: str, analysis: dict) -> str:
    profile = analysis["profile"]
    chart = analysis["chart"]
    compact = {
        "rows": profile["rows"],
        "columns": profile["columns"],
        "numeric_summary": analysis["numeric_summary"],
        "categorical_summary": analysis["categorical_summary"],
        "chart": {
            "type": chart["type"],
            "x": chart["x"],
            "y": chart["y"],
        },
    }
    fallback = (
        f"Figure: {chart['y']} by {chart['x']} across "
        f"{profile['rows']} rows and {profile['columns']} columns."
    )
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            base_url=os.getenv("OPENAI_API_BASE", ""),
            timeout=60,
            max_retries=1,
        )
        language = (
            "Simplified Chinese"
            if re.search(r"[\u3400-\u9fff]", question or "")
            else "English"
        )
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "qwen3.8-flash"),
            temperature=0.1,
            max_tokens=360,
            extra_body={"enable_thinking": False},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You write concise academic figure captions and "
                        "evidence-grounded findings. Do not invent values."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"User question: {question or 'Summarize the CSV'}\n"
                        f"Write in {language}. Return one caption paragraph "
                        "followed by 2-4 bullet findings. Use only the "
                        f"following computed data:\n"
                        f"{json.dumps(compact, ensure_ascii=False)[:12000]}"
                    ),
                },
            ],
        )
        return (response.choices[0].message.content or "").strip() or fallback
    except Exception:
        return fallback


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

    def citation_corpus(request: Request):
        _check_token(request)
        user_id = _default_user_id()
        all_items = _existing_document_fingerprints(app, user_id)
        items = all_items[:20]
        nodes = []
        extraction_errors = []
        for item in items:
            fingerprint = item["fingerprint"]
            filename_arxiv = re.search(
                r"(\d{4}\.\d{4,5})(?:v\d+)?",
                item["name"],
                flags=re.IGNORECASE,
            )
            canonical = str(fingerprint.get("canonical_id") or "")
            arxiv_id = (
                filename_arxiv.group(1)
                if filename_arxiv
                else canonical.replace("arxiv:", "")
                if canonical
                else ""
            )
            metadata = {}
            if arxiv_id:
                try:
                    metadata = _fetch_arxiv_metadata(arxiv_id)
                except Exception:
                    metadata = {}
            title = _normalize_pdf_text(
                str(metadata.get("title") or fingerprint.get("title") or "")
            ).rstrip(".")
            if len(title) < 4:
                title = re.sub(
                    r"[_-]+",
                    " ",
                    re.sub(r"\.pdf$", "", item["name"], flags=re.IGNORECASE),
                )
            year = metadata.get("year")
            if not year and arxiv_id[:2].isdigit():
                year = 2000 + int(arxiv_id[:2])
            try:
                sections = _extract_pdf_citation_sections(
                    Path(item["path"])
                )
            except Exception as exc:
                extraction_errors.append(
                    {"file": item["name"], "error": str(exc)}
                )
                sections = {
                    "references": [],
                    "future_work": [],
                    "full_text": "",
                }
            nodes.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "title": title,
                    "authors": metadata.get("authors", [])[:20],
                    "year": year,
                    "arxiv_id": arxiv_id,
                    "canonical_id": f"arxiv:{arxiv_id}" if arxiv_id else "",
                    "doi": "",
                    "abstract": (
                        metadata.get("summary")
                        or fingerprint.get("abstract")
                        or ""
                    )[:4000],
                    "references": sections["references"],
                    "future_work": sections["future_work"],
                    "full_text": sections["full_text"],
                }
            )

        edges = []
        for source in nodes:
            reference_blob = _normalize_for_match(
                " ".join(source["references"])
            )
            if not reference_blob:
                continue
            for target in nodes:
                if source["id"] == target["id"]:
                    continue
                matched = False
                if (
                    target["arxiv_id"]
                    and _normalize_for_match(target["arxiv_id"])
                    in reference_blob
                ):
                    matched = True
                target_title = _normalize_for_match(target["title"])
                if (
                    not matched
                    and len(target_title) >= 16
                    and target_title in reference_blob
                ):
                    matched = True
                if not matched and target_title:
                    words = target_title.split()
                    probe = " ".join(words[: min(10, len(words))])
                    if len(probe) >= 18 and probe in reference_blob:
                        matched = True
                if matched:
                    edges.append(
                        {
                            "source": source["id"],
                            "target": target["id"],
                        }
                    )
        clean_nodes = [
            {
                key: value
                for key, value in node.items()
                if key not in {"full_text", "references"}
            }
            for node in nodes
        ]
        return {
            "papers": clean_nodes,
            "edges": edges,
            "extraction_errors": extraction_errors,
            "truncated": len(all_items) > 20,
        }

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

    def translate(payload: TranslateRequest, request: Request):
        _check_token(request)
        if payload.source_language == payload.target_language:
            return {
                "text": payload.text,
                "model": "identity",
                "cached": True,
            }

        cache_key = hashlib.sha256(
            (
                f"{payload.source_language}:{payload.target_language}:"
                f"{payload.text}"
            ).encode("utf-8")
        ).hexdigest()
        with TRANSLATION_LOCK:
            cached = TRANSLATION_CACHE.get(cache_key)
            if cached is not None:
                TRANSLATION_CACHE.move_to_end(cache_key)
                return {
                    "text": cached,
                    "model": "cache",
                    "cached": True,
                }

        from openai import OpenAI

        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            base_url=os.getenv("OPENAI_API_BASE", ""),
            timeout=120,
            max_retries=1,
        )
        model = os.getenv("OPENAI_CHAT_MODEL", "qwen3.8-flash")
        source_name = "English" if payload.source_language == "en" else "Chinese"
        target_name = "Simplified Chinese" if payload.target_language == "zh" else "English"
        system_prompt = (
            "You are a precise academic translator. Translate faithfully "
            "without summarizing or adding facts. Preserve paragraph breaks, "
            "numeric citation markers such as [12], equations, code, URLs, "
            "table/figure labels and reference metadata. Keep paper titles, "
            "author names and technical terms accurate."
        )

        chunks = []
        remaining = payload.text
        while remaining:
            if len(remaining) <= 7000:
                chunks.append(remaining)
                break
            split_at = remaining.rfind("\n", 0, 7000)
            if split_at < 2500:
                split_at = 7000
            chunks.append(remaining[:split_at])
            remaining = remaining[split_at:].lstrip()

        translated_chunks = []
        try:
            for chunk in chunks:
                response = client.chat.completions.create(
                    model=model,
                    temperature=0.05,
                    max_tokens=6000,
                    extra_body={"enable_thinking": False},
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": (
                                f"Translate from {source_name} to {target_name}:\n\n"
                                f"{chunk}"
                            ),
                        },
                    ],
                )
                translated_chunks.append(
                    response.choices[0].message.content or ""
                )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Academic translation failed: {exc}",
            ) from exc

        translated = "\n\n".join(
            item.strip() for item in translated_chunks if item.strip()
        )
        with TRANSLATION_LOCK:
            TRANSLATION_CACHE[cache_key] = translated
            TRANSLATION_CACHE.move_to_end(cache_key)
            while len(TRANSLATION_CACHE) > 200:
                TRANSLATION_CACHE.popitem(last=False)
        return {
            "text": translated,
            "model": model,
            "cached": False,
        }

    def arxiv_download(payload: ArxivToolRequest, request: Request):
        _check_token(request)
        import subprocess
        import tempfile

        steps: list[dict] = []
        started = time.perf_counter()
        try:
            arxiv_id = _parse_arxiv_identifier(payload.identifier)
            _tool_step(
                steps,
                "parse-arxiv",
                "Parse arXiv identifier",
                arxiv_id,
                started,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        curl_path = shutil.which("curl")
        if not curl_path:
            raise HTTPException(status_code=503, detail="curl is unavailable")

        metadata_started = time.perf_counter()
        metadata_title = ""
        metadata_summary = ""
        metadata_authors = []
        try:
            import xml.etree.ElementTree as ET

            response = subprocess.run(
                [
                    curl_path,
                    "-fsSL",
                    "--max-time",
                    "30",
                    f"https://export.arxiv.org/api/query?id_list={arxiv_id}",
                ],
                capture_output=True,
                text=True,
                timeout=40,
                check=False,
            )
            if response.returncode == 0:
                root = ET.fromstring(response.stdout)
                namespace = {"atom": "http://www.w3.org/2005/Atom"}
                entry = root.find("atom:entry", namespace)
                if entry is not None:
                    metadata_title = re.sub(
                        r"\s+",
                        " ",
                        entry.findtext("atom:title", "", namespace),
                    ).strip()
                    metadata_summary = re.sub(
                        r"\s+",
                        " ",
                        entry.findtext("atom:summary", "", namespace),
                    ).strip()
                    metadata_authors = [
                        re.sub(
                            r"\s+",
                            " ",
                            author.findtext("atom:name", "", namespace),
                        ).strip()
                        for author in entry.findall("atom:author", namespace)
                    ]
            _tool_step(
                steps,
                "arxiv-metadata",
                "Fetch arXiv metadata",
                metadata_title or arxiv_id,
                metadata_started,
            )
        except Exception:
            _tool_step(
                steps,
                "arxiv-metadata",
                "Fetch arXiv metadata",
                "Metadata unavailable; continuing with PDF",
                metadata_started,
                status="success",
            )

        temp_dir = Path(tempfile.mkdtemp(prefix="scholar-arxiv-"))
        pdf_path = temp_dir / f"{arxiv_id}.pdf"
        try:
            download_started = time.perf_counter()
            result = subprocess.run(
                [
                    curl_path,
                    "-sS",
                    "-fL",
                    "--retry",
                    "3",
                    "--retry-delay",
                    "1",
                    "--connect-timeout",
                    "20",
                    "--max-time",
                    "120",
                    "-A",
                    "Scholar-Agent/1.0",
                    f"https://arxiv.org/pdf/{arxiv_id}",
                    "-o",
                    str(pdf_path),
                ],
                capture_output=True,
                text=True,
                timeout=130,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    result.stderr.strip()[:400] or "arXiv download failed"
                )
            data = pdf_path.read_bytes()
            if not data.startswith(b"%PDF"):
                raise RuntimeError("Downloaded file is not a PDF")
            _tool_step(
                steps,
                "download-pdf",
                "Download arXiv PDF",
                f"{len(data)} bytes",
                download_started,
            )

            fingerprint_started = time.perf_counter()
            incoming = _fingerprint_pdf_bytes(data, pdf_path.name)
            if metadata_title:
                incoming["title"] = metadata_title
            if metadata_summary:
                incoming["abstract"] = metadata_summary
            _tool_step(
                steps,
                "fingerprint",
                "Extract paper identity",
                (
                    f"{incoming['canonical_id'] or arxiv_id} · "
                    f"v{incoming['version'] or '?'} · "
                    f"{incoming['page_count']} pages"
                ),
                fingerprint_started,
            )

            dedupe_started = time.perf_counter()
            existing_documents = _existing_document_fingerprints(
                app,
                _default_user_id(),
            )
            matches = []
            for item in existing_documents:
                match = _compare_document_fingerprints(
                    item["fingerprint"],
                    incoming,
                    existing_id=item["id"],
                    existing_name=item["name"],
                )
                if match:
                    matches.append(match)
            matches.sort(
                key=lambda item: (
                    item["similarity"],
                    item["text_similarity"],
                    item["title_similarity"],
                ),
                reverse=True,
            )
            _tool_step(
                steps,
                "dedupe",
                "Check semantic duplicates",
                (
                    f"{len(matches)} matching document(s)"
                    if matches
                    else "No matching document"
                ),
                dedupe_started,
            )
            if matches:
                return {
                    "status": "duplicate",
                    "arxiv_id": arxiv_id,
                    "title": metadata_title or incoming["title"],
                    "authors": metadata_authors,
                    "abstract": metadata_summary,
                    "version": incoming["version"],
                    "matches": matches[:3],
                    "steps": steps,
                }

            index_started = time.perf_counter()
            user_id = _default_user_id()
            settings = _settings_for_user(app, user_id)
            ids = app._index_1.index_fn_file_with_default_loaders(
                [str(pdf_path)],
                False,
                settings,
                user_id,
            )
            available = _files_for_user(app, user_id)
            indexed = [
                item
                for item in available
                if item["id"] in ids
                or item["name"] == pdf_path.name
            ]
            _tool_step(
                steps,
                "index-pdf",
                "Index paper into library",
                (
                    f"{len(indexed)} document(s) indexed"
                    if indexed
                    else "Indexing completed"
                ),
                index_started,
            )
            return {
                "status": "indexed",
                "arxiv_id": arxiv_id,
                "title": metadata_title or incoming["title"],
                "authors": metadata_authors,
                "abstract": metadata_summary,
                "version": incoming["version"],
                "file_ids": ids,
                "files": indexed,
                "steps": steps,
            }
        except HTTPException:
            raise
        except Exception as exc:
            _tool_step(
                steps,
                "tool-error",
                "arXiv tool failed",
                str(exc),
                started,
                status="error",
            )
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def writing_generate(payload: WritingToolRequest, request: Request):
        _check_token(request)
        import requests

        user_id = _default_user_id()
        steps: list[dict] = []
        started = time.perf_counter()
        load_started = time.perf_counter()
        existing = _existing_document_fingerprints(app, user_id)
        if payload.file_ids is not None:
            wanted = set(payload.file_ids)
            existing = [item for item in existing if item["id"] in wanted]
        existing = existing[:10]
        if not existing:
            raise HTTPException(
                status_code=422,
                detail="No indexed papers are available for the draft",
            )
        _tool_step(
            steps,
            "load-sources",
            "Load selected paper sources",
            f"{len(existing)} paper(s)",
            load_started,
        )

        enrich_started = time.perf_counter()
        candidates = []
        seen = set()
        for index, item in enumerate(existing, start=1):
            fingerprint = item["fingerprint"]
            canonical = str(fingerprint.get("canonical_id") or "")
            filename_arxiv = re.search(
                r"(\d{4}\.\d{4,5})(?:v\d+)?",
                item["name"],
                flags=re.IGNORECASE,
            )
            arxiv_id = (
                filename_arxiv.group(1)
                if filename_arxiv
                else canonical.replace("arxiv:", "")
                if canonical
                else ""
            )
            metadata = {}
            if arxiv_id:
                try:
                    metadata = _fetch_arxiv_metadata(arxiv_id)
                except Exception:
                    metadata = {}
            if not metadata:
                query = (
                    f"10.48550/arXiv.{arxiv_id}"
                    if arxiv_id
                    else fingerprint.get("title")
                    or re.sub(
                        r"\.pdf$",
                        "",
                        item["name"],
                        flags=re.IGNORECASE,
                    )
                )
                try:
                    response = requests.get(
                        "http://127.0.0.1:8001/api/search",
                        params={"q": query},
                        timeout=20,
                    )
                    if response.ok:
                        metadata = response.json()
                except Exception:
                    metadata = {}

            title = _normalize_pdf_text(
                str(metadata.get("title") or fingerprint.get("title") or "")
            )
            if not title or len(title) < 4:
                title = re.sub(
                    r"[_-]+",
                    " ",
                    re.sub(r"\.pdf$", "", item["name"], flags=re.IGNORECASE),
                )
            authors = [
                _normalize_pdf_text(str(author))
                for author in metadata.get("authors", [])
                if str(author).strip()
            ][:8]
            arxiv_year = None
            if arxiv_id[:2].isdigit():
                short_year = int(arxiv_id[:2])
                arxiv_year = 2000 + short_year if short_year <= 99 else None
            year = arxiv_year or metadata.get("year")
            doi = str(metadata.get("doi") or "")
            identity = (doi or canonical or title).lower()
            if identity in seen:
                continue
            seen.add(identity)
            author_text = ", ".join(authors) if authors else "Unknown author"
            display_title = title.rstrip(".")
            venue = (
                f"arXiv:{arxiv_id}"
                if arxiv_id
                else f"https://doi.org/{doi}"
                if doi
                else "Local indexed paper"
            )
            marker = f"R{index}"
            formatted = (
                f"[{marker}] {author_text}. \"{display_title}.\" "
                f"{venue}{f', {year}' if year else ''}."
            )
            first_family = (
                authors[0].split()[-1]
                if authors and authors[0] != "Unknown author"
                else item["name"].split(".")[0]
            )
            key_seed = re.sub(
                r"[^A-Za-z0-9]+",
                "",
                f"{first_family}{year or ''}{title.split()[0] if title else ''}",
            )
            citation_key = key_seed[:32] or f"source{index}"
            bibtex_lines = [
                f"@article{{{citation_key},",
                f"  title = {{{display_title}}},",
                f"  author = {{{' and '.join(authors) or 'Unknown'}}},",
            ]
            if year:
                bibtex_lines.append(f"  year = {{{year}}},")
            if doi:
                bibtex_lines.append(f"  doi = {{{doi}}},")
            if arxiv_id:
                bibtex_lines.extend(
                    [
                        f"  eprint = {{{arxiv_id}}},",
                        "  archivePrefix = {arXiv},",
                        f"  url = {{https://arxiv.org/abs/{arxiv_id}}},",
                    ]
                )
            bibtex_lines.append("}")
            candidates.append(
                {
                    "key": marker,
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "doi": doi,
                    "arxiv_id": arxiv_id,
                    "formatted": formatted,
                    "bibtex": "\n".join(bibtex_lines),
                    "snippet": str(fingerprint.get("abstract") or "")[:1600],
                }
            )
        _tool_step(
            steps,
            "enrich-references",
            "Resolve references with OpenAlex",
            f"{len(candidates)} verified candidate(s)",
            enrich_started,
        )

        if not candidates:
            raise HTTPException(
                status_code=422,
                detail="Unable to derive references from the selected papers",
            )

        generate_started = time.perf_counter()
        model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        language = (
            "Simplified Chinese"
            if payload.language == "zh"
            else "English"
        )
        candidate_text = "\n\n".join(
            f"[{candidate['key']}] {candidate['formatted']}\n"
            f"Evidence snippet: {candidate['snippet'][:900]}"
            for candidate in candidates
        )
        framework = ""
        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=os.getenv("OPENAI_API_KEY", ""),
                base_url=os.getenv("OPENAI_API_BASE", ""),
                timeout=150,
                max_retries=1,
            )
            response = client.chat.completions.create(
                model=model,
                temperature=0.2,
                max_tokens=3600,
                extra_body={"enable_thinking": False},
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a rigorous academic writing architect. "
                            "Write only in the requested language. Use citations "
                            "exclusively in the supplied [R1], [R2] format and "
                            "never cite a source that was not provided. Do not "
                            "invent numerical results or a References section."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Language: {language}\n"
                            f"Research idea: {payload.idea}\n\n"
                            "Produce a Markdown paper framework with: title, "
                            "Abstract (150-220 words), Keywords, 1 Introduction, "
                            "2 Related Work, 3 Method, 4 Experimental Design, "
                            "5 Evaluation Plan, 6 Discussion, 7 Conclusion. "
                            "For each prose section provide concrete paragraph "
                            "guidance and related-work citations where justified. "
                            "Do not add a References section.\n\n"
                            f"Allowed references:\n{candidate_text}"
                        ),
                    },
                ],
            )
            framework = (response.choices[0].message.content or "").strip()
        except Exception:
            framework = ""

        if not framework:
            framework = (
                f"# {payload.idea.strip()}\n\n"
                f"## Abstract\n"
                f"This paper investigates {payload.idea.strip()}. "
                f"The study positions the idea against the selected evidence "
                f"base [{candidates[0]['key']}] and defines a reproducible "
                f"evaluation protocol.\n\n"
                "## Keywords\n"
                "evidence-grounded AI; retrieval; academic agents\n\n"
                "## 1 Introduction\n"
                "State the research gap, the proposed contribution and the "
                "expected scientific significance.\n\n"
                "## 2 Related Work\n"
                f"Compare the closest indexed approaches "
                f"[{candidates[0]['key']}].\n\n"
                "## 3 Method\n"
                "Describe data, model routing, evidence verification and "
                "failure handling.\n\n"
                "## 4 Experimental Design\n"
                "Define datasets, baselines, metrics, ablations and "
                "reproducibility controls.\n\n"
                "## 5 Evaluation Plan\n"
                "Report retrieval quality, citation correctness, answer quality "
                "and latency.\n\n"
                "## 6 Discussion\n"
                "Analyze limitations, evidence sufficiency and threats to "
                "validity.\n\n"
                "## 7 Conclusion\n"
                "Summarize the expected contribution and next validation step.\n"
            )

        allowed = {candidate["key"] for candidate in candidates}

        def valid_marker(match):
            marker = match.group(1)
            return f"[R{marker}]" if f"R{marker}" in allowed else ""

        framework = re.sub(r"\[R(\d+)\]", valid_marker, framework)
        if "## References" not in framework and "# References" not in framework:
            framework = framework.rstrip() + "\n\n## References\n\n" + "\n\n".join(
                candidate["formatted"] for candidate in candidates
            )
        _tool_step(
            steps,
            "generate-framework",
            "Generate paper framework",
            f"{model} · {len(candidates)} allowed references",
            generate_started,
        )

        validate_started = time.perf_counter()
        invalid_markers = [
            marker
            for marker in re.findall(r"\[R\d+\]", framework)
            if f"R{marker[2:-1]}" not in allowed
        ]
        _tool_step(
            steps,
            "validate-citations",
            "Validate reference markers",
            (
                "All citations are grounded"
                if not invalid_markers
                else f"{len(invalid_markers)} invalid marker(s) removed"
            ),
            validate_started,
        )
        return {
            "status": "completed",
            "idea": payload.idea,
            "framework": framework,
            "references": candidates,
            "references_markdown": "\n\n".join(
                candidate["formatted"] for candidate in candidates
            ),
            "bibtex": "\n\n".join(
                candidate["bibtex"] for candidate in candidates
            ),
            "model": model,
            "steps": steps,
            "duration_ms": round(
                (time.perf_counter() - started) * 1000
            ),
        }

    def future_work_review(
        payload: FutureWorkRequest,
        request: Request,
    ):
        _check_token(request)
        sources = [
            paper
            for paper in payload.papers
            if paper.future_work
        ]
        if not sources:
            return {
                "summary_markdown": (
                    "当前本地论文中未提取到明确的 Future Work 段落。"
                    if payload.language == "zh"
                    else "No explicit Future Work sections were extracted."
                ),
                "directions": [],
                "model": "none",
                "source_count": 0,
            }

        source_text = "\n\n".join(
            f"Paper: {paper.title} ({paper.year or 'n.d.'})\n"
            + "\n".join(
                f"- {snippet[:1800]}"
                for snippet in paper.future_work[:3]
            )
            for paper in sources[:20]
        )
        foundational_text = "\n".join(
            f"- {item.get('title')} (PageRank {item.get('pagerank')})"
            for item in payload.foundational[:8]
        )
        model = os.getenv("OPENAI_COMPLEX_MODEL", "qwen3.8-max")
        language = (
            "简体中文"
            if payload.language == "zh"
            else "English"
        )
        fallback = (
            "## Future Work 综述\n\n"
            + "\n".join(
                f"- **{paper.title}**：{paper.future_work[0][:320]}"
                for paper in sources
            )
        )
        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=os.getenv("OPENAI_API_KEY", ""),
                base_url=os.getenv("OPENAI_API_BASE", ""),
                timeout=150,
                max_retries=1,
            )
            response = client.chat.completions.create(
                model=model,
                temperature=0.15,
                max_tokens=2200,
                extra_body={"enable_thinking": False},
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You synthesize Future Work sections. Use only "
                            "the supplied snippets. Merge repeated directions, "
                            "separate incremental extensions from substantive "
                            "research opportunities, and never invent evidence."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Write in {language}. Produce a Markdown review "
                            "titled 'Future Work 综述' (or equivalent), with "
                            "4-7 thematic directions. Each direction must "
                            "include: core problem, why it remains open, "
                            "supporting paper titles, and a concrete next "
                            "experiment. End with a prioritized research "
                            "agenda. Foundation candidates:\n"
                            f"{foundational_text}\n\n"
                            f"Extracted Future Work evidence:\n{source_text}"
                        ),
                    },
                ],
            )
            summary = (response.choices[0].message.content or "").strip()
        except Exception:
            summary = ""
        return {
            "summary_markdown": summary or fallback,
            "directions": [],
            "model": model if summary else "fallback",
            "source_count": len(sources),
        }

    async def csv_analyze(
        request: Request,
        file: UploadFile = File(...),
        question: str = Form(""),
    ):
        _check_token(request)
        steps: list[dict] = []
        overall_started = time.perf_counter()
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="CSV file required")
        read_started = time.perf_counter()
        data = await file.read(10 * 1024 * 1024 + 1)
        if not data:
            raise HTTPException(status_code=400, detail="CSV is empty")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="CSV exceeds 10 MB")
        _tool_step(
            steps,
            "read-csv",
            "Read uploaded CSV",
            f"{len(data)} bytes · {Path(file.filename).name}",
            read_started,
        )

        analysis_started = time.perf_counter()
        try:
            analysis = await run_in_threadpool(
                _analyze_csv_bytes,
                data,
                question,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"CSV analysis failed: {exc}",
            ) from exc
        _tool_step(
            steps,
            "profile-and-analyze",
            "Profile columns with pandas",
            (
                f"{analysis['profile']['rows']} rows · "
                f"{analysis['profile']['columns']} columns"
            ),
            analysis_started,
        )
        chart_started = time.perf_counter()
        _tool_step(
            steps,
            "render-chart",
            "Render Matplotlib figure",
            (
                f"{analysis['chart']['type']} · "
                f"{analysis['chart']['x']} / {analysis['chart']['y']}"
            ),
            chart_started,
        )
        caption_started = time.perf_counter()
        caption = await run_in_threadpool(
            _csv_caption,
            question,
            analysis,
        )
        _tool_step(
            steps,
            "generate-caption",
            "Generate academic caption",
            "qwen3.8-flash",
            caption_started,
        )
        script_started = time.perf_counter()
        mermaid_script = _mermaid_chart_script(analysis["chart"])
        tikz_script = _tikz_chart_script(analysis["chart"])
        _tool_step(
            steps,
            "generate-scripts",
            "Generate Mermaid and TikZ",
            (
                f"{len(analysis['chart'].get('points', []))} plotted points"
            ),
            script_started,
        )
        return {
            "status": "completed",
            "file_name": Path(file.filename).name,
            "question": question,
            "profile": analysis["profile"],
            "numeric_summary": analysis["numeric_summary"],
            "categorical_summary": analysis["categorical_summary"],
            "chart": analysis["chart"],
            "caption": caption,
            "scripts": {
                "mermaid": mermaid_script,
                "tikz": tikz_script,
            },
            "steps": steps,
            "duration_ms": round(
                (time.perf_counter() - overall_started) * 1000
            ),
        }

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
        settings = _apply_language_instruction(
            _settings_for_user(app, user_id),
            payload.language,
        )
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
        try:
            for result in generator:
                if result and len(result) >= 5:
                    rendered_history = result[0] or []
                    final_text = (
                        rendered_history[-1][1] if rendered_history else ""
                    ) or ""
                    final_refs = result[1] or ""
        except Exception as exc:
            logger.exception("audit_retrieval_failed")
            return JSONResponse(
                status_code=502,
                content={
                    "detail": (
                        "Audit retrieval failed: "
                        f"{type(exc).__name__}: {str(exc)[:300]}"
                    )
                },
            )
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

    async def dedupe_preflight(
        request: Request,
        file: UploadFile = File(...),
    ):
        _check_token(request)
        user_id = _default_user_id()
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail="Only PDF files are supported",
            )

        safe_name = Path(file.filename).name
        data = await file.read(100 * 1024 * 1024 + 1)
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Invalid PDF")
        if len(data) > 100 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="PDF exceeds 100 MB")

        try:
            incoming = await run_in_threadpool(
                _fingerprint_pdf_bytes,
                data,
                safe_name,
            )
            existing_documents = await run_in_threadpool(
                _existing_document_fingerprints,
                app,
                user_id,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Unable to inspect PDF: {exc}",
            ) from exc

        matches = []
        for item in existing_documents:
            match = _compare_document_fingerprints(
                item["fingerprint"],
                incoming,
                existing_id=item["id"],
                existing_name=item["name"],
            )
            if match:
                match["existing_size"] = item["size"]
                matches.append(match)
        matches.sort(
            key=lambda item: (
                item["similarity"],
                item["text_similarity"],
                item["title_similarity"],
                item["abstract_similarity"],
                -item["changed_ratio"],
            ),
            reverse=True,
        )

        primary = matches[0] if matches else None
        if primary:
            changed = primary["changed_ratio"]
            summary_zh = (
                f"正文版本差异约 {changed:.1%}；"
                f"当前库中已有 {primary['existing_name']}。"
            )
            summary_en = (
                f"Approximately {changed:.1%} of the inspected body text "
                f"changed; {primary['existing_name']} already exists."
            )
        else:
            summary_zh = "未发现内容高度重合的已索引论文。"
            summary_en = "No closely matching indexed paper was found."

        return {
            "file_name": safe_name,
            "content_sha256": incoming["content_sha256"],
            "title": incoming["title"],
            "canonical_id": incoming["canonical_id"],
            "version": incoming["version"],
            "page_count": incoming["page_count"],
            "duplicate": bool(matches),
            "recommended_action": (
                primary["recommendation"] if primary else "upload"
            ),
            "matches": matches[:5],
            "summary_zh": summary_zh,
            "summary_en": summary_en,
        }

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
        upload_root = Path(
            os.getenv("GRADIO_TEMP_DIR") or filestorage_path
        ) / "bff_uploads"
        upload_dir = upload_root / str(uuid.uuid4())
        upload_dir.mkdir(parents=True, exist_ok=False)
        persistent_path = upload_dir / safe_name
        try:
            total = 0
            first_chunk = True
            with open(persistent_path, "wb") as pdf_file:
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
                    pdf_file.write(chunk)

            if total == 0:
                raise HTTPException(status_code=400, detail="Empty PDF")

            settings = _settings_for_user(app, user_id)
            ids = await run_in_threadpool(
                app._index_1.index_fn_file_with_default_loaders,
                [str(persistent_path)],
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
            shutil.rmtree(upload_dir, ignore_errors=True)
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
        settings = _apply_language_instruction(settings, payload.language)

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
            yield _sse(
                "trace",
                {
                    "id": f"{request_id}-plan",
                    "kind": "plan",
                    "title": "Task plan",
                    "title_zh": "任务规划",
                    "status": "success",
                    "detail": f"{routed_model} · {routing_reason}",
                },
            )
            yield _sse(
                "trace",
                {
                    "id": f"{request_id}-retrieval",
                    "kind": "retrieval",
                    "title": "Hybrid retrieval",
                    "title_zh": "混合检索",
                    "status": "running",
                    "detail": (
                        f"{len(payload.file_ids)} selected file(s)"
                        if payload.file_ids is not None
                        else "All indexed papers"
                    ),
                },
            )

            previous_text = ""
            previous_refs = ""
            previous_citation_signature = ""
            final_text = ""
            final_refs = ""
            retrieval_completed = False

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
                    if not retrieval_completed:
                        retrieval_completed = True
                        yield _sse(
                            "trace",
                            {
                                "id": f"{request_id}-retrieval",
                                "kind": "retrieval",
                                "title": "Hybrid retrieval",
                                "title_zh": "混合检索",
                                "status": "success",
                                "detail": "Evidence candidates prepared",
                            },
                        )
                        yield _sse(
                            "trace",
                            {
                                "id": f"{request_id}-synthesis",
                                "kind": "model",
                                "title": "Evidence synthesis",
                                "title_zh": "证据综合",
                                "status": "running",
                                "detail": routed_model,
                            },
                        )

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
                yield _sse(
                    "trace",
                    {
                        "id": f"{request_id}-synthesis",
                        "kind": "model",
                        "title": "Evidence synthesis",
                        "title_zh": "证据综合",
                        "status": "success",
                        "detail": f"{len(citations)} citation anchor(s)",
                    },
                )
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
                logger.exception(
                    "chat_failed request_id=%s conversation_id=%s",
                    request_id,
                    conversation_id,
                )
                yield _sse(
                    "error",
                    {
                        "request_id": request_id,
                        "conversation_id": conversation_id,
                        "code": "chat_failed",
                        "message": str(exc),
                    },
                )
                yield _sse(
                    "trace",
                    {
                        "id": f"{request_id}-error",
                        "kind": "error",
                        "title": "Agent failed",
                        "title_zh": "Agent 执行失败",
                        "status": "error",
                        "detail": str(exc),
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
        "/api/bff/citation-corpus",
        citation_corpus,
        methods=["GET"],
    )
    api.add_api_route(
        "/api/bff/files/{file_id}",
        delete_file,
        methods=["DELETE"],
    )
    api.add_api_route(
        "/api/bff/dedupe/preflight",
        dedupe_preflight,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/translate",
        translate,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/tools/arxiv",
        arxiv_download,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/tools/writing",
        writing_generate,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/tools/csv",
        csv_analyze,
        methods=["POST"],
    )
    api.add_api_route(
        "/api/bff/future-work-review",
        future_work_review,
        methods=["POST"],
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
