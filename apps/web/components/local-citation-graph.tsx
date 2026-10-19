"use client";

import {
  Crown,
  Database,
  FileText,
  Gauge,
  Loader2,
  Network,
  Quote,
  RefreshCw,
  Tag,
  Telescope,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { MessageKey } from "@/lib/i18n";

import { useLanguage } from "./language-provider";
import styles from "./local-citation-graph.module.css";

type LocalNode = {
  id: string;
  title: string;
  year?: number;
  authors?: string[];
  arxiv_id?: string;
  doi?: string;
  abstract?: string;
  future_work?: string[];
  pagerank: number;
  in_degree: number;
  out_degree: number;
  degree_centrality: number;
};

type LocalEdge = {
  source: string;
  target: string;
  relation: string;
};

type EntityType =
  | "paper"
  | "author"
  | "topic"
  | "method"
  | "dataset"
  | "metric"
  | "claim";

type EntityNode = {
  id: string;
  type: EntityType;
  label: string;
  paper_ids: string[];
  year?: number;
  authors?: string[];
  arxiv_id?: string;
  doi?: string;
};

type EntityEdge = {
  source: string;
  target: string;
  relation: string;
  evidence: string;
  confidence: number;
};

type EntityPayload = {
  model?: string;
  language?: string;
  generated_at?: string;
  summary: {
    paper_count: number;
    entity_count: number;
    edge_count: number;
    counts: Partial<Record<EntityType, number>>;
  };
  nodes: EntityNode[];
  edges: EntityEdge[];
  papers: Array<{
    paper_id: string;
    paper_node_id: string;
    title: string;
    counts: Partial<Record<EntityType, number>>;
  }>;
  extraction_errors?: string[];
  error?: string;
};

type LocalGraphPayload = {
  summary: {
    paper_count: number;
    edge_count: number;
    component_count: number;
    density: number;
    max_pagerank: number;
    limit: number;
  };
  nodes: LocalNode[];
  edges: LocalEdge[];
  foundational: Array<{
    id: string;
    title: string;
    year?: number;
    pagerank: number;
    in_degree: number;
    authors?: string[];
  }>;
  frontier: Array<{
    id: string;
    title: string;
    year?: number;
    pagerank: number;
  }>;
  future_work: {
    summary_markdown: string;
    model: string;
    source_count: number;
  };
  entities?: EntityPayload;
  extraction_errors?: Array<{ file: string; error: string }>;
  truncated?: boolean;
};

const entityTypes: EntityType[] = [
  "paper",
  "author",
  "topic",
  "method",
  "dataset",
  "metric",
  "claim",
];

const entityIcons = {
  paper: FileText,
  author: Users,
  topic: Tag,
  method: Wrench,
  dataset: Database,
  metric: Gauge,
  claim: Quote,
};

const entityLabelKeys: Record<EntityType, MessageKey> = {
  paper: "localGraph.entity.paper",
  author: "localGraph.entity.author",
  topic: "localGraph.entity.topic",
  method: "localGraph.entity.method",
  dataset: "localGraph.entity.dataset",
  metric: "localGraph.entity.metric",
  claim: "localGraph.entity.claim",
};

function shortTitle(title: string, length = 28) {
  return title.length > length ? `${title.slice(0, length)}…` : title;
}

export function LocalCitationGraph() {
  const { locale, t } = useLanguage();
  const [payload, setPayload] = useState<LocalGraphPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();

  async function load(force = false) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/citation/local?language=${locale}${force ? "&refresh=1" : ""}`,
        {
          cache: "no-store",
          credentials: "include",
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          body.detail ?? body.error ?? t("localGraph.loadError"),
        );
      }
      setPayload(body);
      setSelectedId((current) => current ?? body.nodes?.[0]?.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("localGraph.loadError"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [locale]);

  const layout = useMemo(() => {
    const nodes = payload?.nodes ?? [];
    const width = 780;
    const height = 560;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(230, 80 + nodes.length * 10);
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
    return { width, height, positions };
  }, [payload]);

  const selected = payload?.nodes.find((node) => node.id === selectedId);
  const selectedEntityId = selectedId ? `paper:${selectedId}` : "";
  const selectedEntityGroups = useMemo(() => {
    const entities = payload?.entities;
    if (!entities || !selectedEntityId) return [];
    const nodes = new Map(entities.nodes.map((node) => [node.id, node]));
    const groups = new Map<EntityType, EntityNode[]>();
    for (const edge of entities.edges) {
      if (edge.source !== selectedEntityId) continue;
      const node = nodes.get(edge.target);
      if (!node) continue;
      const current = groups.get(node.type) ?? [];
      current.push(node);
      groups.set(node.type, current);
    }
    return entityTypes
      .filter((type) => type !== "paper")
      .map((type) => ({
        type,
        nodes: groups.get(type) ?? [],
      }))
      .filter((group) => group.nodes.length);
  }, [payload, selectedEntityId]);
  const relatedIds = useMemo(() => {
    if (!payload || !selectedId) return new Set<string>();
    const ids = new Set<string>([selectedId]);
    for (const edge of payload.edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [payload, selectedId]);
  const maxRank = Math.max(
    0.000001,
    ...(payload?.nodes.map((node) => node.pagerank) ?? []),
  );

  if (loading) {
    return (
      <div className={styles.loading}>
        <Loader2 className="spin" size={22} />
        <span>{t("localGraph.loading")}</span>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className={styles.error}>
        <strong>{t("localGraph.loadError")}</strong>
        <p>{error}</p>
        <button className="secondary-button" type="button" onClick={() => void load(true)}>
          <RefreshCw size={13} />
          {t("localGraph.refresh")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <Network size={13} />
            {t("localGraph.localCorpus")}
          </span>
          <h2>{t("localGraph.title")}</h2>
          <p>{t("localGraph.subtitle")}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={13} />
          {t("localGraph.refresh")}
        </button>
      </header>

      <div className={styles.metrics}>
        <span>
          <b>{payload.summary.paper_count}</b>
          {t("localGraph.papers")}
        </span>
        <span>
          <b>{payload.summary.edge_count}</b>
          {t("localGraph.edges")}
        </span>
        <span>
          <b>{payload.summary.component_count}</b>
          {t("localGraph.components")}
        </span>
        <span>
          <b>{payload.summary.density.toFixed(3)}</b>
          {t("localGraph.density")}
        </span>
      </div>

      {payload.entities ? (
        <section className={styles.entityRegister}>
          <div className={styles.entityRegisterHeader}>
            <span>
              <Network size={13} />
              {t("localGraph.entityRegister")}
            </span>
            <small>
              {payload.entities.summary.entity_count} {t("localGraph.entityNodes")}
              {" · "}
              {payload.entities.summary.edge_count} {t("localGraph.entityRelations")}
              {payload.entities.model ? ` · ${payload.entities.model}` : ""}
            </small>
          </div>
          <div className={styles.entityCounts}>
            {entityTypes.map((type) => {
              const Icon = entityIcons[type];
              return (
                <span key={type}>
                  <Icon size={12} />
                  <b>{payload.entities?.summary.counts[type] ?? 0}</b>
                  {t(entityLabelKeys[type])}
                </span>
              );
            })}
          </div>
          {payload.entities.error ? (
            <p className={styles.entityError}>{payload.entities.error}</p>
          ) : null}
        </section>
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.graphPanel}>
          <svg
            className={styles.graph}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={t("localGraph.title")}
          >
            <defs>
              <marker
                id="citation-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#8ea29e" />
              </marker>
            </defs>
            {payload.edges.map((edge, index) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);
              if (!source || !target) return null;
              const highlighted =
                !selectedId ||
                relatedIds.has(edge.source) ||
                relatedIds.has(edge.target);
              return (
                <line
                  className={highlighted ? styles.edge : styles.edgeMuted}
                  key={`${edge.source}-${edge.target}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  markerEnd="url(#citation-arrow)"
                />
              );
            })}
            {payload.nodes.map((node) => {
              const position = layout.positions.get(node.id);
              if (!position) return null;
              const radius = 10 + 20 * (node.pagerank / maxRank);
              const active = node.id === selectedId;
              return (
                <g
                  className={active ? styles.nodeActive : styles.node}
                  key={node.id}
                  transform={`translate(${position.x},${position.y})`}
                  onClick={() => setSelectedId(node.id)}
                  role="button"
                  tabIndex={0}
                >
                  <circle r={radius} />
                  <text textAnchor="middle" y={radius + 14}>
                    {shortTitle(node.title)}
                  </text>
                </g>
              );
            })}
          </svg>
        </section>

        <aside className={styles.side}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <Crown size={14} />
              {t("localGraph.foundational")}
            </div>
            <div className={styles.rankList}>
              {payload.foundational.map((node, index) => (
                <button
                  type="button"
                  className={node.id === selectedId ? styles.rankActive : ""}
                  key={node.id}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{node.title}</strong>
                    <small>
                      {node.year ?? "n.d."} · PageRank {node.pagerank.toFixed(4)}
                    </small>
                    <i style={{ width: `${(node.pagerank / maxRank) * 100}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {selected ? (
            <section className={styles.panel}>
              <div className={styles.panelTitle}>
                <Network size={14} />
                {t("localGraph.selectedPaper")}
              </div>
              <h3>{selected.title}</h3>
              <p className={styles.meta}>
                {selected.authors?.slice(0, 5).join(", ") || "Unknown author"}
                {selected.year ? ` · ${selected.year}` : ""}
              </p>
              <div className={styles.metricsInline}>
                <span>PR {selected.pagerank.toFixed(4)}</span>
                <span>IN {selected.in_degree}</span>
                <span>OUT {selected.out_degree}</span>
              </div>
              <p className={styles.abstract}>
                {selected.abstract?.slice(0, 900) || t("localGraph.noAbstract")}
              </p>
            </section>
          ) : null}

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <Tag size={14} />
              {t("localGraph.selectedEntities")}
            </div>
            {selectedEntityGroups.length ? (
              <div className={styles.entityGroups}>
                {selectedEntityGroups.map((group) => {
                  const Icon = entityIcons[group.type];
                  return (
                    <div className={styles.entityGroup} key={group.type}>
                      <span className={styles.entityGroupLabel}>
                        <Icon size={11} />
                        {t(entityLabelKeys[group.type])}
                      </span>
                      <div className={styles.entityChips}>
                        {group.nodes.map((node) => (
                          <span key={node.id} title={node.label}>
                            {node.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.entityEmpty}>
                {t("localGraph.noSelectedEntities")}
              </p>
            )}
          </section>
        </aside>
      </div>

      <section className={styles.futurePanel}>
        <div className={styles.panelTitle}>
          <Telescope size={14} />
          {t("localGraph.futureWork")}
          <span>{payload.future_work.source_count}</span>
        </div>
        <div className={styles.futureText}>
          {payload.future_work.summary_markdown}
        </div>
        {payload.truncated ? (
          <p className={styles.note}>{t("localGraph.truncated")}</p>
        ) : null}
      </section>
    </div>
  );
}
