# Scholar Workspace

Next.js App Router frontend for the local research stack.

## Services

- Next.js workspace: `http://localhost:3000`
- Kotaemon chat BFF: `http://localhost:7860/api/bff`
- Citation graph: `http://localhost:8001`

## Language

The workspace opens in Chinese by default. Use the `中文 / EN` control in the
sidebar to switch languages. The selection is stored in `localStorage`.

## Local configuration

Copy `.env.example` to `.env.local` and set:

```env
KOTAEMON_BFF_URL=http://127.0.0.1:7860
CHAT_BFF_TOKEN=local-dev-token
CITATION_GRAPH_URL=http://127.0.0.1:8001
NEXT_PUBLIC_CITATION_GRAPH_URL=http://localhost:8001
```

The BFF token is used only in Next.js server routes and is not sent to the
browser.

## Development

```powershell
npm install
npm run dev
```

## Production

```powershell
npm run build
npm run start
```

## Stable chat SSE

`POST /api/chat` proxies the Kotaemon BFF. Events:

- `meta`: request, conversation, and user identifiers
- `status`: current processing phase
- `delta`: append answer text
- `replace`: replace the current answer text
- `citations`: structured file, page, snippet, score, and preview data
- `done`: final answer and citations
- `error`: stable error code and message
