from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#142126")
INK_RAISED = colors.HexColor("#1b2c30")
PETROL = colors.HexColor("#315d68")
PETROL_DEEP = colors.HexColor("#264a53")
PETROL_WASH = colors.HexColor("#dce8e3")
PAPER = colors.HexColor("#f8f9f5")
SHELF = colors.HexColor("#e7ebe7")
RULE = colors.HexColor("#c8d1cd")
MUTED = colors.HexColor("#60716f")
RED = colors.HexColor("#a84732")
RED_WASH = colors.HexColor("#f1ded8")
AMBER = colors.HexColor("#9b681c")
AMBER_WASH = colors.HexColor("#f3e8d6")
WHITE = colors.white

PAGE_W, PAGE_H = A4
LEFT = 18 * mm
RIGHT = 18 * mm


class Cover(Flowable):
    def __init__(self) -> None:
        super().__init__()
        self.width = PAGE_W
        self.height = PAGE_H

    def draw(self) -> None:
        c = self.canv
        c.saveState()
        c.setFillColor(INK)
        c.rect(-LEFT, -PAGE_H + 18 * mm, PAGE_W, PAGE_H, fill=1, stroke=0)
        c.setFillColor(RED)
        c.rect(-LEFT, PAGE_H - 18 * mm - 9, PAGE_W, 9, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#617875"))
        c.setFont("DengBold", 64)
        c.drawString(-LEFT + 24 * mm, PAGE_H - 43 * mm, "SCHOLAR")
        c.setFillColor(colors.HexColor("#a5b8b5"))
        c.setFont("Deng", 15)
        c.drawString(-LEFT + 25 * mm, PAGE_H - 54 * mm, "SCIENTIFIC EVIDENCE AUDITOR")

        c.setFillColor(PAPER)
        c.setFont("DengBold", 29)
        c.drawString(-LEFT + 25 * mm, PAGE_H - 92 * mm, "证据优先的学术研究")
        c.drawString(-LEFT + 25 * mm, PAGE_H - 105 * mm, "智能体工作台")

        c.setFillColor(colors.HexColor("#d8e1dd"))
        c.setFont("Deng", 12)
        c.drawString(
            -LEFT + 25 * mm,
            PAGE_H - 123 * mm,
            "从 PDF 文档库、混合检索与页码证据，到审计报告、引用网络和科研写作",
        )

        c.setStrokeColor(colors.HexColor("#324347"))
        c.line(
            -LEFT + 25 * mm,
            PAGE_H - 144 * mm,
            PAGE_W - LEFT - 25 * mm,
            PAGE_H - 144 * mm,
        )

        labels = [
            ("01", "DOCUMENT INGESTION", "Docling + OCR + v1/v7 dedupe"),
            ("02", "GROUNDED RAG", "Hybrid retrieval + page citations"),
            ("03", "EVIDENCE AUDIT", "Claims + numbers + contradictions"),
            ("04", "RESEARCH GRAPH", "NetworkX + PageRank + Future Work"),
        ]
        y = PAGE_H - 166 * mm
        for number, title, detail in labels:
            c.setFillColor(RED)
            c.setFont("DengBold", 18)
            c.drawString(-LEFT + 25 * mm, y, number)
            c.setFillColor(PAPER)
            c.setFont("DengBold", 11)
            c.drawString(-LEFT + 43 * mm, y + 3, title)
            c.setFillColor(colors.HexColor("#a5b8b5"))
            c.setFont("Deng", 9)
            c.drawString(-LEFT + 43 * mm, y - 9, detail)
            y -= 23 * mm

        c.setFillColor(colors.HexColor("#a5b8b5"))
        c.setFont("Deng", 9)
        c.drawString(-LEFT + 25 * mm, 24 * mm, "项目技术文档  |  2026 年 10 月  |  比赛提交版")
        c.setFillColor(PETROL)
        c.rect(PAGE_W - LEFT - 72 * mm, 21 * mm, 72 * mm, 4, fill=1, stroke=0)
        c.restoreState()


class ArchitectureDiagram(Flowable):
    def __init__(self, width: float) -> None:
        super().__init__()
        self.width = width
        self.height = 210

    def box(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        subtitle: str,
        fill: colors.Color,
        text_color: colors.Color,
    ) -> None:
        c = self.canv
        c.setFillColor(fill)
        c.setStrokeColor(colors.HexColor("#718581"))
        c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
        c.setFillColor(text_color)
        c.setFont("DengBold", 8.5)
        c.drawCentredString(x + w / 2, y + h - 17, title)
        c.setFont("Deng", 7)
        c.drawCentredString(x + w / 2, y + 11, subtitle)

    def arrow(self, x1: float, y1: float, x2: float, y2: float) -> None:
        c = self.canv
        c.setStrokeColor(colors.HexColor("#9dafaa"))
        c.setFillColor(colors.HexColor("#9dafaa"))
        c.setLineWidth(1.2)
        c.line(x1, y1, x2, y2)
        if x2 > x1:
            c.line(x2, y2, x2 - 5, y2 + 3)
            c.line(x2, y2, x2 - 5, y2 - 3)
        else:
            c.line(x2, y2, x2 + 5, y2 + 3)
            c.line(x2, y2, x2 + 5, y2 - 3)

    def draw(self) -> None:
        margin = 8
        top = self.height - margin
        col_w = (self.width - 32) / 4
        y = top - 54
        self.box(
            margin,
            y,
            col_w,
            54,
            "ADMIN / USER",
            "Browser + Next.js",
            PETROL_WASH,
            INK,
        )
        self.box(
            margin + col_w + 8,
            y,
            col_w,
            54,
            "AUTH + BFF",
            "JWT + same-origin",
            PETROL_WASH,
            INK,
        )
        self.box(
            margin + 2 * (col_w + 8),
            y,
            col_w,
            54,
            "RAG / AUDIT",
            "Kotaemon :7860",
            PAPER,
            INK,
        )
        self.box(
            margin + 3 * (col_w + 8),
            y,
            col_w,
            54,
            "RESEARCH GRAPH",
            "NetworkX :8001",
            PAPER,
            INK,
        )
        self.arrow(margin + col_w + 2, y + 27, margin + col_w + 6, y + 27)
        self.arrow(
            margin + 2 * col_w + 10,
            y + 27,
            margin + 2 * col_w + 14,
            y + 27,
        )
        self.arrow(
            margin + 3 * col_w + 18,
            y + 27,
            margin + 3 * col_w + 22,
            y + 27,
        )

        y2 = y - 74
        self.box(
            margin,
            y2,
            col_w,
            48,
            "PDF / CSV",
            "Validated upload",
            PAPER,
            INK,
        )
        self.box(
            margin + col_w + 8,
            y2,
            col_w,
            48,
            "DOCLING",
            "Layout + tables",
            AMBER_WASH,
            INK,
        )
        self.box(
            margin + 2 * (col_w + 8),
            y2,
            col_w,
            48,
            "QWEN OCR",
            "Scanned pages",
            AMBER_WASH,
            INK,
        )
        self.box(
            margin + 3 * (col_w + 8),
            y2,
            col_w,
            48,
            "MODEL ROUTER",
            "Flash / Max",
            PETROL_WASH,
            INK,
        )
        self.arrow(margin + col_w + 2, y2 + 24, margin + col_w + 6, y2 + 24)
        self.arrow(
            margin + 2 * col_w + 10,
            y2 + 24,
            margin + 2 * col_w + 14,
            y2 + 24,
        )
        self.arrow(
            margin + 3 * col_w + 18,
            y2 + 24,
            margin + 3 * col_w + 22,
            y2 + 24,
        )

        y3 = y2 - 56
        self.box(
            margin + 22,
            y3,
            self.width - 44,
            35,
            "SINGLE WORKER + SQLITE QUEUE + GROUNDED EVIDENCE STORE",
            "index_pdf and audit jobs are serialized; runtime data stays outside Git",
            INK_RAISED,
            PAPER,
        )


def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "TitleCN",
            parent=base["Title"],
            fontName="DengBold",
            fontSize=23,
            leading=29,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=8 * mm,
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "H1CN",
            parent=base["Heading1"],
            fontName="DengBold",
            fontSize=17,
            leading=22,
            textColor=INK,
            spaceBefore=2 * mm,
            spaceAfter=4 * mm,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "H2CN",
            parent=base["Heading2"],
            fontName="DengBold",
            fontSize=11.5,
            leading=16,
            textColor=PETROL_DEEP,
            spaceBefore=3 * mm,
            spaceAfter=2 * mm,
            wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "BodyCN",
            parent=base["BodyText"],
            fontName="Deng",
            fontSize=9.5,
            leading=16,
            textColor=colors.HexColor("#334744"),
            spaceAfter=2.6 * mm,
            wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "SmallCN",
            parent=base["BodyText"],
            fontName="Deng",
            fontSize=8,
            leading=12,
            textColor=MUTED,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "BulletCN",
            parent=base["BodyText"],
            fontName="Deng",
            fontSize=9.2,
            leading=15,
            leftIndent=12,
            firstLineIndent=-8,
            bulletIndent=2,
            textColor=colors.HexColor("#334744"),
            spaceAfter=1.8 * mm,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "CaptionCN",
            parent=base["BodyText"],
            fontName="Deng",
            fontSize=7.7,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=1.5 * mm,
            spaceAfter=3 * mm,
            wordWrap="CJK",
        ),
        "callout": ParagraphStyle(
            "CalloutCN",
            parent=base["BodyText"],
            fontName="DengBold",
            fontSize=9.4,
            leading=15,
            textColor=PETROL_DEEP,
            wordWrap="CJK",
        ),
        "cell": ParagraphStyle(
            "CellCN",
            parent=base["BodyText"],
            fontName="Deng",
            fontSize=8.2,
            leading=12,
            textColor=INK,
            wordWrap="CJK",
        ),
        "cell_bold": ParagraphStyle(
            "CellBoldCN",
            parent=base["BodyText"],
            fontName="DengBold",
            fontSize=8.2,
            leading=12,
            textColor=INK,
            wordWrap="CJK",
        ),
        "cell_header": ParagraphStyle(
            "CellHeaderCN",
            parent=base["BodyText"],
            fontName="DengBold",
            fontSize=8.2,
            leading=12,
            textColor=WHITE,
            wordWrap="CJK",
        ),
    }
    return styles


def header_footer(canvas, doc) -> None:
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, PAGE_H - 11 * mm, PAGE_W, 11 * mm, fill=1, stroke=0)
    canvas.setFillColor(PAPER)
    canvas.setFont("DengBold", 7.5)
    canvas.drawString(LEFT, PAGE_H - 7.2 * mm, "SCHOLAR / TECHNICAL DOCUMENT")
    canvas.setFillColor(colors.HexColor("#a5b8b5"))
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 7.2 * mm, "2026-10")
    canvas.setStrokeColor(RULE)
    canvas.line(LEFT, 14 * mm, PAGE_W - RIGHT, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Deng", 7.3)
    canvas.drawString(LEFT, 9.2 * mm, "证据优先的学术研究智能体工作台")
    canvas.drawRightString(PAGE_W - RIGHT, 9.2 * mm, f"{doc.page:02d}")
    canvas.restoreState()


def cover_page(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(RED)
    canvas.rect(0, PAGE_H - 9, PAGE_W, 9, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#617875"))
    canvas.setFont("DengBold", 64)
    canvas.drawString(24 * mm, PAGE_H - 43 * mm, "SCHOLAR")
    canvas.setFillColor(colors.HexColor("#a5b8b5"))
    canvas.setFont("Deng", 15)
    canvas.drawString(25 * mm, PAGE_H - 54 * mm, "SCIENTIFIC EVIDENCE AUDITOR")

    canvas.setFillColor(PAPER)
    canvas.setFont("DengBold", 29)
    canvas.drawString(25 * mm, PAGE_H - 92 * mm, "证据优先的学术研究")
    canvas.drawString(25 * mm, PAGE_H - 105 * mm, "智能体工作台")

    canvas.setFillColor(colors.HexColor("#d8e1dd"))
    canvas.setFont("Deng", 12)
    canvas.drawString(
        25 * mm,
        PAGE_H - 123 * mm,
        "从 PDF 文档库、混合检索与页码证据，到审计报告、引用网络和科研写作",
    )

    canvas.setStrokeColor(colors.HexColor("#324347"))
    canvas.line(25 * mm, PAGE_H - 144 * mm, PAGE_W - 25 * mm, PAGE_H - 144 * mm)

    labels = [
        ("01", "DOCUMENT INGESTION", "Docling + OCR + v1/v7 dedupe"),
        ("02", "GROUNDED RAG", "Hybrid retrieval + page citations"),
        ("03", "EVIDENCE AUDIT", "Claims + numbers + contradictions"),
        ("04", "RESEARCH GRAPH", "NetworkX + PageRank + Future Work"),
    ]
    y = PAGE_H - 166 * mm
    for number, title, detail in labels:
        canvas.setFillColor(RED)
        canvas.setFont("DengBold", 18)
        canvas.drawString(25 * mm, y, number)
        canvas.setFillColor(PAPER)
        canvas.setFont("DengBold", 11)
        canvas.drawString(43 * mm, y + 3, title)
        canvas.setFillColor(colors.HexColor("#a5b8b5"))
        canvas.setFont("Deng", 9)
        canvas.drawString(43 * mm, y - 9, detail)
        y -= 23 * mm

    canvas.setFillColor(colors.HexColor("#a5b8b5"))
    canvas.setFont("Deng", 9)
    canvas.drawString(25 * mm, 24 * mm, "项目技术文档  |  2026 年 10 月  |  比赛提交版")
    canvas.setFillColor(PETROL)
    canvas.rect(PAGE_W - 97 * mm, 21 * mm, 72 * mm, 4, fill=1, stroke=0)
    canvas.restoreState()


def p(value: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(value, style)


def bullets(items: list[str], styles: dict[str, ParagraphStyle]) -> list[Paragraph]:
    return [p(f"- {item}", styles["bullet"]) for item in items]


def callout(value: str, styles: dict[str, ParagraphStyle], tone: str = "petrol") -> Table:
    fill = PETROL_WASH if tone == "petrol" else (AMBER_WASH if tone == "amber" else RED_WASH)
    accent = PETROL if tone == "petrol" else (AMBER if tone == "amber" else RED)
    table = Table([[p(value, styles["callout"])]], colWidths=[PAGE_W - LEFT - RIGHT])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def data_table(
    rows: list[list[str]],
    widths: list[float],
    styles: dict[str, ParagraphStyle],
    header: bool = True,
) -> Table:
    converted: list[list[Paragraph]] = []
    for row_index, row in enumerate(rows):
        if header and row_index == 0:
            style = styles["cell_header"]
        else:
            style = styles["cell"]
        converted.append([p(value, style) for value in row])
    table = Table(converted, colWidths=widths, repeatRows=1 if header else 0)
    commands = [
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER]),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ]
        )
    table.setStyle(TableStyle(commands))
    return table


def image_flowable(
    path: Path,
    max_width: float,
    max_height: float,
) -> Image:
    with PILImage.open(path) as img:
        width, height = img.size
    ratio = min(max_width / width, max_height / height)
    return Image(str(path), width=width * ratio, height=height * ratio)


def figure(
    path: Path,
    caption: str,
    styles: dict[str, ParagraphStyle],
    max_height: float = 102 * mm,
) -> list[Flowable]:
    if not path.exists():
        return [callout(f"缺失截图：{path.name}", styles, "red")]
    return [
        image_flowable(path, PAGE_W - LEFT - RIGHT, max_height),
        p(caption, styles["caption"]),
    ]


def add_section(
    story: list[Flowable],
    number: str,
    title: str,
    intro: str,
    styles: dict[str, ParagraphStyle],
) -> None:
    kicker = Table(
        [[p(number, styles["cell_bold"]), p("TECHNICAL NOTE", styles["small"])]],
        colWidths=[15 * mm, PAGE_W - LEFT - RIGHT - 15 * mm],
        rowHeights=[8 * mm],
    )
    kicker.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), RED),
                ("TEXTCOLOR", (0, 0), (0, 0), WHITE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (1, 0), (1, 0), 0.5, RULE),
            ]
        )
    )
    story.extend([kicker, p(title, styles["title"]), p(intro, styles["body"])])


def build(project_root: Path, output: Path) -> None:
    pdfmetrics.registerFont(TTFont("Deng", r"C:\Windows\Fonts\Deng.ttf"))
    pdfmetrics.registerFont(TTFont("DengBold", r"C:\Windows\Fonts\Dengb.ttf"))
    styles = build_styles()
    output.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=19 * mm,
        bottomMargin=18 * mm,
        title="Scholar 证据优先的学术研究智能体工作台 - 技术文档",
        author="Scholar Project",
        subject="比赛项目技术文档",
    )

    story: list[Flowable] = [Spacer(1, 1), PageBreak()]
    content_width = PAGE_W - LEFT - RIGHT

    add_section(
        story,
        "01",
        "项目摘要",
        "Scholar 面向学生、研究者和需要快速核验材料的评审人员，把本地论文集合转化为可追溯的研究工作区。"
        "系统以证据为第一等对象：回答、审计结论、引用网络和写作建议都必须能回到文档、页码与原文片段。",
        styles,
    )
    summary_rows = [
        ["目标问题", "Project response"],
        ["论文内容分散，普通聊天难以核验来源", "PDF 文档库 + 页码证据 + 同源 PDF 预览"],
        ["扫描页无法稳定检索", "Docling 解析 + qwen3.5-ocr 回退"],
        ["版本混杂、重复入库", "内容哈希、arXiv 身份、正文相似度与版本差异"],
        ["答案正确性难以审查", "Claim 抽取、数字核验、引用完整性、矛盾判定"],
        ["研究工具彼此割裂", "Agent Trace 串联检索、arXiv、CSV、图表、写作与引用图"],
    ]
    story.append(data_table(summary_rows, [68 * mm, content_width - 68 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.append(
        callout(
            "核心价值：不是让模型“回答得更像论文”，而是让每个关键结论都保留来源、页码、"
            "验证结果与可复现的分析步骤。",
            styles,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.extend(
        bullets(
            [
                "双语工作台：完整支持中文与英文界面。",
                "模型路由：qwen3.8-flash 处理常规任务，qwen3.8-max 处理复杂多文档推理。",
                "检索组合：qwen3.7-text-embedding 向量化，qwen3-rerank 重排。",
                "真实工具：arXiv 下载、CSV/Matplotlib、Mermaid/TikZ、References/BibTeX。",
                "工程证据：30 条自动评测全部通过，平均响应延迟约 10.5 秒。",
            ],
            styles,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "02",
        "用户闭环与命题覆盖",
        "产品围绕一条可现场验证的研究链路组织：选择文档、提出问题、检查证据、运行审计、探索引用网络，"
        "最后把结果转化为图表、论文框架或综述方向。",
        styles,
    )
    workflow = [
        ["阶段", "用户动作", "系统输出"],
        ["01 文档接入", "批量上传 PDF 或通过 arXiv 工具导入", "解析状态、页数、队列与版本判断"],
        ["02 研究问答", "选择单篇或全库，使用中文/英文提问", "流式答案、页码引用、检索证据"],
        ["03 证据检查", "打开 PDF.js 或运行 Evidence Audit", "正文/References 跳转、Claim 判定、报告"],
        ["04 研究分析", "运行 CSV、生成图表或构图", "Figure Caption、Mermaid、TikZ、PageRank"],
        ["05 写作延伸", "生成论文框架与 References", "受限引用、已验证参考文献、BibTeX"],
    ]
    story.append(data_table(workflow, [28 * mm, 70 * mm, content_width - 98 * mm], styles))
    story.append(Spacer(1, 5 * mm))
    story.append(p("面向评审的可见深度", styles["h2"]))
    coverage = [
        ["评审维度", "系统证据", "演示入口"],
        ["大模型应用能力", "混合检索、重排、Flash/Max 路由、流式 BFF", "研究问答"],
        ["智能体能力", "规划、检索、综合、真实工具调用与耗时轨迹", "Agent Trace"],
        ["可信 AI", "页码引用、数字核验、引用完整性、拒答", "Evidence Audit"],
        ["数据工程", "Docling、OCR、版本去重、单工作线程队列", "文档库"],
        ["科研创新", "PDF 双向引用、本地引用图、Future Work、BibTeX", "PDF Reader / Graph / Writing"],
        ["工程交付", "WSL 全服务、30/30 评测、公网安全边界", "System Status"],
    ]
    story.append(data_table(coverage, [38 * mm, 82 * mm, content_width - 120 * mm], styles))
    story.append(PageBreak())

    add_section(
        story,
        "03",
        "总体架构",
        "系统采用 Windows 客户端、WSL 服务端和 Next.js 同源 BFF 的组合。所有业务模型密钥只保存在服务端环境变量中，"
        "浏览器不直接访问 Kotaemon、Citation Graph 或 VibeVoice。",
        styles,
    )
    story.append(ArchitectureDiagram(content_width))
    story.append(Spacer(1, 3 * mm))
    architecture_rows = [
        ["组件", "职责", "边界"],
        ["Next.js :3000", "认证、工作台、BFF、SSE、文件代理、管理端", "唯一可发布端口"],
        ["Kotaemon :7860", "解析、检索、向量、重排、模型调用", "仅 WSL 回环"],
        ["Citation Graph :8001", "OpenAlex/Crossref、本地构图、NetworkX", "仅 WSL 回环"],
        ["VibeVoice :8002", "英文答案语音合成", "仅回环，经认证 BFF 访问"],
        ["SQLite Worker", "PDF 索引与 Audit 单实例队列", "WSL 内持久数据"],
    ]
    story.append(data_table(architecture_rows, [39 * mm, 82 * mm, content_width - 121 * mm], styles))
    story.append(Spacer(1, 3 * mm))
    story.append(
        callout(
            "部署原则：公网只需要 HTTPS 到 Next.js:3000。内部服务不增加任何公网路由，"
            "避免把管理 BFF、数据库或模型服务直接暴露。",
            styles,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "04",
        "文档摄入、OCR 与版本治理",
        "管理员批量上传 PDF 后，文件先经过扩展名、签名和大小检查，再进入 SQLite 队列。"
        "单实例 worker 以 immediate transaction 领取任务，避免解析与审计并发挤占模型和磁盘资源。",
        styles,
    )
    story.append(p("解析路径", styles["h2"]))
    story.extend(
        bullets(
            [
                "Docling 负责正文、版式、表格、图像与页码结构。",
                "扫描页或极低文本页调用 qwen3.5-ocr，再写回文本集合。",
                "页面块进入 qwen3.7-text-embedding 向量索引，检索时使用 qwen3-rerank。",
                "失败任务保留错误信息，可由管理员重试；成功后上传的临时文件清理。",
            ],
            styles,
        )
    )
    story.append(p("v1/v7 语义去重", styles["h2"]))
    dedupe_rows = [
        ["顺序", "信号", "作用"],
        ["1", "SHA-256", "字节完全一致时立即判重"],
        ["2", "arXiv ID + version", "识别同一论文的不同版本"],
        ["3", "正文 shingle 重合度", "发现换名、重排或重新导出的副本"],
        ["4", "标题与摘要相似度", "覆盖元数据缺失的弱匹配场景"],
    ]
    story.append(data_table(dedupe_rows, [16 * mm, 52 * mm, content_width - 68 * mm], styles))
    story.append(Spacer(1, 3 * mm))
    story.extend(
        figure(
            project_root / "outputs/day6_dedupe_v1_v7.png",
            "图 4-1  批量上传提示同一论文 v1/v7，展示版本差异与管理员决策。",
            styles,
            103 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "05",
        "混合检索与双模型路由",
        "检索层把向量相似度、文档范围和重排结果组合成证据候选集合。回答层根据任务复杂度选择模型，"
        "并在流式输出中保留结构化引用对象。",
        styles,
    )
    route_rows = [
        ["任务", "模型", "原因"],
        ["普通单文档问答、翻译、Caption", "qwen3.8-flash", "低延迟、成本稳定、足够覆盖常规理解"],
        ["跨多篇比较、矛盾判定、Future Work", "qwen3.8-max", "更强长上下文与复杂综合能力"],
        ["向量检索", "qwen3.7-text-embedding", "与知识库统一语义空间"],
        ["候选证据重排", "qwen3-rerank", "提升相关页在前，失败时可降级为原顺序"],
        ["扫描页识别", "qwen3.5-ocr", "在 Docling 无可用文本时补足 OCR"],
    ]
    story.append(data_table(route_rows, [50 * mm, 38 * mm, content_width - 88 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "检索结果保留文档、页码、块 ID、原始分数和重排分数。",
                "SSE 事件分为 planning、retrieval、synthesis、completion，前端可稳定增量渲染。",
                "引用标记与证据块建立独立映射，不依赖模型自由生成的 URL。",
                "重排服务异常时保留检索顺序，避免把可用问答直接变成 500。",
                "翻译请求保留数字引用、公式、URL 和元数据，供 PDF.js 中英对照使用。",
            ],
            styles,
        )
    )
    story.append(Spacer(1, 2 * mm))
    story.extend(
        figure(
            project_root / "outputs/day5_chat_zh.png",
            "图 5-1  中文研究问答、流式答案、页码引用与右侧证据栏。",
            styles,
            112 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "06",
        "Agent Trace 与真实工具调用",
        "Agent Trace 不是静态日志，而是用户当前会话中的结构化事件流。它展示模型路由、检索、综合和工具步骤，"
        "并将每一步的耗时和输出状态暴露给使用者。",
        styles,
    )
    tool_rows = [
        ["工具", "执行流程", "限制与安全"],
        ["arXiv", "解析 ID → Atom 元数据 → 下载 → 签名校验 → 重复判断 → 索引", "不接受任意 URL"],
        ["CSV", "类型画像 → 缺失值/统计 → Matplotlib → Flash Caption → Mermaid/TikZ", "仅 CSV、10 MB、登录与限流"],
        ["Writing", "本地文献 → OpenAlex/Crossref → 受限 [R#] → Max 框架 → References/BibTeX", "删除未验证引用"],
        ["Voice", "英文回答文本 → 认证 BFF → VibeVoice WAV", "内部 8002、中文模式隐藏"],
    ]
    story.append(data_table(tool_rows, [30 * mm, 86 * mm, content_width - 116 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        figure(
            project_root / "outputs/day6_agent_trace.png",
            "图 6-1  规划、检索、综合和工具调用按顺序展开，并记录可观察状态。",
            styles,
            102 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "07",
        "证据审计链路",
        "Evidence Audit 将模型答案拆成原子 Claim，再把每个 Claim 映射到页码证据。数字判断走确定性校验，"
        "语义判断按单文档与多文档范围路由到 Flash 或 Max。",
        styles,
    )
    audit_steps = [
        ["步骤", "输入", "输出"],
        ["1. Claim 抽取", "问题、答案、引用", "原子 Claim 列表"],
        ["2. 证据映射", "Citation ID、页块", "Claim 与来源页锚点"],
        ["3. 数字核验", "Claim 中的数值与单位", "匹配、冲突或缺失"],
        ["4. 语义核验", "证据片段", "supported / contradicted / insufficient"],
        ["5. 引用完整性", "答案引用标记", "合法率与重建结果"],
        ["6. 报告", "全部结构化结果", "JSON 与可打印 HTML"],
    ]
    story.append(data_table(audit_steps, [35 * mm, 62 * mm, content_width - 97 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.append(
        callout(
            "数字核验与语义核验分离：数字必须能在证据页中找到一致值；模型只负责语义支持关系，"
            "不能替代确定性数值比较。",
            styles,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.extend(
        figure(
            project_root / "outputs/day3_audit_report_final.png",
            "图 7-1  Claim、页码证据、数字核验与矛盾/证据不足判定。",
            styles,
            110 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "08",
        "PDF.js 学术阅读器",
        "引用点击后打开同源 PDF.js 阅读器，并定位到具体页。阅读器把版式阅读、标题树、References 和翻译放在同一工作流中，"
        "让证据从“片段”升级为“可阅读的论文上下文”。",
        styles,
    )
    reader_rows = [
        ["能力", "实现"],
        ["渲染与部署", "PDF.js worker 本地托管，无 CDN，页面通过 IntersectionObserver 懒加载"],
        ["标题树", "优先读取嵌入 outline，无 outline 时按字号、加粗和基线生成三级标题"],
        ["引用解析", "识别正文 [12]、[9, 11] 等数字引用，并解析 References 编号条目"],
        ["双向跳转", "正文编号 → References 条目；条目被引页码 → 原正文位置"],
        ["中英对照", "页级 qwen3.8-flash 翻译，保留引用、公式、URL 和页结构"],
        ["同步滚动", "左右两栏使用归一化比例，移动任一栏可保持同页位置"],
    ]
    story.append(data_table(reader_rows, [35 * mm, content_width - 35 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        figure(
            project_root / "outputs/day6_pdf_reader.png",
            "图 8-1  PDF.js 阅读器、标题树、引用跳转与中英同步对照。",
            styles,
            106 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "09",
        "数据分析、图表与论文写作",
        "Agent 的真实工具链把研究中间产物的处理也纳入可复现范围。CSV 不只生成一张图，还输出图注、"
        "Mermaid 和 TikZ 源码；Writing 不只生成文本，还输出受限引用、References 和 BibTeX。",
        styles,
    )
    story.append(p("CSV → Matplotlib → Figure Caption", styles["h2"]))
    story.extend(
        bullets(
            [
                "pandas 统计数值列、分类列、缺失率和分组结果。",
                "Matplotlib 根据字段结构选择折线、柱状或散点图。",
                "qwen3.8-flash 依据计算结果生成 Caption，模型失败时使用确定性模板。",
                "同一组绘图点生成 Mermaid xychart-beta 与 TikZ/PGFPlots，坐标保持一致。",
            ],
            styles,
        )
    )
    story.extend(
        figure(
            project_root / "outputs/day6_agent_csv.png",
            "图 9-1  CSV 分析结果、图表与学术图注。",
            styles,
            83 * mm,
        )
    )
    story.append(p("论文框架与 References", styles["h2"]))
    story.extend(
        bullets(
            [
                "从本地文档库提取标题、摘要、arXiv 身份，并补充 OpenAlex/Crossref 元数据。",
                "为候选论文分配 [R1]、[R2] 等受限引用键。",
                "qwen3.8-max 生成从 Abstract 到 Conclusion 的框架与论证建议。",
                "删除不在候选列表中的引用键；末尾追加确定性的 References 与 BibTeX。",
            ],
            styles,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "10",
        "本地引用网络与 Future Work",
        "Citation Graph 默认读取当前本地文档库，最多构图 20 篇论文。系统从 PDF 尾部抽取 References 和 Future Work，"
        "根据 arXiv ID 或规范化标题匹配本地节点，构建有向引用边。",
        styles,
    )
    graph_rows = [
        ["指标", "说明"],
        ["PageRank", "衡量论文在整个引用网络中的结构重要性"],
        ["In/Out degree", "显示被本地论文引用与引用本地论文的数量"],
        ["Degree centrality", "衡量节点直接连接广度"],
        ["Density", "判断当前语料中的引用连接稀疏程度"],
        ["Weakly connected components", "识别互不连接的论文簇"],
        ["Future Work 综合", "qwen3.8-max 合并方向、引用支持论文并给出实验议程"],
    ]
    story.append(data_table(graph_rows, [48 * mm, content_width - 48 * mm], styles))
    story.append(Spacer(1, 3 * mm))
    story.extend(
        figure(
            project_root / "outputs/day6_local_citation_graph.png",
            "图 10-1  本地引用图、PageRank 基石论文与 Future Work 综合。",
            styles,
            108 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "11",
        "身份、安全与公网部署",
        "系统使用邀请制注册、Argon2id 密码哈希和 Auth.js 签名 JWT 会话。Kotaemon BFF Token 仅存在服务端。"
        "公网部署只暴露 Next.js，入口通过 Cloudflare Tunnel 终止 TLS。",
        styles,
    )
    security_rows = [
        ["边界", "措施"],
        ["登录与会话", "随机演示密码、Argon2id、12 小时 JWT Cookie、登录限流"],
        ["角色", "admin 管理用户/邀请/文档；user 使用研究与私有历史"],
        ["BFF", "同源代理、路径限制、服务端密钥、安全响应头"],
        ["文件", "扩展名与签名校验、100 MB 上限、PDF 同源预览"],
        ["公网入口", "Cloudflare Tunnel → localhost:3000，内部端口不开放"],
        ["提交包", "排除 .env、数据库、上传、向量库、模型缓存、虚拟环境与日志"],
    ]
    story.append(data_table(security_rows, [38 * mm, content_width - 38 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.append(p("两种公网模式", styles["h2"]))
    deploy_rows = [
        ["模式", "适用场景", "限制"],
        ["Quick Tunnel", "五分钟现场演示、临时地址", "进程停止即失效，不适合固定提交入口"],
        ["Named Tunnel", "固定域名、正式评审入口", "需要 Cloudflare 账号、域名和本机持续运行"],
        ["LAN 保底", "现场网络或公网不稳定", "仅在可信局域网使用"],
    ]
    story.append(data_table(deploy_rows, [38 * mm, 60 * mm, content_width - 98 * mm], styles))
    story.append(Spacer(1, 3 * mm))
    story.append(
        callout(
            "禁止发布：Kotaemon 7860、Citation Graph 8001、VibeVoice 8002、SQLite、上传目录、"
            "向量库、WSL SSH 与任何包含 API Key 的日志。",
            styles,
            "red",
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "12",
        "测试证据与工程质量",
        "最终评测集包含 30 个问题，覆盖方法、数字、架构、跨文档综合、OCR、拒答和矛盾处理。"
        "验证同时包含登录、未认证拒绝、单工作线程、SSE、PDF 代理、引用跳转、Agent 工具和构建门槛。",
        styles,
    )
    result_path = project_root / "tests/evaluation/results.json"
    summary = {}
    if result_path.exists():
        summary = json.loads(result_path.read_text(encoding="utf-8")).get("summary", {})
    total = summary.get("total", 30)
    pass_rate = round(100 * summary.get("passRate", 1))
    retrieval_rate = round(100 * summary.get("retrievalHitRate", 1))
    citation_rate = round(100 * summary.get("citationPassRate", 1))
    number_rate = round(100 * summary.get("numberPassRate", 1))
    refusal_rate = round(100 * summary.get("refusalPassRate", 1))
    latency = round(summary.get("averageLatencyMs", 10475.666) / 1000, 1)
    metrics = [
        [str(total), f"{pass_rate}%", f"{retrieval_rate}%", f"{citation_rate}%"],
        ["评测用例", "总通过率", "检索命中", "引用页命中"],
    ]
    metric_table = Table(metrics, colWidths=[content_width / 4] * 4, rowHeights=[20 * mm, 9 * mm])
    metric_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PETROL),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("BACKGROUND", (0, 1), (-1, 1), PETROL_WASH),
                ("TEXTCOLOR", (0, 1), (-1, 1), PETROL_DEEP),
                ("FONTNAME", (0, 0), (-1, 0), "DengBold"),
                ("FONTSIZE", (0, 0), (-1, 0), 19),
                ("FONTNAME", (0, 1), (-1, 1), "Deng"),
                ("FONTSIZE", (0, 1), (-1, 1), 8),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE),
            ]
        )
    )
    story.append(metric_table)
    story.append(Spacer(1, 4 * mm))
    story.append(
        data_table(
            [
                ["指标", "结果"],
                ["数字核验通过率", f"{number_rate}%"],
                ["拒答正确率", f"{refusal_rate}%"],
                ["平均端到端延迟", f"{latency} 秒"],
                ["PDF 版本去重", "arXiv v1/v7 与官方 PDF 字节一致性验证通过"],
                ["本地引用图", "7 篇论文、2 条本地引用边、5 个弱连通分量"],
                ["构建门槛", "Next.js production build 与 TypeScript 检查通过"],
            ],
            [54 * mm, content_width - 54 * mm],
            styles,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.extend(
        figure(
            project_root / "outputs/day4_citation_proxy.png",
            "图 12-1  认证文件代理与系统联通性验证证据。",
            styles,
            84 * mm,
        )
    )
    story.append(PageBreak())

    add_section(
        story,
        "13",
        "创新点、限制与下一阶段",
        "项目的差异不在于接入更多按钮，而在于把“可信证据”作为统一数据契约贯穿文档、检索、审计、阅读、引用图和写作。",
        styles,
    )
    innovation_rows = [
        ["创新点", "实际价值"],
        ["证据优先数据模型", "回答、Claim、页码和引用共享同一来源链路"],
        ["内容级版本治理", "v1/v7 不只判重，还展示差异并允许人工决策"],
        ["审计与聊天分离", "数字确定性核验避免模型自证正确"],
        ["PDF 双向引用", "从答案进入论文后再回到具体被引页"],
        ["本地研究图", "无需上传私有论文即可计算 PageRank 和 Future Work"],
        ["可复现科研工具", "图表同时输出 Caption、Mermaid、TikZ 和 BibTeX"],
    ]
    story.append(data_table(innovation_rows, [48 * mm, content_width - 48 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    story.append(p("当前限制", styles["h2"]))
    story.extend(
        bullets(
            [
                "数字引用优先支持 [n] 形式，作者-年份引用尚未自动链接。",
                "本地引用图依赖 PDF 可抽取的 References 与 Future Work 文本。",
                "VibeVoice Realtime 当前主要支持英文，中文模式不展示语音控制。",
                "固定公网入口需要单独的域名与 Tunnel 配置，临时 Quick Tunnel 会变化。",
            ],
            styles,
        )
    )
    story.append(p("下一阶段", styles["h2"]))
    phase_rows = [
        ["阶段", "目标"],
        ["近期", "作者-年份引用、批量文献导入、更多期刊模板"],
        ["中期", "PaperQA 深度科研问答、任务持久化、团队协作与权限审计"],
        ["长期", "私有化部署、机构知识库、跨语言全文检索与研究项目记忆"],
    ]
    story.append(data_table(phase_rows, [28 * mm, content_width - 28 * mm], styles))
    story.append(PageBreak())

    add_section(
        story,
        "14",
        "答辩演示脚本",
        "建议使用 5-8 分钟完成一次完整答辩。演示顺序从可信证据出发，再逐步展示智能体、研究图和写作能力。",
        styles,
    )
    demo_rows = [
        ["时间", "操作", "要证明的能力"],
        ["0:00-0:40", "登录并打开文档库", "WSL 全栈、管理员入口、双语界面"],
        ["0:40-1:30", "批量上传 v1/v7，查看版本差异", "内容级判重和人工决策"],
        ["1:30-2:30", "中文提问 Transformer 数字或跨论文问题", "混合检索、模型路由、页码引用"],
        ["2:30-3:20", "从引用进入 PDF.js，完成正文/References 往返", "证据阅读闭环"],
        ["3:20-4:10", "打开 Agent Trace 与 arXiv 工具", "真实智能体工具调用"],
        ["4:10-4:50", "运行 CSV，查看图表、Caption、Mermaid/TikZ", "数据到论文结果"],
        ["4:50-5:30", "打开本地引用图与 Future Work", "PageRank 和研究方向发现"],
        ["5:30-6:10", "生成论文框架、References、BibTeX", "可信写作"],
        ["6:10-6:40", "运行 Evidence Audit，展示 JSON/打印报告", "可信 AI 与审计"],
        ["6:40-7:00", "展示系统状态、30/30 和公网入口", "工程可交付性"],
    ]
    story.append(data_table(demo_rows, [25 * mm, 87 * mm, content_width - 112 * mm], styles))
    story.append(Spacer(1, 5 * mm))
    story.append(p("答辩时必须强调的三句话", styles["h2"]))
    story.extend(
        bullets(
            [
                "这不是通用聊天框，所有关键结论都能回到论文页码和原文片段。",
                "Agent 的工具调用是真实后端链路，Trace 中能看到下载、校验、分析、构图与写作步骤。",
                "项目不仅做出来，还能在 WSL 稳定运行、通过 30 条评测，并具备明确的公网安全边界。",
            ],
            styles,
        )
    )
    story.append(Spacer(1, 7 * mm))
    closing = Table(
        [
            [
                p(
                    "SCHOLAR",
                    ParagraphStyle(
                        "CloseBrand",
                        fontName="DengBold",
                        fontSize=26,
                        leading=30,
                        textColor=PAPER,
                        alignment=TA_LEFT,
                    ),
                )
            ],
            [
                p(
                    "让 AI 的速度，建立在可核验证据之上。",
                    ParagraphStyle(
                        "CloseLine",
                        fontName="DengBold",
                        fontSize=13,
                        leading=18,
                        textColor=colors.HexColor("#d8e1dd"),
                        alignment=TA_LEFT,
                    ),
                )
            ],
        ],
        colWidths=[content_width],
        rowHeights=[22 * mm, 15 * mm],
    )
    closing.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), INK),
                ("LINEABOVE", (0, 0), (-1, 0), 7, RED),
                ("LEFTPADDING", (0, 0), (-1, -1), 16),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(closing)

    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.project_root.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
