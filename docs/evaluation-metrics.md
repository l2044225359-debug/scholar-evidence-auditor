# 基线与盲测指标

评测集现在分为：

- 开发集：C01-C30，用于功能迭代和问题定位
- 盲测集：C31-C40，作为锁定 holdout 单独报告

盲测协议为 `blind-v1`。生成回答时只向系统发送 `question`、`fileNames`、
`kind` 和 `category`；`expectedKeywordGroups`、`expectedNumbers` 与
`expectInsufficient` 只在回答生成完成后用于评分。

评估结果同时记录题集与评分规则的 SHA-256，用于确认盲测题集和 rubric
没有被替换。系统状态页 `/system` 只展示聚合指标和短哈希，不返回参考答案
或逐题评分规则。

## 基线

`fixed-rag-no-agent` 使用与正式系统相同的 hybrid retrieval、引用和模型，
但关闭动态 Planner。聊天题走固定 RAG；审计题仍走审计端点，确保比较的是
同一任务的 Planner 开关，而不是不同任务流程。

`retrieval-only-evidence` 不是答案质量基线，只衡量是否检索到页码证据。

报告字段包括：

- 系统与基线通过率
- 绝对百分点增益和相对增益
- 系统胜、基线胜、平局数量
- 页码引用通过率
- 平均延迟与 P95 延迟
- 延迟差
- 分类通过率
- 关键词、数字和拒答覆盖度

## 当前盲测结果

2026-10-20 执行的 `blind-v1`：

- 系统：10/10，100%
- 固定 RAG 基线：10/10，100%
- 胜/负/平：0/0/10
- 绝对通过率增益：0 个百分点
- 检索命中率、页码引用率、数字覆盖率和拒答率：均为 100%
- 系统平均延迟：33.97 秒
- 基线平均延迟：8.18 秒
- Planner 平均延迟代价：25.79 秒
- 系统 P95 延迟：118.61 秒

这组结果显示动态 Planner 在当前 10 条事实型 holdout 上没有提升准确率，
但保留了完全一致的正确率和引用质量。它更适合展示工具选择、错误恢复和
执行可观测性，而不是宣称在所有简单事实题上优于固定 RAG。

## 命令

```powershell
npm run test:metrics
npm run demo:evaluate:blind
npm run demo:evaluate
```

`npm run demo:evaluate` 会运行全部 40 条；默认只对盲测 10 条额外运行固定
RAG 基线。

可用环境变量：

```dotenv
EVAL_SPLIT=dev|blind|all
EVAL_BASELINE=off|blind|all
EVAL_MIN_BLIND_PASS_RATE=0.8
EVAL_LIMIT=0
EVAL_IDS=C31,C32
```

结果写入 `tests/evaluation/results.json`。阈值失败时脚本返回非零退出码。
