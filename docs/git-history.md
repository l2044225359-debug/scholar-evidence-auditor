# Git 开发过程

本仓库使用 Git 记录 Scholar 从 MVP 到最终比赛版本的完整开发过程。主要阶段使用
annotated tag 标记，标签说明可通过 `git show <tag>` 查看。

## 阶段标签

| 标签 | 阶段 | 主要内容 |
| --- | --- | --- |
| `v0.1.0` | MVP 基础 | Next.js 单仓库、邀请制账号、PDF 索引队列、证据审计与打印报告 |
| `v0.2.0` | WSL 与双语工作台 | WSL 服务端、鉴权边界、档案式双语界面、后台任务单实例 |
| `v0.3.0` | 可信 RAG 与比赛基线 | 混合检索、Flash/Max 路由、PDF.js、Agent 工具、本地引用图、部署与提交文档 |
| `v0.4.0` | 知识库总览 | 文档、页数、Chunk、OCR、引用边和索引健康度 |
| `v0.5.0` | 知识集合 | Transformer、RAG、Agent Collection 与问答检索范围 |
| `v0.6.0` | 论文实体抽取 | Paper、Author、Topic、Method、Dataset、Metric、Claim |
| `v0.7.0` | 异构 NetworkX 图 | 引用边与实体关系合并到同一张有向图，PageRank 隔离在论文子图 |
| `v0.8.0` | 证据覆盖度与可滚动检查器 | 回答证据充分度、页码锚定、引用对齐、右侧独立滚动 |
| `v1.0.0` | 比赛提交版 | 最终文档、演示视频、Git bundle、提交包和验收证据 |

## 提交顺序

| 提交 | 日期 | 说明 |
| --- | --- | --- |
| `b4cbd1d` | 2026-10-18 | 初始化 scientific evidence auditor monorepo |
| `8927834` | 2026-10-18 | 邀请码轮换与账号管理 |
| `91e3e13` | 2026-10-18 | PDF 索引队列与文档管理 |
| `8c3b193` | 2026-10-18 | 证据审计队列与可打印报告 |
| `847a96b` | 2026-10-19 | WSL 运行栈与安全边界 |
| `5868680` | 2026-10-19 | 双语研究工作台与设计系统 |
| `4a6dd3e` | 2026-10-19 | 文档摄入、模型路由、审计服务 |
| `508b6f8` | 2026-10-19 | PDF 阅读器、Agent 工具、本地引用图 |
| `fcc1785` | 2026-10-19 | 公网部署、团队说明、视频与技术文档生成器 |
| `3cdad42` | 2026-10-19 | 实时知识库总览 |
| `13690c3` | 2026-10-19 | 知识集合与检索范围 |
| `e0eb27b` | 2026-10-19 | RAG Collection 纳入 Lost in the Middle |
| `90bebc2` | 2026-10-19 | 可追溯论文实体抽取 |
| `148d5fc` | 2026-10-19 | NetworkX 异构实体图 |
| `adb6c12` | 2026-10-19 | 修复图谱节点视口裁切 |
| `3406bf6` | 2026-10-19 | 证据覆盖度与右侧检查器展开 |
| `3ce69ed` | 2026-10-19 | 提交包加入覆盖度证据 |
| `d7255e3` | 2026-10-19 | 右侧检查器独立滚动 |
| `47e4784` | 2026-10-19 | 发布 Git 开发历史与 bundle 构建脚本 |
| `c7e4fc1` | 2026-10-19 | 使用 .NET 计算 bundle SHA-256 |

## 常用命令

```powershell
git log --graph --decorate --oneline --all
git tag -n99
git show v0.3.0
git show v1.0.0
```

## 从 bundle 恢复

```powershell
git clone outputs/Scholar-git-history.bundle Scholar-history
cd Scholar-history
git tag -n99
```

`Scholar-git-history.bundle` 包含全部提交、分支和 annotated tag，不包含未提交的
运行数据、密钥、上传文件或模型缓存。
