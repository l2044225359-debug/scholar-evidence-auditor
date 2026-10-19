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
  demo?: boolean;
};

export type HealthStatus = {
  status: string;
  service?: string;
  version?: string;
  network_backend?: string;
};

export type KnowledgeOverview = {
  documents: number;
  pages: number;
  chunks: number;
  ocr_pages: number;
  citation_edges: number;
  generated_at: string;
  health: {
    score: number;
    status: "empty" | "healthy" | "attention" | "degraded" | "indexing";
    components: {
      document_chunks: number;
      vector_chunks: number;
      chunk_delta: number;
      missing_files: number;
      low_text_pages: number;
      ocr_recovered_pages: number;
      ocr_missing_pages: number;
      citation_extraction_errors: number;
    };
  };
  queue: {
    active: number;
    failed: number;
    worker_status: "ready" | "busy";
  };
};

export type KnowledgeCollection = {
  id: "transformer" | "rag" | "agent";
  name: string;
  description: string;
  file_ids: string[];
  document_count: number;
};
