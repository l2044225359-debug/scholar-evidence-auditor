# 表格、公式与图表结构化证据

Docling 解析结果现在会为以下对象生成结构化证据：

- `table`
- `formula`
- `figure`

## Bbox 契约

所有 bbox 统一为：

```json
{
  "bbox": [0.12, 0.24, 0.88, 0.61],
  "bbox_format": "normalized_top_left_xyxy",
  "page": 4,
  "page_size": { "width": 612, "height": 792 }
}
```

坐标顺序为 `x0, y0, x1, y1`，原点位于页面左上角，范围为 `0..1`。
Docling 的 `BOTTOMLEFT` 坐标会在写入 Document metadata 前自动转换。

## Document metadata

每个结构化 chunk 同时包含扁平索引字段和完整证据对象：

```json
{
  "evidence_type": "table",
  "page_label": 4,
  "bbox": [0.12, 0.24, 0.88, 0.61],
  "bbox_format": "normalized_top_left_xyxy",
  "structured_evidence": {
    "schema_version": "evidence-v1",
    "kind": "table",
    "page": 4,
    "bbox": [0.12, 0.24, 0.88, 0.61],
    "bbox_format": "normalized_top_left_xyxy",
    "page_size": { "width": 612, "height": 792 },
    "content": "| model | BLEU | ...",
    "caption": "Table 2",
    "source": "attention.pdf"
  }
}
```

公式 chunk 的 `content` 保留 Docling 提取的 LaTeX/公式原文，图表 chunk
保留 caption，表格 chunk 保留 Markdown 表格。

## 引用链路

1. Evidence HTML 内嵌 `structured-evidence` JSON。
2. Kotaemon BFF 解析引用时恢复 `evidence_type`、`bbox`、
   `structured_evidence` 和 `caption`。
3. `/api/chat`、审计报告和 Agent 工具 observation 都会携带这些字段。
4. 前端证据卡显示证据类型和 bbox。
5. 点击预览会在本地 PDF.js 阅读器中叠加对应的归一化 bbox 区域。

## 已索引文档

此功能依赖 chunk metadata。功能上线前已经索引的 PDF 需要重新上传并选择
替换，或运行批量重索引流程重新解析，以便补齐 bbox 和结构化字段。

```powershell
npm run demo:reindex:structured
```

脚本会先重启 WSL 服务加载新解析器，然后逐个删除旧索引、重新上传
`work/` 中同名且大小一致的 PDF，并在完成后刷新知识库总览。新旧文档 ID
映射保存到被忽略的 `work/structured-reindex.json`。

## 验证

```powershell
C:\Users\lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  services\kotaemon\libs\kotaemon\tests\test_structured_evidence.py -v
```
