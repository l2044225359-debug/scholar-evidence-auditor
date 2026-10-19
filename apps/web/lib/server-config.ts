export const serverConfig = {
  bffUrl: (process.env.KOTAEMON_BFF_URL ?? "http://127.0.0.1:7860").replace(
    /\/$/,
    "",
  ),
  bffToken: process.env.CHAT_BFF_TOKEN ?? "",
  citationUrl: (
    process.env.CITATION_GRAPH_URL ?? "http://127.0.0.1:8001"
  ).replace(/\/$/, ""),
  vibevoiceUrl: (
    process.env.VIBEVOICE_URL ?? "http://127.0.0.1:8002"
  ).replace(/\/$/, ""),
};

export function bffHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (serverConfig.bffToken) {
    headers.set("X-BFF-Token", serverConfig.bffToken);
  }
  return headers;
}
