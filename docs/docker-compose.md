# Docker Compose 部署

根目录 `compose.yaml` 提供一套可移植容器栈：

- `init`：初始化 SQLite、演示账号和邀请码，执行完成后退出
- `kotaemon`：RAG、Agent Runtime、PDF 索引与聊天 BFF
- `citation-graph`：OpenAlex/Crossref 与 NetworkX 引用图谱
- `web`：Next.js 学术工作台，也是唯一默认对外入口
- `index-worker`：消费 PDF/审计任务的单工作线程
- `vibevoice`：可选英文语音服务，使用 `voice` profile

## 前置条件

- Docker Desktop 或 Docker Engine
- Docker Compose v2
- 默认模型栈建议至少 12 GB 可用内存
- VibeVoice profile 需要支持 CUDA 的 NVIDIA GPU 与容器运行时

## 首次启动

```powershell
Copy-Item .env.example .env
```

编辑根 `.env`，至少修改：

```dotenv
AUTH_SECRET=
CHAT_BFF_TOKEN=
KOTAEMON_ADMIN_PASSWORD=
OPENAI_API_BASE=
OPENAI_API_KEY=
```

生成随机密钥：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

检查 Compose 配置并启动：

```powershell
npm run docker:config
npm run docker:up
```

入口为 `http://localhost:3000`。Kotaemon、Citation Graph 和 VibeVoice
默认只绑定到 `127.0.0.1`，不要直接把内部端口暴露到公网。

## 演示账号

`init` 只会在账号不存在时创建账号。首次启动后读取：

```powershell
docker compose exec web cat /data/demo-accounts.json
```

重复启动不会重置已有密码。需要重建演示数据时：

```powershell
docker compose run --rm init node scripts/reset-demo.mjs
```

轮换邀请码：

```powershell
docker compose run --rm init node scripts/rotate-invite.mjs
```

## 持久化

默认使用命名卷：

- `scholar-data`：SQLite、上传文件、账号文件
- `kotaemon-data`：Kotaemon SQLite、向量库、Docling 和 HF 缓存
- `citation-cache` / `citation-exports`
- `vibevoice-models` / `vibevoice-outputs`

也可以改用显式目录。Windows 示例：

```dotenv
SCHOLAR_DATA_VOLUME=D:/Scholar/data
KOTAEMON_DATA_VOLUME=D:/Scholar/kotaemon
```

Linux bind mount 应设置 `SCHOLAR_UID` 和 `SCHOLAR_GID`，使 Web 与 Worker
可以写入共享目录。

## 可选语音服务

```powershell
docker compose --profile voice up --build -d
```

首次启动会克隆上游 VibeVoice 并下载模型。可通过以下变量固定版本与镜像：

```dotenv
VIBEVOICE_BASE_IMAGE=pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
VIBEVOICE_REPOSITORY=https://github.com/microsoft/VibeVoice.git
VIBEVOICE_REF=main
```

没有 GPU 时不要启用该 profile。Web 的默认核心功能不依赖它。

## 常用命令

```powershell
npm run docker:logs
npm run docker:down
docker compose ps
docker compose exec web node scripts/rotate-invite.mjs
```

`docker compose down` 保留数据卷。只有显式执行
`docker compose down -v` 才会删除持久化数据。
