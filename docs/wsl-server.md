# WSL server runtime

The production-style local demo runs every server process inside WSL:

- Next.js and the index worker run in `/home/lh/race/workbench`.
- Kotaemon and its BFF run in `/home/lh/race/kotaemon`.
- Citation Graph runs in `/home/lh/race/citation_graph`.
- VibeVoice Realtime runs in `/home/lh/race/vibevoice` on `127.0.0.1:8002`.
- Windows is only the browser client and the source-code working copy.

The WSL runtime uses its own Linux Node.js installation and `node_modules`.
Do not point the WSL process at the Windows `node_modules`.

## Start and stop

From the Windows repository:

```powershell
npm run demo:start
npm run demo:status
npm run demo:stop
```

`demo:start` syncs source code without overwriting WSL runtime data, rebuilds
Next.js and starts the hidden WSL launcher. It waits for VibeVoice CUDA model
readiness before declaring the stack healthy. Open `http://localhost:3000` in
Windows.

VibeVoice keeps its model cache and independent virtual environment outside the
repository. The managed launcher binds it to loopback only; browser audio is
served through the authenticated Next.js BFF.

## Sync source changes

```powershell
npm run demo:sync
```

The sync intentionally excludes `data/`, `.env`, `.env.local`, `node_modules`,
`.next`, `work/`, and logs. WSL keeps the live database, uploads, secrets,
dependencies and build output.

## LAN access

Run an Administrator PowerShell after the server is healthy:

```powershell
npm run demo:lan
```

This creates the Windows firewall rule and refreshes the Windows-to-WSL TCP
proxy for port 3000. Run it again after a Windows or WSL restart because the WSL
address may change.

Local browser: `http://localhost:3000`

LAN browser: `http://<Windows-LAN-IP>:3000`
