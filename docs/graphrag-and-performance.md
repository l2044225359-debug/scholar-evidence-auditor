# GraphRAG 检索与性能测试

## GraphRAG 检索链路

实体图和引用图现在不是只用于可视化，而是参与最终 RAG 回答前的检索：

1. 从当前文档范围读取论文元数据、References 匹配边和论文实体图。
2. 构建异构图：
   - Paper
   - Author
   - Topic
   - Method
   - Dataset
   - Metric
   - Claim
3. 对问题做词项匹配，定位 Paper/Entity 种子节点。
4. 沿实体关系边和 `cites` 引用边进行加权多跳传播。
5. 聚合命中的论文、实体关系、证据句和引用边。
6. 将 GraphRAG 上下文注入最终 RAG system prompt。
7. 最终事实仍必须由普通 RAG 的页码引用支撑。

图索引按“用户 + 文档 ID/文件哈希 + 语言”缓存 1 小时。缓存构建使用互斥锁，
避免并发请求重复执行实体抽取。

## 聊天执行档位

优化前，一条简单的短事实问题仍会执行完整 Planner 和多轮工具链。实测
`Transformer 的核心机制是什么？` 的端到端耗时为 145.4 秒。

同一条问题关闭 Planner、直接执行混合检索与回答的对比耗时为 17.6 秒，
约快 8.3 倍。新逻辑会自动让短事实题走这条直接 RAG 路径。

现在聊天请求自动分为三档：

| 档位 | 触发条件 | 执行方式 |
| --- | --- | --- |
| Fast | 短事实题、显式 Fast、单文档 | 跳过 Planner 和 GraphRAG，直接 RAG |
| Standard | 比较、关系、较长问题 | 最多 2 轮轻量 Planner，不构建 GraphRAG |
| Deep | 综述、审计、跨论文、明确图谱问题 | 最多 4 轮 Planner + GraphRAG |

Standard 档位不会向 Planner 提供 `retrieve_evidence` 工具，避免 Planner 内部
完整 RAG 与最终 RAG 重复执行。只有明确图谱/引用图问题或深度任务才执行实体
与引用图检索。

## 配置

```dotenv
GRAPHRAG_ENABLED=true
GRAPHRAG_TOP_K=8
GRAPHRAG_MAX_HOPS=2
```

专用检索接口：

```text
POST /api/bff/graphrag/retrieve
```

请求体：

```json
{
  "question": "RAG 与 DPR 是什么关系？",
  "file_ids": null,
  "language": "zh",
  "top_k": 8,
  "max_hops": 2,
  "refresh": false
}
```

聊天 Trace 会出现“实体与引用图检索”，最终 `done.graphrag` 返回命中的论文、
图规模、构图缓存状态和检索耗时。

## 大图谱结果

测试环境：Windows 本地 Python，纯 CPU，单进程。

| 指标 | 结果 |
| --- | ---: |
| 论文节点 | 5,000 |
| 总节点 | 5,640 |
| 总边 | 48,332 |
| 构图时间 | 1.474 s |
| 峰值内存 | 52.36 MB |
| 并发请求 | 96 |
| 并发度 | 12 |
| 吞吐 | 34.5 req/s |
| P50 | 165.23 ms |
| P95 | 682.46 ms |
| P99 | 934.33 ms |

复测：

```powershell
npm run perf:graph
```

## 长 PDF 结果

240 页离线解析：

- 文件大小：0.22 MB
- 提取文本：1,147,859 字符
- 模拟 chunk：160
- PDF 生成：214.04 ms
- pypdf 文本解析：930.33 ms

60 页真实入库：

- Docling 解析、向量化和索引：35.209 s
- 索引 tokens：51,069
- 测试文件完成后自动删除
- 原知识库仍保持 7 篇文档

复测：

```powershell
npm run perf:long-pdf
npm run perf:long-pdf:index
```

## HTTP 并发

新 BFF 代码加载后可测试 GraphRAG 专用接口：

```powershell
npm run perf:concurrency
```

脚本包含一次冷/热缓存预热，然后测量并发吞吐、P50/P95/P99、返回论文数和构图
缓存状态。建议门槛：

- 50k 边图谱 P95 < 1 秒
- HTTP GraphRAG P95 < 2 秒（不含首次实体 LLM 抽取）
- 60 页 PDF 完整入库 < 60 秒
- 并发错误率 0

## 产物

- `work/performance-graphrag-5000.json`
- `work/performance-long-pdf.json`
- `work/performance-long-pdf-240.json`
- `work/performance-graphrag-http.json`（服务加载后生成）
