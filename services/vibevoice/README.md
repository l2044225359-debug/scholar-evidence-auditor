# VibeVoice Realtime TTS

Optional English narration service for Scholar, powered by
`microsoft/VibeVoice-Realtime-0.5B`.

Upstream: <https://github.com/microsoft/VibeVoice>  
Copyright (c) 2025 Microsoft, licensed under the MIT License. A copy is
included in `services/vibevoice/LICENSE`.

Upstream source is installed at `/home/lh/race/vibevoice` in WSL. The service
uses the independent virtual environment in that directory so its pinned
`transformers` and CUDA dependencies cannot affect Kotaemon.

## Runtime

- Endpoint: `http://127.0.0.1:8002`
- Health: `GET /health`
- Synthesis: `POST /api/tts`
- Model: `microsoft/VibeVoice-Realtime-0.5B`
- License: MIT
- Host binding: loopback only (`127.0.0.1:8002`)

## Limitation

The available Realtime model is intended for English speech. Microsoft removed
and disabled the older long-form TTS model with broader Chinese support.
Scholar only exposes narration for English answers; Chinese narration is
explicitly rejected rather than producing unpredictable speech.

## Start

From the repository root on Windows:

```powershell
npm run demo:start
npm run demo:status
```

The service can also be launched directly inside WSL:

```bash
/home/lh/race/workbench/services/vibevoice/run_vibevoice.sh
```

The first startup downloads and loads the model into the dedicated CUDA
environment. The managed stack waits up to three minutes for `/health` to report
`"ready": true`. Do not copy the model cache or `.venv` into the submission
package.

## Host requirements

- Ubuntu 24.04 under WSL
- A CUDA-capable GPU visible to WSL
- `build-essential` and `python3-dev`
- VibeVoice source and model cache at `/home/lh/race/vibevoice`
- Independent virtual environment at `/home/lh/race/vibevoice/.venv`

The tested runtime uses Python 3.12, CUDA-enabled Torch `2.14.1+cu130`, and the
upstream package installed in editable mode. Runtime logs are written to
`/home/lh/race/vibevoice/vibevoice.log`.
