from pathlib import Path

import fitz

from ktem.chat_bff import (
    _compare_document_fingerprints,
    _fingerprint_pdf_bytes,
)


def build_pdf(
    path: Path,
    version: str,
    score: str,
    revision: str,
    arxiv_id: str = "1706.03762",
    title: str = "Attention Is All You Need",
    abstract: str = (
        "The dominant sequence transduction models are based on complex "
        "recurrent or convolutional neural networks. We propose a new "
        "simple network architecture, the Transformer, based solely on "
        "attention mechanisms."
    ),
) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_textbox(
        fitz.Rect(54, 54, 540, 760),
        (
            f"{title}\n"
            f"arXiv:{arxiv_id}{version} [cs.CL]\n\n"
            "Abstract\n"
            f"{abstract}\n\n"
            "1 Introduction\n"
            "Recurrent neural networks have been firmly established as state "
            "of the art approaches in sequence modeling and transduction "
            "problems.\n\n"
            f"Results\nBLEU EN-DE {score}\n{revision}\n"
        ),
        fontsize=11,
    )
    data = document.tobytes()
    document.close()
    path.write_bytes(data)
    return data


def main() -> None:
    root = Path("/tmp/scholar-dedupe-test")
    root.mkdir(parents=True, exist_ok=True)
    v7 = build_pdf(
        root / "1706.03762v7.pdf",
        "v7",
        "28.4",
        "Revised architecture, training, and final results.",
    )
    v1 = build_pdf(
        root / "1706.03762v1.pdf",
        "v1",
        "27.3",
        "Initial manuscript with the earlier result table.",
    )
    other = build_pdf(
        root / "other.pdf",
        "v2",
        "11.0",
        "This study evaluates protein folding with cryogenic microscopy.",
        arxiv_id="2401.99999",
        title="Cryogenic Protein Structure Reconstruction",
        abstract=(
            "We present an unrelated imaging pipeline for protein structure "
            "reconstruction using cryogenic microscopy and spectral fitting."
        ),
    )

    fp7 = _fingerprint_pdf_bytes(v7, "1706.03762v7.pdf")
    fp1 = _fingerprint_pdf_bytes(v1, "1706.03762v1.pdf")
    fp_other = _fingerprint_pdf_bytes(other, "other.pdf")
    assert fp7["canonical_id"] == "arxiv:1706.03762"
    assert fp7["version"] == 7
    assert fp1["version"] == 1

    older = _compare_document_fingerprints(fp7, fp1)
    assert older is not None
    assert older["relationship"] == "incoming_older"
    assert older["recommendation"] == "keep_existing"
    assert older["changed_ratio"] > 0

    newer = _compare_document_fingerprints(fp1, fp7)
    assert newer is not None
    assert newer["relationship"] == "incoming_newer"
    assert newer["recommendation"] == "keep_incoming"
    assert _compare_document_fingerprints(fp7, fp_other) is None

    print("PDF semantic version dedupe tests passed.")


if __name__ == "__main__":
    main()
