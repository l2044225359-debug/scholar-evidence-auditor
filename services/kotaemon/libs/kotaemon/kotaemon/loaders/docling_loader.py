import base64
import warnings
from collections import defaultdict
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import List, Optional

from decouple import config
from kotaemon.base import Document, Param

from .azureai_document_intelligence_loader import crop_image
from .base import BaseReader
from .structured_evidence import (
    build_structured_evidence,
    is_formula_label,
    normalize_bbox,
    page_size_from_legacy,
)
from .utils.adobe import generate_single_figure_caption, make_markdown_table


@lru_cache(maxsize=4)
def _get_ocr_client(api_key: str, base_url: str):
    from openai import OpenAI

    return OpenAI(api_key=api_key, base_url=base_url, timeout=120)


class DoclingReader(BaseReader):
    """Using Docling to extract document structure and content"""

    _dependencies = ["docling"]

    vlm_endpoint: str = Param(
        help=(
            "Default VLM endpoint for figure captioning. "
            "If not provided, will not caption the figures"
        )
    )

    max_figure_to_caption: int = Param(
        100,
        help=(
            "The maximum number of figures to caption. "
            "The rest will be indexed without captions."
        ),
    )

    figure_friendly_filetypes: list[str] = Param(
        [".pdf", ".jpeg", ".jpg", ".png", ".bmp", ".tiff", ".heif", ".tif"],
        help=(
            "File types that we can reliably open and extract figures. "
            "For files like .docx or .html, the visual layout may be different "
            "when viewed from different tools, hence we cannot use Azure DI location "
            "to extract figures."
        ),
    )

    ocr_fallback: bool = Param(
        True,
        help="Use Qwen-OCR for scanned pages or pages with too little text.",
    )

    min_text_chars_per_page: int = Param(
        40,
        help="Pages with less extracted text than this threshold are sent to OCR.",
    )

    ocr_model: str = Param(
        "qwen3.5-ocr",
        help="Qwen OCR model used for page-level fallback.",
    )

    ocr_dpi: int = Param(
        180,
        help="Render resolution for OCR fallback pages.",
    )

    @Param.auto(cache=True)
    def converter_(self):
        try:
            from docling.datamodel.base_models import PipelineOptions
            from docling.document_converter import DocumentConverter
        except ImportError:
            raise ImportError("Please install docling: 'pip install docling'")

        pipeline_options = PipelineOptions()
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = True

        artifacts_path = str(
            config("DOCLING_ARTIFACTS_PATH", default="")
        ).strip()
        if artifacts_path:
            return DocumentConverter(
                pipeline_options=pipeline_options,
                artifacts_path=Path(artifacts_path),
            )

        return DocumentConverter(pipeline_options=pipeline_options)

    def run(
        self, file_path: str | Path, extra_info: Optional[dict] = None, **kwargs
    ) -> List[Document]:
        return self.load_data(file_path, extra_info, **kwargs)

    def load_data(
        self, file_path: str | Path, extra_info: Optional[dict] = None, **kwargs
    ) -> List[Document]:
        """Extract the input file, allowing multi-modal extraction"""

        metadata = extra_info or {}

        try:
            if hasattr(self.converter_, "convert_single"):
                result = self.converter_.convert_single(file_path)
                converted = None
            else:
                converted = self.converter_.convert(file_path)
        except Exception as exc:
            if not self.ocr_fallback:
                raise

            warnings.warn(
                f"Docling failed for {file_path}; falling back to Qwen-OCR: {exc}",
                RuntimeWarning,
            )
            return self._ocr_all_pages(file_path, metadata, str(exc))

        if converted is None:
            result = result
        elif hasattr(converted, "document"):
            result = converted
        else:
            results = list(converted)
            if not results:
                raise RuntimeError(f"Docling returned no result for {file_path}")
            result = results[0]

        document = getattr(result, "document", None)
        if document is None:
            modern_output = getattr(result, "output", None)
            if modern_output is not None:
                return self._load_modern_result(
                    result=result,
                    output=modern_output,
                    file_path=file_path,
                    metadata=metadata,
                )

            raise RuntimeError(f"Docling returned no document for {file_path}")

        result_dict = document.export_to_dict()

        file_path = Path(file_path)
        file_name = file_path.name

        # extract the figures
        figures = []
        gen_caption_count = 0
        for figure_obj in result_dict.get("pictures", []):
            if file_path.suffix.lower() not in self.figure_friendly_filetypes:
                continue

            # retrieve extractive captions provided by docling
            caption_refs = [caption["$ref"] for caption in figure_obj["captions"]]
            extractive_captions = []
            for caption_ref in caption_refs:
                text_id = caption_ref.split("/")[-1]
                try:
                    caption_text = result_dict["texts"][int(text_id)]["text"]
                    extractive_captions.append(caption_text)
                except (ValueError, TypeError, IndexError) as e:
                    print(e)
                    continue

            provenance = figure_obj.get("prov") or [{}]
            page_number = int(provenance[0].get("page_no", 1))
            page_size = page_size_from_legacy(
                result_dict,
                page_number,
            )

            try:
                bbox_obj = provenance[0].get("bbox")
                normalized_bbox = normalize_bbox(
                    bbox_obj,
                    page_size,
                    (bbox_obj or {}).get("coord_origin"),
                )
            except (KeyError, TypeError) as e:
                print(e, list((result_dict.get("pages") or {}).keys()))
                normalized_bbox = None

            # generate the generative caption
            gen_caption = ""
            img_base64 = ""
            if (
                self.vlm_endpoint
                and normalized_bbox
                and gen_caption_count < self.max_figure_to_caption
            ):
                img = crop_image(
                    file_path,
                    normalized_bbox,
                    page_number - 1,
                )
                img_bytes = BytesIO()
                img.save(img_bytes, format="PNG")
                img_base64 = base64.b64encode(img_bytes.getvalue()).decode(
                    "utf-8"
                )
                img_base64 = f"data:image/png;base64,{img_base64}"
                gen_caption_count += 1
                gen_caption = generate_single_figure_caption(
                    figure=img_base64, vlm_endpoint=self.vlm_endpoint
                )

            # join the extractive and generative captions
            caption = "\n".join(extractive_captions + [gen_caption])
            if not caption.strip() and not img_base64:
                continue

            # store the image into document
            figure_metadata = {
                "type": "image",
                "page_label": page_number,
                "file_name": file_name,
                "file_path": file_path,
            }
            if img_base64:
                figure_metadata["image_origin"] = img_base64
            figure_metadata.update(
                build_structured_evidence(
                    kind="figure",
                    page=page_number,
                    bbox=normalized_bbox,
                    page_size=page_size,
                    content=caption,
                    caption="\n".join(extractive_captions),
                    source=file_name,
                )
            )
            figure_metadata.update(metadata)

            figures.append(
                Document(
                    text=caption,
                    metadata=figure_metadata,
                )
            )

        # extract the tables
        tables = []
        for table_obj in result_dict.get("tables", []):
            # convert the tables into markdown format
            markdown_table = self._parse_table(table_obj)
            caption_refs = [caption["$ref"] for caption in table_obj["captions"]]

            extractive_captions = []
            for caption_ref in caption_refs:
                text_id = caption_ref.split("/")[-1]
                try:
                    caption_text = result_dict["texts"][int(text_id)]["text"]
                    extractive_captions.append(caption_text)
                except (ValueError, TypeError, IndexError) as e:
                    print(e)
                    continue
            # join the extractive and generative captions
            caption = "\n".join(extractive_captions)
            markdown_table = f"{caption}\n{markdown_table}"

            provenance = table_obj.get("prov") or [{}]
            page_number = int(provenance[0].get("page_no", 1))
            page_size = page_size_from_legacy(
                result_dict,
                page_number,
            )
            normalized_bbox = normalize_bbox(
                provenance[0].get("bbox"),
                page_size,
                (provenance[0].get("bbox") or {}).get("coord_origin"),
            )

            table_metadata = {
                "type": "table",
                "page_label": page_number,
                "table_origin": markdown_table,
                "file_name": file_name,
                "file_path": file_path,
            }
            table_metadata.update(
                build_structured_evidence(
                    kind="table",
                    page=page_number,
                    bbox=normalized_bbox,
                    page_size=page_size,
                    content=markdown_table,
                    caption=caption,
                    source=file_name,
                )
            )
            table_metadata.update(metadata)

            tables.append(
                Document(
                    text=markdown_table,
                    metadata=table_metadata,
                )
            )

        # Join text by page and replace weak/scanned pages with Qwen-OCR.
        texts = []
        formulas = []
        page_number_to_text = defaultdict(list)

        for text_obj in result_dict.get("texts", []):
            provenance = text_obj.get("prov") or [{}]
            page_number = provenance[0].get("page_no", 1)
            if is_formula_label(text_obj.get("label")):
                formula_text = str(
                    text_obj.get("text") or text_obj.get("orig") or ""
                ).strip()
                if not formula_text:
                    continue
                page_number = int(page_number)
                page_size = page_size_from_legacy(
                    result_dict,
                    page_number,
                )
                bbox_obj = provenance[0].get("bbox")
                normalized_bbox = normalize_bbox(
                    bbox_obj,
                    page_size,
                    (bbox_obj or {}).get("coord_origin"),
                )
                formula_metadata = {
                    "type": "formula",
                    "page_label": page_number,
                    "formula_origin": formula_text,
                    "latex": formula_text,
                    "file_name": file_name,
                    "file_path": file_path,
                }
                formula_metadata.update(
                    build_structured_evidence(
                        kind="formula",
                        page=page_number,
                        bbox=normalized_bbox,
                        page_size=page_size,
                        content=formula_text,
                        source=file_name,
                    )
                )
                formula_metadata.update(metadata)
                formulas.append(
                    Document(
                        text=formula_text,
                        metadata=formula_metadata,
                    )
                )
                continue
            page_number_to_text[page_number].append(text_obj["text"])

        page_numbers = sorted(
            int(page_number)
            for page_number in result_dict.get("pages", {}).keys()
        )
        if not page_numbers:
            page_numbers = sorted(page_number_to_text.keys())

        for page_number in page_numbers:
            page_text = "\n".join(page_number_to_text.get(page_number, [])).strip()
            used_ocr = False

            if self.ocr_fallback and self._needs_ocr(page_text):
                try:
                    ocr_text = self._ocr_page(file_path, page_number)
                except Exception as exc:
                    warnings.warn(
                        f"Qwen-OCR failed for page {page_number} of "
                        f"{file_path}: {exc}",
                        RuntimeWarning,
                    )
                    ocr_text = ""

                if ocr_text.strip():
                    page_text = ocr_text.strip()
                    used_ocr = True

            texts.append(
                Document(
                    text=page_text,
                    metadata={
                        "page_label": page_number,
                        "file_name": file_name,
                        "file_path": file_path,
                        "ocr_fallback": used_ocr,
                        **metadata,
                    },
                )
            )

        return texts + formulas + tables + figures

    def _load_modern_result(
        self,
        result,
        output,
        file_path: str | Path,
        metadata: dict,
    ) -> List[Document]:
        """Handle the Docling 1.x ConversionResult/CCS model."""
        file_path = Path(file_path)
        file_name = file_path.name
        page_number_to_text = defaultdict(list)

        for text_item in getattr(output, "main_text", []) or []:
            page_number = self._modern_page_number(text_item)
            text = getattr(text_item, "text", "") or ""
            if text.strip() and not is_formula_label(
                self._modern_label(text_item)
            ):
                page_number_to_text[page_number].append(text)

        page_numbers = sorted(
            {
                page_number
                for page_number in page_number_to_text
                if page_number > 0
            }
            | set(self._modern_page_numbers(result, output))
        )
        if not page_numbers:
            page_numbers = [1]

        texts = []
        for page_number in page_numbers:
            page_text = "\n".join(
                page_number_to_text.get(page_number, [])
            ).strip()
            used_ocr = False

            if self.ocr_fallback and self._needs_ocr(page_text):
                try:
                    ocr_text = self._ocr_page(file_path, page_number)
                except Exception as exc:
                    warnings.warn(
                        f"Qwen-OCR failed for page {page_number} of "
                        f"{file_path}: {exc}",
                        RuntimeWarning,
                    )
                    ocr_text = ""

                if ocr_text.strip():
                    page_text = ocr_text.strip()
                    used_ocr = True

            texts.append(
                Document(
                    text=page_text,
                    metadata={
                        "page_label": page_number,
                        "file_name": file_name,
                        "file_path": file_path,
                        "ocr_fallback": used_ocr,
                        **metadata,
                    },
                )
            )

        tables = []
        for table in getattr(output, "tables", []) or []:
            table_data = getattr(table, "data", []) or []
            table_rows = []
            for row in table_data:
                table_rows.append([
                    str(
                        cell.get("text", "")
                        if isinstance(cell, dict)
                        else getattr(cell, "text", "")
                    )
                    for cell in row
                ])

            table_text = getattr(table, "text", "") or ""
            markdown_table = make_markdown_table(table_rows)
            rendered_table = "\n".join(
                part for part in (table_text.strip(), markdown_table) if part
            )
            page_number = self._modern_page_number(table)
            page_size = self._modern_page_size(result, output, page_number)
            normalized_bbox = self._modern_bbox(
                table,
                page_size,
            )
            table_metadata = {
                "type": "table",
                "page_label": page_number,
                "table_origin": markdown_table,
                "file_name": file_name,
                "file_path": file_path,
            }
            table_metadata.update(
                build_structured_evidence(
                    kind="table",
                    page=page_number,
                    bbox=normalized_bbox,
                    page_size=page_size,
                    content=rendered_table,
                    caption=table_text,
                    source=file_name,
                )
            )
            table_metadata.update(metadata)
            tables.append(
                Document(
                    text=rendered_table,
                    metadata=table_metadata,
                )
            )

        figures = []
        for figure in getattr(output, "figures", []) or []:
            figure_text = (getattr(figure, "text", "") or "").strip()
            if not figure_text:
                continue
            page_number = self._modern_page_number(figure)
            page_size = self._modern_page_size(result, output, page_number)
            normalized_bbox = self._modern_bbox(figure, page_size)
            figure_metadata = {
                "type": "image",
                "page_label": page_number,
                "file_name": file_name,
                "file_path": file_path,
            }
            figure_metadata.update(
                build_structured_evidence(
                    kind="figure",
                    page=page_number,
                    bbox=normalized_bbox,
                    page_size=page_size,
                    content=figure_text,
                    caption=figure_text,
                    source=file_name,
                )
            )
            figure_metadata.update(metadata)
            figures.append(
                Document(
                    text=figure_text,
                    metadata=figure_metadata,
                )
            )

        formulas = []
        seen_formula_ids = set()
        seen_formula_signatures = set()
        formula_candidates = [
            (formula, True)
            for attribute in ("formulas", "equations")
            for formula in (getattr(output, attribute, []) or [])
        ]
        formula_candidates.extend(
            (formula, False)
            for formula in (getattr(output, "texts", []) or [])
        )
        for formula, explicit_formula in formula_candidates:
            if not explicit_formula and not is_formula_label(
                self._modern_label(formula)
            ):
                continue
            formula_id = str(getattr(formula, "id", "") or "")
            if formula_id and formula_id in seen_formula_ids:
                continue
            if formula_id:
                seen_formula_ids.add(formula_id)
            formula_text = str(
                getattr(formula, "text", "")
                or getattr(formula, "orig", "")
                or ""
            ).strip()
            if not formula_text:
                continue
            page_number = self._modern_page_number(formula)
            page_size = self._modern_page_size(
                result,
                output,
                page_number,
            )
            normalized_bbox = self._modern_bbox(formula, page_size)
            signature = (
                page_number,
                formula_text,
                tuple(normalized_bbox or []),
            )
            if signature in seen_formula_signatures:
                continue
            seen_formula_signatures.add(signature)
            formula_metadata = {
                "type": "formula",
                "page_label": page_number,
                "formula_origin": formula_text,
                "latex": formula_text,
                "file_name": file_name,
                "file_path": file_path,
            }
            formula_metadata.update(
                build_structured_evidence(
                    kind="formula",
                    page=page_number,
                    bbox=normalized_bbox,
                    page_size=page_size,
                    content=formula_text,
                    source=file_name,
                )
            )
            formula_metadata.update(metadata)
            formulas.append(
                Document(
                    text=formula_text,
                    metadata=formula_metadata,
                )
            )

        return texts + formulas + tables + figures

    def _modern_page_numbers(self, result, output) -> List[int]:
        page_numbers = []

        for page in getattr(output, "page_dimensions", []) or []:
            page_number = getattr(page, "page", None)
            if page_number is not None:
                page_numbers.append(int(page_number))

        if page_numbers:
            return page_numbers

        for page in getattr(result, "pages", []) or []:
            page_number = getattr(page, "page_no", None)
            if page_number is not None:
                page_numbers.append(int(page_number))

        if page_numbers and min(page_numbers) == 0:
            page_numbers = [page_number + 1 for page_number in page_numbers]

        return page_numbers

    def _modern_page_number(self, item) -> int:
        provenance = getattr(item, "prov", None)
        if not provenance:
            return 1

        first = provenance[0]
        if isinstance(first, dict):
            page_number = first.get("page") or first.get("page_no") or 1
        else:
            page_number = getattr(first, "page", None) or getattr(
                first, "page_no", 1
            )
        return int(page_number)

    def _modern_label(self, item) -> str:
        label = self._modern_field(item, "label", "")
        return str(getattr(label, "value", label) or "")

    def _modern_field(self, source, key: str, default=None):
        if isinstance(source, dict):
            return source.get(key, default)
        return getattr(source, key, default)

    def _modern_page_size(
        self,
        result,
        output,
        page_number: int,
    ) -> dict[str, float]:
        for index, page in enumerate(
            getattr(output, "page_dimensions", []) or []
        ):
            candidate_page = self._modern_field(page, "page")
            if candidate_page is None:
                candidate_page = index + 1
            if int(candidate_page) != int(page_number):
                continue
            size = self._modern_field(page, "size")
            width = self._modern_field(size, "width")
            height = self._modern_field(size, "height")
            if width is not None and height is not None:
                return {
                    "width": float(width),
                    "height": float(height),
                }

        for page in getattr(result, "pages", []) or []:
            candidate_page = self._modern_field(page, "page_no")
            if candidate_page is None or int(candidate_page) != int(
                page_number
            ):
                continue
            size = self._modern_field(page, "size")
            width = self._modern_field(size, "width")
            height = self._modern_field(size, "height")
            if width is not None and height is not None:
                return {
                    "width": float(width),
                    "height": float(height),
                }
        return {"width": 0.0, "height": 0.0}

    def _modern_bbox(
        self,
        item,
        page_size: dict[str, float],
    ) -> list[float] | None:
        provenance = getattr(item, "prov", None) or []
        if not provenance:
            return None
        first = provenance[0]
        bbox = self._modern_field(first, "bbox")
        return normalize_bbox(bbox, page_size)

    def _needs_ocr(self, page_text: str) -> bool:
        return len(page_text.strip()) < self.min_text_chars_per_page

    def _ocr_all_pages(
        self,
        file_path: str | Path,
        metadata: dict,
        docling_error: str,
    ) -> List[Document]:
        file_path = Path(file_path)
        file_name = file_path.name
        page_count = self._pdf_page_count(file_path)
        documents: List[Document] = []

        for page_number in range(1, page_count + 1):
            try:
                page_text = self._ocr_page(file_path, page_number)
            except Exception as exc:
                warnings.warn(
                    f"Qwen-OCR failed for page {page_number} of "
                    f"{file_path}: {exc}",
                    RuntimeWarning,
                )
                page_text = ""

            if not page_text.strip():
                continue

            documents.append(
                Document(
                    text=page_text.strip(),
                    metadata={
                        "page_label": page_number,
                        "file_name": file_name,
                        "file_path": file_path,
                        "ocr_fallback": True,
                        "docling_error": docling_error,
                        **metadata,
                    },
                )
            )

        return documents

    def _pdf_page_count(self, file_path: str | Path) -> int:
        import fitz

        with fitz.open(str(file_path)) as pdf:
            return pdf.page_count

    def _ocr_page(self, file_path: str | Path, page_number: int) -> str:
        import fitz
        api_key = str(config("OPENAI_API_KEY", default=""))
        base_url = str(config("OPENAI_API_BASE", default=""))
        model = str(config("OPENAI_OCR_MODEL", default=self.ocr_model))

        if not api_key or not base_url:
            return ""

        client = _get_ocr_client(api_key, base_url)

        with fitz.open(str(file_path)) as pdf:
            if page_number < 1 or page_number > pdf.page_count:
                return ""

            page = pdf.load_page(page_number - 1)
            image_bytes = b""
            mime_type = "image/jpeg"

            for dpi in (self.ocr_dpi, 150, 120):
                scale = max(1.0, dpi / 72.0)
                pixmap = page.get_pixmap(
                    matrix=fitz.Matrix(scale, scale),
                    alpha=False,
                )
                try:
                    image_bytes = pixmap.tobytes("jpg", jpg_quality=90)
                    mime_type = "image/jpeg"
                except TypeError:
                    image_bytes = pixmap.tobytes("png")
                    mime_type = "image/png"

                if len(image_bytes) <= 9_500_000:
                    break

        if not image_bytes:
            return ""

        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{mime_type};base64,{image_base64}"

        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                            "min_pixels": 32 * 32 * 3,
                            "max_pixels": 32 * 32 * 8192,
                        },
                        {
                            "type": "text",
                            "text": (
                                "完整提取这一页论文内容。保留标题、作者、摘要、"
                                "正文层级、表格和参考文献；公式使用 LaTeX。"
                                "不要总结、改写或补写缺失内容。"
                            ),
                        },
                    ],
                }
            ],
            max_tokens=8192,
        )

        return completion.choices[0].message.content or ""

    def _convert_bbox_bl_tl(
        self, bbox: list[float], page_width: int, page_height: int
    ) -> list[float]:
        """Convert bbox from bottom-left to top-left"""
        x0, y0, x1, y1 = bbox
        return [
            x0 / page_width,
            (page_height - y1) / page_height,
            x1 / page_width,
            (page_height - y0) / page_height,
        ]

    def _parse_table(self, table_obj: dict) -> str:
        """Convert docling table object to markdown table"""
        table_as_list: List[List[str]] = []
        grid = table_obj["data"]["grid"]
        for row in grid:
            table_as_list.append([])
            for cell in row:
                table_as_list[-1].append(cell["text"])

        return make_markdown_table(table_as_list)
