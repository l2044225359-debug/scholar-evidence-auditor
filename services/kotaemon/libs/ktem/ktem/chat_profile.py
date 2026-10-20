from __future__ import annotations

import re
from dataclasses import dataclass


STANDARD_TERMS = re.compile(
    r"比较|对比|关系|关联|差异|趋势|演进|"
    r"compare|contrast|relationship|trend",
    re.I,
)
GRAPH_TERMS = re.compile(
    r"引用图|实体图|图谱|研究脉络|citation graph|entity graph|"
    r"graph relation|graphrag",
    re.I,
)
DEEP_TERMS = re.compile(
    r"综述|全部文档|所有文档|跨论文|多篇|元分析|研究脉络|"
    r"审计|全面分析|literature review|all documents|cross[- ]paper|"
    r"multi[- ]document|meta[- ]analysis",
    re.I,
)


@dataclass(frozen=True)
class ChatExecutionProfile:
    name: str
    reason: str
    use_agent: bool
    use_graphrag: bool
    planner_max_steps: int
    graph_top_k: int
    graph_max_hops: int


def decide_chat_profile(
    *,
    message: str,
    model_mode: str,
    reasoning_type: str,
    agent_mode: bool,
    file_count: int,
    graphrag_enabled: bool,
) -> ChatExecutionProfile:
    text = message.strip()
    if not agent_mode or model_mode == "fast" or not file_count:
        return ChatExecutionProfile(
            name="fast",
            reason="explicit_fast" if model_mode == "fast" else "direct_rag",
            use_agent=False,
            use_graphrag=False,
            planner_max_steps=0,
            graph_top_k=0,
            graph_max_hops=0,
        )

    if model_mode == "deep" or reasoning_type != "simple":
        return ChatExecutionProfile(
            name="deep",
            reason="explicit_deep" if model_mode == "deep" else "complex_reasoning",
            use_agent=True,
            use_graphrag=graphrag_enabled and file_count > 1,
            planner_max_steps=4,
            graph_top_k=8,
            graph_max_hops=2,
        )

    if DEEP_TERMS.search(text) or GRAPH_TERMS.search(text):
        return ChatExecutionProfile(
            name="deep",
            reason=(
                "graph_query_terms"
                if GRAPH_TERMS.search(text) and not DEEP_TERMS.search(text)
                else "deep_query_terms"
            ),
            use_agent=True,
            use_graphrag=graphrag_enabled and file_count > 1,
            planner_max_steps=4,
            graph_top_k=8,
            graph_max_hops=2,
        )

    if (
        STANDARD_TERMS.search(text)
        or len(text) >= 320
        or text.count("\n") >= 3
    ):
        return ChatExecutionProfile(
            name="standard",
            reason="relational_query",
            use_agent=True,
            use_graphrag=False,
            planner_max_steps=2,
            graph_top_k=0,
            graph_max_hops=0,
        )

    return ChatExecutionProfile(
        name="fast",
        reason="simple_fact_query",
        use_agent=False,
        use_graphrag=False,
        planner_max_steps=0,
        graph_top_k=0,
        graph_max_hops=0,
    )
