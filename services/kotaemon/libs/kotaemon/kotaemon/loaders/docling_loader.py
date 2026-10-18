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
            if not self.vlm_endpoint:
                continue
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

            # read & crop image
            page_number = figure_obj["prov"][0]["page_no"]

            try:
                page_number_text = str(page_number)
                page_width = result_dict["pages"][page_number_text]["size"]["width"]
                page_height = result_dict["pages"][page_number_text]["size"]["height"]

                bbox_obj = figure_obj["prov"][0]["bbox"]
                bbox: list[float] = [
                    bbox_obj["l"],
                    bbox_obj["t"],
                    bbox_obj["r"],
                    bbox_obj["b"],
                ]
                if bbox_obj["coord_origin"] == "BOTTOMLEFT":
                    bbox = self._convert_bbox_bl_tl(bbox, page_width, page_height)

                img = crop_image(file_path, bbox, page_number - 1)
            except KeyError as e:
                print(e, list(result_dict["pages"].keys()))
                continue

            # convert img to base64
            img_bytes = BytesIO()
            img.save(img_bytes, format="PNG")
            img_base64 = base64.b64encode(img_bytes.getvalue()).decode("utf-8")
            img_base64 = f"data:image/png;base64,{img_base64}"

            # generate the generative caption
            if gen_caption_count >= self.max_figure_to_caption:
                gen_caption = ""
            else:
                gen_caption_count += 1
                gen_caption = generate_single_figure_caption(
                    figure=img_base64, vlm_endpoint=self.vlm_endpoint
                )

            # join the extractive and generative captions
            caption = "\n".join(extractive_captions + [gen_caption])

            # store the image into document
            figure_metadata = {
                "image_origin": img_base64,
                "type": "image",
                "page_label": page_number,
                "file_name": file_name,
                "file_path": file_path,
            }
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

            page_number = table_obj["prov"][0].get("page_no", 1)

            table_metadata = {
                "type": "table",
                "page_label": page_number,
                "table_origin": markdown_table,
                "file_name": file_name,
                "file_path": file_path,
            }
            table_metadata.update(metadata)

            tables.append(
                Document(
                    text=markdown_table,
                    metadata=table_metadata,
                )
            )

        # Join text by page and replace weak/scanned pages with Qwen-OCR.
        texts = []
        page_number_to_text = defaultdict(list)

        for text_obj in result_dict.get("texts", []):
            provenance = text_obj.get("prov") or [{}]
            page_number = provenance[0].get("page_no", 1)
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

        return texts + tables + figures

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
            if text.strip():
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
            tables.append(
                Document(
                    text=rendered_table,
                    metadata={
                        "type": "table",
                        "page_label": self._modern_page_number(table),
                        "table_origin": markdown_table,
                        "file_name": file_name,
                        "file_path": file_path,
                        **metadata,
                    },
                )
            )

        figures = []
        for figure in getattr(output, "figures", []) or []:
            figure_text = (getattr(figure, "text", "") or "").strip()
            if not figure_text:
                continue

            figures.append(
                Document(
                    text=figure_text,
                    metadata={
                        "type": "image",
                        "page_label": self._modern_page_number(figure),
                        "file_name": file_name,
                        "file_path": file_path,
                        **metadata,
                    },
                )
            )

        return texts + tables + figures

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
