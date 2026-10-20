from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "kotaemon"
    / "loaders"
    / "structured_evidence.py"
)
SPEC = importlib.util.spec_from_file_location(
    "structured_evidence",
    MODULE_PATH,
)
assert SPEC and SPEC.loader
structured_evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(structured_evidence)

(
    EVIDENCE_BBOX_FORMAT,
    build_structured_evidence,
    is_formula_label,
    normalize_bbox,
    page_size_from_legacy,
) = (
    structured_evidence.EVIDENCE_BBOX_FORMAT,
    structured_evidence.build_structured_evidence,
    structured_evidence.is_formula_label,
    structured_evidence.normalize_bbox,
    structured_evidence.page_size_from_legacy,
)


class StructuredEvidenceTests(unittest.TestCase):
    def test_normalizes_top_left_bbox(self):
        bbox = normalize_bbox(
            {"l": 50, "t": 100, "r": 250, "b": 300},
            {"width": 500, "height": 1000},
            "TOPLEFT",
        )
        self.assertEqual(bbox, [0.1, 0.1, 0.5, 0.3])

    def test_normalizes_bottom_left_bbox(self):
        bbox = normalize_bbox(
            [100, 200, 300, 800],
            {"width": 1000, "height": 1000},
            "BOTTOMLEFT",
        )
        self.assertEqual(bbox, [0.1, 0.2, 0.3, 0.8])

    def test_accepts_existing_normalized_bbox(self):
        self.assertEqual(
            normalize_bbox([0.2, 0.1, 0.8, 0.7], None, "TOPLEFT"),
            [0.2, 0.1, 0.8, 0.7],
        )

    def test_rejects_degenerate_bbox(self):
        self.assertIsNone(normalize_bbox([0.3, 0.4, 0.3, 0.8]))

    def test_builds_stable_evidence_metadata(self):
        metadata = build_structured_evidence(
            kind="table",
            page=4,
            bbox=[0.1, 0.2, 0.9, 0.7],
            page_size={"width": 612, "height": 792},
            content="| model | BLEU |",
            caption="Table 2",
            source="attention.pdf",
        )
        self.assertEqual(metadata["evidence_type"], "table")
        self.assertEqual(metadata["bbox_format"], EVIDENCE_BBOX_FORMAT)
        self.assertEqual(
            metadata["structured_evidence"]["content"],
            "| model | BLEU |",
        )
        self.assertEqual(metadata["page_width"], 612)

    def test_detects_formula_labels_and_legacy_page_size(self):
        self.assertTrue(is_formula_label("formula"))
        self.assertTrue(is_formula_label("mathematical_formula"))
        self.assertFalse(is_formula_label("caption"))
        self.assertEqual(
            page_size_from_legacy(
                {"pages": {"2": {"size": {"width": 400, "height": 600}}}},
                2,
            ),
            {"width": 400, "height": 600},
        )


if __name__ == "__main__":
    unittest.main()
