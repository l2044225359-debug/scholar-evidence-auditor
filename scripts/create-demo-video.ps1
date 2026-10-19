param(
  [string]$VoiceName = "Microsoft Huihui Desktop",
  [string]$Distro = "Ubuntu-24.04",
  [string]$Python = "C:\Users\lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",
  [switch]$SkipNarration
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $repoRoot "outputs/demo-video"
$slideRoot = Join-Path $assetRoot "slides"
$rawAudioRoot = Join-Path $assetRoot "narration-raw"
$audioRoot = Join-Path $assetRoot "narration"
$output = Join-Path $repoRoot "outputs/Scholar-demo.mp4"
$scenesJson = Join-Path $assetRoot "scenes.json"

if (-not (Test-Path $Python)) {
  throw "Bundled Python not found: $Python"
}
foreach ($path in @($assetRoot, $slideRoot, $rawAudioRoot, $audioRoot)) {
  New-Item -ItemType Directory -Path $path -Force | Out-Null
}

$scenes = @(
  [ordered]@{
    number = "01"
    kicker = "赛题定位 / EVIDENCE-FIRST AI"
    title = "Scholar：让每个研究结论都能回到证据"
    image = "design_login.png"
    bullets = @(
      "不只是论文问答，而是摄入、检索、核验、写作的完整闭环",
      "面向评委的本地与公网双入口，核心能力均为真实服务",
      "模型、引用、页码、审计结果和工具轨迹全部可检查"
    )
    narration = "大家好，这里是 Scholar，一个证据优先的学术研究智能体工作台。它解决的不是普通论文聊天，而是研究过程中最难追溯的一步：一个结论究竟来自哪篇论文、哪一页、哪段证据，是否经得起数字核验。整个系统把 PDF 摄入、混合检索、带页码引用的回答、证据审计、引用网络和写作辅助连成闭环。下面的演示全部来自真实运行界面。"
  }
  [ordered]@{
    number = "02"
    kicker = "文档库 / INGESTION"
    title = "从 PDF 到可检索知识库"
    image = "design_documents_final.png"
    bullets = @(
      "管理员批量上传，单工作线程按队列稳定解析",
      "Docling 解析版式、表格与正文结构",
      "扫描页自动调用 qwen3.5-ocr，随后统一向量化"
    )
    narration = "演示从文档库开始。管理员可以批量上传 PDF，系统使用单一工作线程和 SQLite 队列顺序处理，避免多个重型解析任务互相争抢。普通页面交给 Docling 提取版式、正文、表格和图像信息；遇到扫描页或低文本页时，再调用 qwen3.5-ocr。解析完成后，文档进入统一向量库，并显示解析状态、页数和队列进度。"
  }
  [ordered]@{
    number = "03"
    kicker = "版本治理 / SEMANTIC DEDUPE"
    title = "识别 v1/v7，而不是重复入库"
    image = "day6_dedupe_v1_v7.png"
    bullets = @(
      "SHA-256、arXiv 身份、正文 shingle 与标题摘要联合判断",
      "展示新增、删除和变化比例，不靠文件名猜测",
      "支持保留现有、替换、双版本并存与取消批次"
    )
    narration = "论文版本治理是本项目的一个重要差异点。管理员同时上传同一篇论文的 v1 和 v7 时，系统不会按文件名机械判重，而是依次比较文件哈希、arXiv 标识、正文片段重合度和标题摘要相似度。界面会给出两个版本的新增与删除证据、变化比例和推荐动作，管理员可以选择保留当前版本、替换、两个版本并存，或者取消剩余批次。"
  }
  [ordered]@{
    number = "04"
    kicker = "RAG / MODEL ROUTING"
    title = "混合检索、重排与双模型路由"
    image = "day5_chat_zh.png"
    bullets = @(
      "qwen3.7-text-embedding 负责语义向量",
      "qwen3-rerank 提升证据相关性并支持降级",
      "flash 处理常规任务，max 处理复杂多文档推理"
    )
    narration = "在问答工作区，用户可以选择单篇论文或整个文档库。检索阶段使用 qwen3.7-text-embedding 生成语义向量，再通过 qwen3-rerank 对候选证据重排。常规问题路由到 qwen3.8-flash，复杂跨论文推理切换到 qwen3.8-max。回答以流式方式呈现，每一个关键结论都带页码引用，右侧证据栏同步展示原文、来源论文和检索信息。"
  }
  [ordered]@{
    number = "05"
    kicker = "阅读器 / PDF.JS"
    title = "引用不是装饰，而是可双向跳转的证据链"
    image = "day6_pdf_reader.png"
    bullets = @(
      "本地 PDF.js，无 CDN 依赖，支持标题树与懒加载",
      "正文数字引用直达 References，引用条目可回到正文",
      "中英页级对照与同步滚动，引用标记保持可点击"
    )
    narration = "点击答案中的引用，会直接进入本地 PDF.js 阅读器并定位到证据页。左侧保留原始论文版式，支持标题树、缩放和懒加载；系统解析正文中的数字引用和 References。点击正文里的编号可以跳到对应文献，再点击被引页码又能返回正文。右侧是中英页级对照，两侧按相同阅读比例同步滚动，数字引用、公式和 URL 在翻译中保持可追踪。"
  }
  [ordered]@{
    number = "06"
    kicker = "智能体 / AGENT TRACE"
    title = "看见智能体如何规划、检索和调用工具"
    image = "day6_agent_trace.png"
    bullets = @(
      "规划、检索、综合与完成事件按顺序展开",
      " arXiv 工具执行元数据获取、PDF 校验和语义判重",
      "每一步记录耗时与结果，而不是只有一个黑盒答案"
    )
    narration = "Agent Trace 面板把智能体的运行过程公开出来。用户可以看到任务规划、模型路由、混合检索、证据综合和最终完成的顺序。arXiv 工具不是模拟按钮，它会先解析标识、获取官方元数据、下载 PDF、校验文件签名，再与现有文档库做语义判重，只有确认不重复才进入索引。每一步都有耗时和结果，方便评委判断系统是否真实工作。"
  }
  [ordered]@{
    number = "07"
    kicker = "分析工具 / DATA TO FIGURE"
    title = "从 CSV 到图表、图注和可复现脚本"
    image = "day6_agent_csv.png"
    bullets = @(
      "pandas 完成字段画像、缺失值与描述统计",
      "Matplotlib 生成图表，qwen3.8-flash 生成学术图注",
      "同步输出 Mermaid xychart-beta 与 TikZ/PGFPlots"
    )
    narration = "数据分析工具把一个 CSV 变成可进入论文的结果。后端先用 pandas 完成字段类型、缺失值、统计量和分组分析，再由 Matplotlib 生成与数据结构匹配的图表。qwen3.8-flash 根据计算结果生成有依据的 Figure Caption，而不是凭空描述。系统同时输出 Mermaid 与 TikZ/PGFPlots 脚本，坐标和渲染图保持一致，可以直接复制到 Markdown 或 Overleaf。"
  }
  [ordered]@{
    number = "08"
    kicker = "引用网络 / NETWORKX"
    title = "从 20 篇本地论文中发现基石与未来方向"
    image = "day6_local_citation_graph.png"
    bullets = @(
      "本地 References 匹配构建有向引用图",
      "PageRank、中心性、密度与连通分量量化分析",
      "qwen3.8-max 汇总 Future Work，生成研究议程"
    )
    narration = "引用图页面默认使用本地文档库，最多处理二十篇论文。系统从 References 和 Future Work 段落中抽取本地引用关系，构建 NetworkX 有向图，计算 PageRank、出入度、中心性、密度和弱连通分量。界面会突出基石论文，并把多篇论文的未来工作方向交给 qwen3.8-max 归纳，区分渐进扩展和更大型的研究机会，最后形成有优先级的后续实验议程。"
  }
  [ordered]@{
    number = "09"
    kicker = "科研写作 / VERIFIED REFERENCES"
    title = "论文框架、受限引用与 BibTeX 一次完成"
    image = "day6_writing_framework.png"
    bullets = @(
      "从本地论文抽取标题、摘要与 arXiv 身份",
      "OpenAlex/Crossref 补充作者、年份和 DOI",
      "禁止模型创造未验证引用，输出 References 与 BibTeX"
    )
    narration = "写作工具面向研究者的下一步动作。系统先从本地论文提取标题、摘要和 arXiv 身份，再通过 OpenAlex 或 Crossref 补充作者、年份和 DOI，为每篇候选文献分配受限引用键。qwen3.8-max 生成从 Abstract 到 Conclusion 的论文框架，随后系统会删除任何不在已验证列表中的引用标记，并追加确定性 References 和 BibTeX，降低模型伪造文献的风险。"
  }
  [ordered]@{
    number = "10"
    kicker = "工程交付 / VERIFIED SYSTEM"
    title = "可运行、可验证，也可安全公网演示"
    image = "design_system_final2.png"
    bullets = @(
      "全部服务运行于 WSL，Windows 仅作为浏览器客户端",
      "30/30 评测通过，检索、引用页、数字核验与拒答均为 100%",
      "公网只暴露经过认证的 Next.js，内部端口保持回环"
    )
    narration = "最后看工程状态。Next.js、Kotaemon BFF、引用图、VibeVoice 和索引工作线程全部运行在 WSL，Windows 只作为浏览器客户端。当前三十条评测全部通过，检索命中、引用页、数字核验和拒答率均为百分之百。公网部署只开放经过身份认证的 Next.js，Kotaemon、引用图和语音服务始终留在回环地址。Scholar 的目标，是让 AI 的速度建立在可核验证据之上。谢谢观看。"
  }
)

$scenes | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $scenesJson -Encoding UTF8

$prepareArgs = @(
  (Join-Path $PSScriptRoot "prepare-demo-video-assets.py"),
  "--project-root", $repoRoot,
  "--assets", $assetRoot
)
if ($SkipNarration) {
  $prepareArgs += "--skip-narration"
}
& $Python @prepareArgs
if ($LASTEXITCODE -ne 0) {
  throw "Slide preparation failed."
}

if (-not $SkipNarration) {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Name -eq $VoiceName } |
    Select-Object -First 1
  if (-not $voice) {
    $available = $synth.GetInstalledVoices() |
      ForEach-Object { $_.VoiceInfo.Name }
    throw "Voice '$VoiceName' not found. Available: $($available -join ', ')"
  }

  $synth.SelectVoice($VoiceName)
  $synth.Rate = -1
  $synth.Volume = 100
  foreach ($scene in $scenes) {
    $wave = Join-Path $rawAudioRoot ("scene-{0}.wav" -f $scene.number)
    if (Test-Path $wave) {
      Remove-Item -LiteralPath $wave -Force
    }
    Write-Host "Synthesizing scene $($scene.number): $($scene.title)"
    $synth.SetOutputToWaveFile($wave)
    $synth.Speak($scene.narration)
    $synth.SetOutputToNull()
  }
  $synth.Dispose()
}

& $Python (Join-Path $PSScriptRoot "prepare-demo-video-assets.py") `
  --project-root $repoRoot `
  --assets $assetRoot `
  --finalize-audio
if ($LASTEXITCODE -ne 0) {
  throw "Audio preparation failed."
}

function ConvertTo-WslPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $drive = $resolved.Substring(0, 1).ToLowerInvariant()
  $tail = $resolved.Substring(2).Replace("\", "/")
  return "/mnt/$drive$tail"
}

$wslAssetRoot = ConvertTo-WslPath $assetRoot
$wslOutput = ConvertTo-WslPath (Split-Path -Parent $output)
$segmentDir = Join-Path $assetRoot "segments"
New-Item -ItemType Directory -Path $segmentDir -Force | Out-Null
$durations = Get-Content (Join-Path $assetRoot "durations.json") -Raw | ConvertFrom-Json

foreach ($scene in $scenes) {
  $duration = $durations.PSObject.Properties[$scene.number].Value
  $slide = "$wslAssetRoot/slides/scene-$($scene.number).png"
  $segment = "$wslAssetRoot/segments/scene-$($scene.number).mp4"
  $durationLabel = "Encoding scene $($scene.number) ({0:N1}s) ..." -f $duration
  Write-Host $durationLabel
  $segmentArgs = @(
    "-d", $Distro, "--", "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", "30", "-i", $slide,
    "-t", ([string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:F3}", $duration)),
    "-vf", "format=yuv420p", "-c:v", "libx264",
    "-preset", "veryfast", "-crf", "23", "-r", "30", "-an",
    $segment
  )
  & wsl.exe @segmentArgs
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed while encoding scene $($scene.number)."
  }
}

Write-Host "Combining video segments and narration ..." -ForegroundColor Cyan
$combineArgs = @(
  "-d", $Distro, "--", "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", "$wslAssetRoot/segments.txt",
  "-f", "concat", "-safe", "0", "-i", "$wslAssetRoot/audio.txt",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart", "-shortest",
  "$wslOutput/Scholar-demo.mp4"
)
& wsl.exe @combineArgs
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg encoding failed."
}

Write-Host "Demo video: $output" -ForegroundColor Green
Write-Host "Size: $([Math]::Round((Get-Item $output).Length / 1MB, 2)) MB"
