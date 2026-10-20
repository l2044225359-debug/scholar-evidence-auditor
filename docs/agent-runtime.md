# Dynamic Planner、Function Calling 与 Replan

聊天请求不再只播放预置的“规划/检索”动画。Kotaemon BFF 会先调用
`qwen3.8-flash` 进行真实工具选择，再把每次工具结果作为 `tool` 消息回灌给
模型，由模型决定继续调用工具还是结束规划。

## 执行流程

1. 根据用户问题、最近对话和当前文档范围生成 Planner 上下文。
2. 通过 OpenAI 兼容接口提交标准 JSON Schema，模型返回原生
   `tool_calls`。
3. BFF 执行工具，并将成功结果或异常写入同一条 Agent 消息链。
4. 模型读取 observation 后进行下一轮规划。
5. 工具失败、参数错误或重复调用会触发 Replan。
6. Planner 自然结束或工具预算耗尽后，将全部 observation 注入最终 RAG
   system context；最终答案仍由 Kotaemon 混合检索和页码引用生成。

## 可用工具

| 工具 | 作用 |
| --- | --- |
| `inspect_knowledge_base` | 文档、页数、Chunk、OCR、引用边和索引健康度 |
| `retrieve_evidence` | 调用真实 Kotaemon hybrid retrieval，返回页码证据 |
| `inspect_citation_graph` | 检查本地论文引用边与目标论文 |
| `inspect_future_work` | 提取本地论文的 Future Work/开放问题 |
| `lookup_arxiv` | 查询真实 arXiv 标题、作者、年份和摘要 |
| `compare_documents` | 比较两篇论文或两个版本的内容差异 |

Planner 最多并行接受 6 个工具调用，默认最多进行 4 轮决策。错误会被记录，
不会中断最终回答；同一工具参数重复出现时会被阻止并要求 Replan。

## SSE Trace

前端 Agent Trace 读取以下阶段：

- `plan`：模型正在选择工具或给出执行摘要
- `call`：某个 Function Calling 正在执行
- `observe`：工具结果或错误已经回灌给模型
- `replan`：模型因失败原因进入下一轮规划
- `complete`：工具预算结束，进入最终综合

最终 `done` 事件包含 `agent.iterations`、`agent.tool_call_count`、
`agent.replan_count`、`agent.stop_reason` 和工具状态摘要。

## 配置

```dotenv
AGENT_PLANNER_MODEL=qwen3.8-flash
AGENT_PLANNER_MAX_STEPS=4
AGENT_PLANNER_TIMEOUT=90
```

Planner 和最终回答使用不同的思考预算：Planner 只选择下一步，最终
`qwen3.8-flash`/`qwen3.8-max` 路由仍由现有模型路由决定。

## 验证

```bash
cd /home/lh/race/kotaemon
.venv/bin/python libs/ktem/ktem_tests/test_agent_runtime.py -v
```

真实 SSE 冒烟脚本位于被忽略的 `work/` 目录，分别验证自然收束和故意工具
失败后的 Replan。测试请求会消耗百炼额度。

## 安全与可靠性

- 工具输出始终标记为不可信证据，禁止其中的内容覆盖系统指令。
- 只允许预定义工具和参数 Schema，不执行模型生成的任意代码。
- arXiv 查询只接受合法标识符；CSV 等独立工具仍走各自的上传校验。
- Planner 异常时自动降级到原有 RAG，不阻断基础问答。
