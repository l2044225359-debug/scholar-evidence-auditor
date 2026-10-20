from __future__ import annotations

import unittest

from ktem.local_graphrag import LocalGraphRAG, format_graphrag_context


class LocalGraphRAGTests(unittest.TestCase):
    def setUp(self):
        self.graph = LocalGraphRAG(
            papers=[
                {
                    "id": "rag",
                    "title": "Retrieval-Augmented Generation",
                    "abstract": "RAG combines a dense retriever and generator.",
                },
                {
                    "id": "dpr",
                    "title": "Dense Passage Retrieval",
                    "abstract": "DPR trains a dual encoder for retrieval.",
                },
            ],
            citation_edges=[{"source": "rag", "target": "dpr"}],
            entity_nodes=[
                {
                    "id": "paper:rag",
                    "type": "paper",
                    "label": "Retrieval-Augmented Generation",
                    "paper_ids": ["rag"],
                },
                {
                    "id": "method:dual-encoder",
                    "type": "method",
                    "label": "Dual Encoder",
                    "paper_ids": ["dpr"],
                },
                {
                    "id": "topic:retrieval",
                    "type": "topic",
                    "label": "Dense Retrieval",
                    "paper_ids": ["rag", "dpr"],
                },
            ],
            entity_edges=[
                {
                    "source": "paper:dpr",
                    "target": "method:dual-encoder",
                    "relation": "uses_method",
                    "evidence": "DPR uses a dual encoder.",
                    "confidence": 0.9,
                },
                {
                    "source": "paper:rag",
                    "target": "topic:retrieval",
                    "relation": "has_topic",
                    "evidence": "RAG uses dense retrieval.",
                    "confidence": 0.8,
                },
                {
                    "source": "paper:dpr",
                    "target": "topic:retrieval",
                    "relation": "has_topic",
                    "evidence": "DPR is a retrieval model.",
                    "confidence": 0.8,
                },
            ],
        )

    def test_entity_and_citation_edges_contribute_to_retrieval(self):
        result = self.graph.retrieve("How does RAG use dual encoder retrieval?")
        paper_ids = {paper["file_id"] for paper in result["papers"]}
        self.assertEqual(paper_ids, {"rag", "dpr"})
        self.assertGreater(result["metrics"]["activated_nodes"], 2)
        self.assertIn("citation edge", format_graphrag_context(result))

    def test_file_scope_filters_graph_results(self):
        result = self.graph.retrieve(
            "retrieval",
            file_ids=["dpr"],
        )
        self.assertEqual(
            [paper["file_id"] for paper in result["papers"]],
            ["dpr"],
        )

    def test_graph_stats_include_entities_and_citations(self):
        stats = self.graph.stats()
        self.assertEqual(stats["paper_count"], 2)
        self.assertEqual(stats["edge_count"], 4)
        self.assertIn("cites", stats["edge_types"])
        self.assertIn("method", stats["node_types"])


if __name__ == "__main__":
    unittest.main()
