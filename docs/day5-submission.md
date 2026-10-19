# Day 5 submission runbook

## Completed preparation

- The exposed Bailian API key was deleted from the Model Studio console.
- A new key was created and stored only in:
  - `/home/lh/race/kotaemon/.env`
  - `C:\Users\lenovo\Desktop\race\instructions\bailian-api-guide.md`
- The Kotaemon component database was updated to use the new key.
- Demo users, passwords, invite code, conversations, audits, jobs, and uploads
  were reset.
- The clean document library contains:
  - `attention.pdf`
  - `attention_scan_batch20.pdf`
  - `rag_2005.11401.pdf`
  - `dpr_2004.04906.pdf`
  - `react_2210.03629.pdf`
  - `self_rag_2310.11511.pdf`
  - `lost_in_middle_2307.03172.pdf`
- The previous demo database was backed up under
  `/home/lh/race/workbench/work/demo-backups/`.

## Demo access

- Local: `http://localhost:3000`
- LAN: `http://10.162.70.112:3000`
- New demo credentials are stored in:
  `/home/lh/race/workbench/data/demo-accounts.json`

Do not include this credentials file in the submission package.

## Final commands

```powershell
npm run demo:start
npm run demo:status
npm run demo:lan
npm run demo:verify
npm run demo:evaluate
```

After a Windows or WSL restart, run `npm run demo:lan` again because the WSL
address can change.

## Final rehearsal result

- `npm run demo:verify`: passed.
- `npm run demo:evaluate`: 30/30 passed.
- Retrieval, citation-page, numeric verification, and refusal rates: 100%.
- Average evaluation latency: 10.5 seconds.
- Real Edge login, Chinese RAG answer, inline citations, evidence cards, and PDF
  preview were verified.
- English answer narration was verified in Edge through the authenticated
  Next.js BFF. The response was `audio/wav` from VibeVoice Realtime.
- Chinese mode was verified to omit the narration control, matching the
  model's English-only constraint.
- The local browser authentication profile used for rehearsal was deleted.

## Demo flow

1. Log in as the administrator.
2. Open the research workspace and select `attention.pdf`.
3. On the document page, select `1706.03762v7.pdf` and
   `1706.03762v1.pdf` together and show the batch version-dedupe decision.
4. Ask a Chinese question and show streamed answer, citations, and evidence
   cards.
5. Open a PDF citation in the academic reader, show the title tree, jump from a
   body citation to References, then return through a cited-page link.
6. Show the synchronized English/Chinese panes and scroll either side.
7. Open Citation Graph, show the local-corpus PageRank graph, select a
   foundational paper and review the generated Future Work synthesis. Switch to
   the OpenAlex tab to build a graph for the Transformer DOI.
8. Open Evidence Audit and run a numeric or contradiction check.
9. Open Agent Trace and show planning, retrieval and synthesis steps. Run an
   arXiv download check, a CSV analysis with generated scripts, and a Writing
   run that outputs a framework, verified References and BibTeX.
10. Switch to English, generate a narrated answer, then switch back to Chinese.
11. Open System Status to show Next.js, Kotaemon, Citation Graph, VibeVoice, and
   the single index worker.

## Final deliverables

- `TEAM.md`: competition profile and team responsibility template.
- `docs/public-deployment.md`: Quick Tunnel, named tunnel and public security
  boundary.
- `outputs/Scholar-demo.mp4`: 1080p Chinese-narrated demo video, H.264/AAC.
- `outputs/Scholar-technical-document.pdf`: Chinese technical document with
  architecture, workflows, tests, limitations and defense script.

Generate the video and technical document with:

```powershell
npm run demo:video
npm run docs:technical
```

Regenerate them whenever the interface or evidence changes.

## Package contents

`npm run submission:package` creates a timestamped archive under
`outputs/submission`. It includes source, deployment scripts, tests, docs,
sample PDFs, screenshots, evaluation results, the final demo video and the
technical PDF.

The packaging script excludes secrets, databases, uploads, vector indexes,
virtual environments, dependencies, logs, and build output. It also rejects the
package if a Bailian API key pattern is found in a text file.

The package and checksum use the timestamped names
`scholar-final-submission-<timestamp>.zip` and
`scholar-final-submission-<timestamp>.sha256`.
