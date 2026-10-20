from __future__ import annotations

import unittest

from ktem.chat_profile import decide_chat_profile


def profile(message: str, **overrides):
    values = {
        "message": message,
        "model_mode": "auto",
        "reasoning_type": "simple",
        "agent_mode": True,
        "file_count": 7,
        "graphrag_enabled": True,
    }
    values.update(overrides)
    return decide_chat_profile(**values)


class ChatProfileTests(unittest.TestCase):
    def test_short_fact_question_uses_direct_rag(self):
        result = profile("Transformer 的核心机制是什么？")
        self.assertEqual(result.name, "fast")
        self.assertFalse(result.use_agent)
        self.assertFalse(result.use_graphrag)

    def test_relational_question_uses_lightweight_planner_without_graphrag(self):
        result = profile("RAG 与 DPR 的引用关系是什么？")
        self.assertEqual(result.name, "standard")
        self.assertTrue(result.use_agent)
        self.assertFalse(result.use_graphrag)
        self.assertEqual(result.planner_max_steps, 2)

    def test_explicit_graph_question_uses_graphrag(self):
        result = profile("分析本地引用图谱中的研究脉络。")
        self.assertEqual(result.name, "deep")
        self.assertTrue(result.use_graphrag)

    def test_cross_paper_review_uses_deep_profile(self):
        result = profile("综合所有文档写一份跨论文研究综述。")
        self.assertEqual(result.name, "deep")
        self.assertEqual(result.planner_max_steps, 4)
        self.assertEqual(result.graph_max_hops, 2)

    def test_explicit_fast_mode_always_skips_agent(self):
        result = profile(
            "比较所有论文的引用关系并写综述",
            model_mode="fast",
        )
        self.assertEqual(result.name, "fast")
        self.assertFalse(result.use_agent)

    def test_graphrag_can_be_globally_disabled(self):
        result = profile(
            "RAG 与 DPR 是什么关系？",
            graphrag_enabled=False,
        )
        self.assertEqual(result.name, "standard")
        self.assertFalse(result.use_graphrag)


if __name__ == "__main__":
    unittest.main()
