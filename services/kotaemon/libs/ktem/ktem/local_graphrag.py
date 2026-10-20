from __future__ import annotations

import math
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Any


TOKEN_PATTERN = re.compile(r"[a-z0-9]{2,}|[\u3400-\u9fff]")
STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "are",
    "was",
    "were",
    "into",
    "what",
    "which",
    "how",
    "does",
    "about",
    "论文",
    "什么",
    "如何",
    "是否",
    "以及",
    "进行",
}


def _value(source: Any, key: str, default: Any = None) -> Any:
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def _tokens(value: Any) -> set[str]:
    normalized = unicodedata.normalize("NFKC", str(value or "")).lower()
    return {
        token
        for token in TOKEN_PATTERN.findall(normalized)
        if token not in STOPWORDS
    }


def _paper_node_id(value: str) -> str:
    value = str(value or "")
    return value if value.startswith("paper:") else f"paper:{value}"


@dataclass(frozen=True)
class GraphEdge:
    source: str
    target: str
    relation: str
    evidence: str = ""
    confidence: float = 0.5
    weight: float = 1.0


class LocalGraphRAG:
    """Read-only heterogeneous graph retrieval over local paper entities."""

    def __init__(
        self,
        papers: list[dict],
        citation_edges: list[dict],
        entity_nodes: list[dict],
        entity_edges: list[dict],
    ) -> None:
        self.papers = {
            str(_value(paper, "id")): dict(paper)
            for paper in papers
            if _value(paper, "id")
        }
        self.nodes: dict[str, dict] = {}
        self.edges: list[GraphEdge] = []
        self.adjacency: dict[str, list[GraphEdge]] = defaultdict(list)
        self._paper_entity_links: dict[str, list[GraphEdge]] = defaultdict(list)

        for paper_id, paper in self.papers.items():
            node_id = _paper_node_id(paper_id)
            self.nodes[node_id] = {
                "id": node_id,
                "type": "paper",
                "label": str(_value(paper, "title") or paper_id),
                "paper_ids": [paper_id],
                "text": " ".join(
                    [
                        str(_value(paper, "title") or ""),
                        str(_value(paper, "abstract") or ""),
                    ]
                ),
            }

        for node in entity_nodes:
            node_id = str(_value(node, "id") or "")
            if not node_id or node_id in self.nodes:
                continue
            node_type = str(_value(node, "type") or "entity")
            paper_ids = [
                str(item)
                for item in (_value(node, "paper_ids", []) or [])
                if item
            ]
            if node_type == "paper" and paper_ids:
                alias = _paper_node_id(paper_ids[0])
                if alias in self.nodes:
                    continue
            self.nodes[node_id] = {
                "id": node_id,
                "type": node_type,
                "label": str(_value(node, "label") or node_id),
                "paper_ids": paper_ids,
                "text": str(_value(node, "label") or ""),
            }

        for edge in citation_edges:
            source = _paper_node_id(str(_value(edge, "source") or ""))
            target = _paper_node_id(str(_value(edge, "target") or ""))
            if source in self.nodes and target in self.nodes and source != target:
                self._add_edge(
                    GraphEdge(
                        source=source,
                        target=target,
                        relation="cites",
                        evidence="Local References match",
                        confidence=1.0,
                        weight=1.45,
                    )
                )

        for edge in entity_edges:
            source = str(_value(edge, "source") or "")
            target = str(_value(edge, "target") or "")
            if source not in self.nodes or target not in self.nodes:
                continue
            confidence = float(_value(edge, "confidence", 0.6) or 0.6)
            entity_edge = GraphEdge(
                source=source,
                target=target,
                relation=str(_value(edge, "relation") or "related_to"),
                evidence=str(_value(edge, "evidence") or ""),
                confidence=max(0.0, min(1.0, confidence)),
                weight=0.75 + confidence,
            )
            self._add_edge(entity_edge)
            if self.nodes[source].get("type") == "paper":
                self._paper_entity_links[source].append(entity_edge)
            if self.nodes[target].get("type") == "paper":
                self._paper_entity_links[target].append(entity_edge)

    def _add_edge(self, edge: GraphEdge) -> None:
        self.edges.append(edge)
        self.adjacency[edge.source].append(edge)
        reverse = GraphEdge(
            source=edge.target,
            target=edge.source,
            relation=edge.relation,
            evidence=edge.evidence,
            confidence=edge.confidence,
            weight=edge.weight * 0.9,
        )
        self.adjacency[edge.target].append(reverse)

    def stats(self) -> dict:
        node_types = defaultdict(int)
        edge_types = defaultdict(int)
        for node in self.nodes.values():
            node_types[str(node.get("type") or "entity")] += 1
        for edge in self.edges:
            edge_types[edge.relation] += 1
        return {
            "paper_count": len(self.papers),
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "node_types": dict(sorted(node_types.items())),
            "edge_types": dict(sorted(edge_types.items())),
        }

    def retrieve(
        self,
        query: str,
        *,
        file_ids: list[str] | None = None,
        top_k: int = 8,
        max_hops: int = 2,
        seed_limit: int = 12,
    ) -> dict:
        query_tokens = _tokens(query)
        selected = set(file_ids or [])
        seed_scores = {}
        matched_terms = {}
        for node_id, node in self.nodes.items():
            node_tokens = _tokens(node.get("text") or node.get("label"))
            overlap = query_tokens & node_tokens
            if not overlap:
                continue
            coverage = len(overlap) / max(1, len(node_tokens))
            phrase_bonus = (
                0.8
                if str(node.get("label") or "").casefold()
                in str(query or "").casefold()
                else 0.0
            )
            score = len(overlap) + 3.0 * coverage + phrase_bonus
            if node.get("type") == "paper":
                score *= 1.15
            seed_scores[node_id] = score
            matched_terms[node_id] = sorted(overlap)

        if not seed_scores:
            for paper_node in self.papers:
                node_id = _paper_node_id(paper_node)
                if selected and paper_node not in selected:
                    continue
                seed_scores[node_id] = (
                    1.0 + math.log1p(len(self.adjacency[node_id]))
                )

        seeds = sorted(
            seed_scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:seed_limit]
        total_seed = sum(score for _, score in seeds) or 1.0
        restart = {node_id: score / total_seed for node_id, score in seeds}
        current = dict(restart)
        accumulated = defaultdict(float, restart)

        for _ in range(max(1, max_hops)):
            next_scores = defaultdict(float)
            for node_id, score in current.items():
                neighbors = self.adjacency.get(node_id, [])
                if not neighbors:
                    continue
                degree_scale = 1.0 / math.sqrt(max(1, len(neighbors)))
                for edge in neighbors:
                    next_scores[edge.target] += (
                        score * edge.weight * degree_scale
                    )
            total = sum(next_scores.values())
            if not total:
                break
            current = {
                node_id: score / total
                for node_id, score in next_scores.items()
            }
            for node_id, score in current.items():
                accumulated[node_id] += 0.62 * score
            for node_id, score in restart.items():
                accumulated[node_id] += 0.38 * score

        paper_scores = defaultdict(float)
        node_signals = defaultdict(list)
        for node_id, score in accumulated.items():
            node = self.nodes.get(node_id)
            if not node:
                continue
            node_signals[node_id].append(
                {
                    "score": score,
                    "matched_terms": matched_terms.get(node_id, []),
                }
            )
            if node.get("type") == "paper":
                paper_id = str((node.get("paper_ids") or [""])[0])
                if paper_id and (not selected or paper_id in selected):
                    paper_scores[paper_id] += score * 2.1
            for paper_id in node.get("paper_ids") or []:
                paper_id = str(paper_id)
                if paper_id and (not selected or paper_id in selected):
                    paper_scores[paper_id] += score * 0.72

        if not paper_scores:
            begin = [paper for paper in self.papers if not selected or paper in selected]
            paper_scores.update({paper_id: 0.01 for paper_id in begin})

        papers = []
        for paper_id, score in sorted(
            paper_scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )[: max(1, top_k)]:
            paper_node = _paper_node_id(paper_id)
            relations = []
            seen = set()
            for edge in self._paper_entity_links.get(paper_node, []):
                other_id = edge.target if edge.source == paper_node else edge.source
                other = self.nodes.get(other_id, {})
                if other.get("type") == "paper":
                    continue
                key = (other_id, edge.relation)
                if key in seen:
                    continue
                seen.add(key)
                relations.append(
                    {
                        "node_id": other_id,
                        "type": other.get("type"),
                        "label": other.get("label"),
                        "relation": edge.relation,
                        "evidence": edge.evidence,
                        "confidence": edge.confidence,
                        "activation": round(
                            accumulated.get(other_id, 0.0),
                            8,
                        ),
                    }
                )
            relations.sort(
                key=lambda item: (
                    item["activation"],
                    item["confidence"],
                ),
                reverse=True,
            )
            citation_relations = [
                {
                    "source": edge.source,
                    "target": edge.target,
                    "relation": edge.relation,
                }
                for edge in self.adjacency.get(paper_node, [])
                if self.nodes.get(
                    edge.target if edge.source == paper_node else edge.source,
                    {},
                ).get("type")
                == "paper"
            ]
            paper = self.papers.get(paper_id, {})
            papers.append(
                {
                    "file_id": paper_id,
                    "title": paper.get("title") or paper_id,
                    "score": round(score, 8),
                    "relations": relations[:8],
                    "citation_relations": citation_relations[:8],
                }
            )

        return {
            "query": query,
            "seeds": [
                {
                    "id": node_id,
                    "label": self.nodes[node_id].get("label"),
                    "type": self.nodes[node_id].get("type"),
                    "matched_terms": matched_terms.get(node_id, []),
                }
                for node_id, _ in seeds
            ],
            "papers": papers,
            "metrics": {
                "query_tokens": len(query_tokens),
                "seed_nodes": len(seeds),
                "activated_nodes": len(accumulated),
                "max_hops": max_hops,
            },
            "graph": self.stats(),
        }


def format_graphrag_context(result: dict, max_chars: int = 8000) -> str:
    lines = [
        "Local entity/citation GraphRAG retrieval.",
        "Use these graph-selected papers and grounded entity relations as "
        "additional retrieval evidence. Page-grounded citations still come "
        "from the normal RAG evidence.",
        "",
    ]
    for paper in result.get("papers", []):
        lines.append(
            f"[Paper] {paper.get('title')} "
            f"(score={paper.get('score')}, id={paper.get('file_id')})"
        )
        for relation in paper.get("relations", [])[:5]:
            evidence = str(relation.get("evidence") or "")[:500]
            lines.append(
                f"- {relation.get('relation')}: "
                f"{relation.get('label')} ({evidence})"
            )
        for citation in paper.get("citation_relations", [])[:4]:
            lines.append(
                f"- citation edge: {citation.get('source')} -> "
                f"{citation.get('target')}"
            )
        lines.append("")
    context = "\n".join(lines).strip()
    return context[:max_chars]
