# 公网部署

## 边界

公网只暴露经过身份认证的 Next.js 应用：

```text
Internet -> HTTPS -> Cloudflare Tunnel -> http://localhost:3000
```

以下内部服务不得添加公网路由：

- Kotaemon / BFF: `7860`
- Citation Graph: `8001`
- VibeVoice: `8002`
- SQLite、上传目录、向量库和日志目录

Next.js 通过同源 BFF 访问内部服务，因此浏览器只需要 `443` 端口。

## 方案一：临时 Quick Tunnel

适合五分钟内的现场演示，不需要域名，但 URL 每次启动都会变化。

```powershell
npm run demo:start
winget install --id Cloudflare.cloudflared
powershell -ExecutionPolicy Bypass -File deploy/public/start-quick-tunnel.ps1
```

终端会输出类似下面的地址：

```text
https://<random-words>.trycloudflare.com
```

注意事项：

- 当前 Windows 必须保持开机，WSL 和 Next.js 必须保持运行。
- 关闭 `cloudflared` 后地址立即失效。
- 不适合作为比赛长期固定入口。
- 不要将临时地址写入仓库或技术文档并声称长期有效。

## 方案二：正式命名隧道

适合提交前固定公网入口。需要 Cloudflare 账号和一个已托管在 Cloudflare
的域名。

1. 安装并登录：

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
```

2. 创建隧道并记录返回的 Tunnel ID：

```powershell
cloudflared tunnel create scholar-demo
```

3. 将
   [cloudflared-config.example.yml](../deploy/public/cloudflared-config.example.yml)
   复制为 `deploy/public/cloudflared-config.yml`，替换：

   - `credentials-file`
   - `tunnel`
   - `hostname`

4. 绑定 DNS：

```powershell
cloudflared tunnel route dns scholar-demo scholar.example.com
```

5. 启动：

```powershell
npm run demo:start
powershell -ExecutionPolicy Bypass -File deploy/public/start-named-tunnel.ps1
```

`cloudflared-config.yml` 和凭据 JSON 仅保存在本机，不进入 Git 和提交包。

## 公网加固清单

- 只发布 `3000`，使用 Cloudflare 的 HTTPS。
- 开启 Cloudflare Access，或至少启用应用自身的邀请制注册。
- 演示账号使用随机密码，提交前轮换一次。
- 不提供公开注册邀请码，不在登录页展示管理员账号。
- 不开放内部端口、WSL SSH、SQLite 或上传目录。
- 记录 `outputs/public/cloudflared-*.log`，但日志不得包含 API Key。
- 若怀疑密钥泄露，先在百炼控制台轮换，再更新 WSL 的 `.env`。

## 验收

```powershell
curl.exe -I https://scholar.example.com/login
curl.exe -I http://localhost:7860
curl.exe -I http://localhost:8001
curl.exe -I http://localhost:8002
```

预期：

- 第一个地址返回 `200` 或重定向到登录页。
- 后三个回环服务只在当前机器可访问，公网无对应路由。
- 未登录访问业务 API 返回 `401/403`。

## 现场保底方案

公网网络不稳定时，使用可信局域网：

```powershell
npm run demo:lan
```

Windows 浏览器访问 `http://localhost:3000`，考官设备访问
`http://<Windows-LAN-IP>:3000`。该模式不经过公网，适合作为答辩保底入口。
