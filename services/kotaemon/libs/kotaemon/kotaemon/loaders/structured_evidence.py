from __future__ import annotations

from typing import Any

EVIDENCE_SCHEMA_VERSION = "evidence-v1"
EVIDENCE_BBOX_FORMAT = "normalized_top_left_xyxy"


def _value(source: Any, key: str, default: Any = None) -> Any:
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def is_formula_label(value: Any) -> bool:
    label = str(value or "").strip().lower().replace("_", "").replace(" ", "")
    return any(
        token in label
        for token in (
            "formula",
            "equation",
            "mathematicalformula",
            "mathformula",
        )
    )


def normalize_bbox(
    bbox: Any,
    page_size: dict[str, float] | None = None,
    coord_origin: str | None = None,
) -> list[float] | None:
    if isinstance(bbox, dict):
        coord_origin = str(
            bbox.get("coord_origin") or coord_origin or "TOPLEFT"
        ).upper()
        raw = [
            bbox.get("l"),
            bbox.get("t"),
            bbox.get("r"),
            bbox.get("b"),
        ]
    elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        raw = list(bbox[:4])
    else:
        raw = [
            _value(bbox, "l"),
            _value(bbox, "t"),
            _value(bbox, "r"),
            _value(bbox, "b"),
        ]
        coord_origin = str(
            _value(bbox, "coord_origin", coord_origin or "TOPLEFT")
        ).upper()

    try:
        left, top, right, bottom = [float(value) for value in raw]
    except (TypeError, ValueError):
        return None

    width = float((page_size or {}).get("width") or 0)
    height = float((page_size or {}).get("height") or 0)
    already_normalized = (
        max(abs(left), abs(top), abs(right), abs(bottom)) <= 1.0
    )

    if not already_normalized and width > 0 and height > 0:
        left, right = left / width, right / width
        if coord_origin == "BOTTOMLEFT":
            top, bottom = (height - bottom) / height, (height - top) / height
        else:
            top, bottom = top / height, bottom / height
    elif coord_origin == "BOTTOMLEFT" and height > 0:
        top, bottom = (height - bottom) / height, (height - top) / height

    x0, x1 = sorted((left, right))
    y0, y1 = sorted((top, bottom))
    normalized = [
        max(0.0, min(1.0, x0)),
        max(0.0, min(1.0, y0)),
        max(0.0, min(1.0, x1)),
        max(0.0, min(1.0, y1)),
    ]
    if normalized[2] <= normalized[0] or normalized[3] <= normalized[1]:
        return None
    return [round(value, 6) for value in normalized]


def build_structured_evidence(
    *,
    kind: str,
    page: int,
    bbox: list[float] | None,
    page_size: dict[str, float] | None,
    content: str = "",
    caption: str = "",
    source: str = "",
) -> dict[str, Any]:
    evidence = {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "kind": kind,
        "page": int(page),
        "bbox": bbox,
        "bbox_format": EVIDENCE_BBOX_FORMAT,
        "page_size": {
            "width": round(float((page_size or {}).get("width") or 0), 3),
            "height": round(float((page_size or {}).get("height") or 0), 3),
        },
        "content": str(content or ""),
        "caption": str(caption or ""),
        "source": str(source or ""),
    }
    metadata = {
        "evidence_type": kind,
        "bbox": bbox,
        "bbox_format": EVIDENCE_BBOX_FORMAT,
        "page_width": evidence["page_size"]["width"],
        "page_height": evidence["page_size"]["height"],
        "structured_evidence": evidence,
    }
    return metadata


def page_size_from_legacy(
    result_dict: dict[str, Any],
    page_number: int,
) -> dict[str, float]:
    pages = result_dict.get("pages") or {}
    page = pages.get(str(page_number)) or pages.get(page_number) or {}
    size = page.get("size") or {}
    return {
        "width": float(size.get("width") or 0),
        "height": float(size.get("height") or 0),
    }
