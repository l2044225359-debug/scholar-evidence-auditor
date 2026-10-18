export type SourceFile = {
  id: string;
  name: string;
  size: number;
  user_id: string | null;
  note: {
    tokens?: number;
    loader?: string;
  };
};

export type Citation = {
  file_name: string;
  page: number | null;
  snippet: string;
  scores: Record<string, number>;
  preview_url: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type HealthStatus = {
  status: string;
  service?: string;
  version?: string;
  network_backend?: string;
};
