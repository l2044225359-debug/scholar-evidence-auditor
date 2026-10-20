"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Scale,
  Server,
  ShieldCheck,
  Timer,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { MessageKey } from "@/lib/i18n";

import { useLanguage } from "./language-provider";
import styles from "./data-views.module.css";

type HealthPayload = {
  next?: Record<string, unknown>;
  kotaemon?: Record<string, unknown>;
  citation?: Record<string, unknown>;
  vibevoice?: Record<string, unknown>;
  worker?: Record<string, unknown>;
  generated_at?: string;
};

type EvaluationPayload = {
  available: boolean;
  generated_at?: string;
  protocol?: {
    name?: string;
    total?: number;
    executed?: number;
    question_set_sha256?: string;
    rubric_sha256?: string;
  };
  metrics?: {
    blind?: {
      total: number;
      passRate: number;
      averageLatencyMs: number;
      p95LatencyMs: number;
      baselinePassRate?: number;
      baselinePassRateGain?: number;
    };
    baselines?: {
      fixedRag?: {
        evaluated: number;
        systemPassRate: number;
        baselinePassRate: number;
        absolutePassRateGain: number;
        wins: number;
        losses: number;
        ties: number;
        systemAverageLatencyMs: number;
        baselineAverageLatencyMs: number;
      };
    };
  };
};

function statusOf(value?: Record<string, unknown>) {
  return String(value?.status ?? "unavailable");
}

function StatusPanel({
  title,
  payload,
  endpoint,
  loading,
}: {
  title: string;
  payload?: Record<string, unknown>;
  endpoint: string;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const healthy = !loading && statusOf(payload) === "ok";
  const models =
    payload?.models && typeof payload.models === "object"
      ? (payload.models as Record<string, unknown>)
      : {};
  return (
    <section className={styles.statusPanel}>
      <div className={styles.statusPanelHeader}>
        <div className={styles.statusPanelTitle}>
          <Server size={17} />
          {title}
        </div>
        <span
          className={
            healthy ? styles.statusHealthy : styles.statusUnavailable
          }
        >
          {loading ? (
            <Loader2 className="spin" size={18} />
          ) : healthy ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertTriangle size={18} />
          )}
        </span>
      </div>
      <div className={styles.statusDetails}>
        <div className={styles.statusRow}>
          <span>{t("system.status")}</span>
          <code>
            {loading
              ? t("common.loading")
              : statusOf(payload)}
          </code>
        </div>
        <div className={styles.statusRow}>
          <span>{t("system.endpoint")}</span>
          <code>{endpoint}</code>
        </div>
        {Object.entries(payload ?? {})
          .filter(([key]) => !["status"].includes(key))
          .filter(([key]) => key !== "models")
          .slice(0, 5)
          .map(([key, value]) => (
            <div className={styles.statusRow} key={key}>
              <span>{fieldLabel(t, key)}</span>
              <code>{String(value)}</code>
            </div>
          ))}
        {["flash", "complex", "embedding", "rerank"].map((key) =>
          models[key] ? (
            <div className={styles.statusRow} key={`model-${key}`}>
              <span>{modelLabel(t, key)}</span>
              <code>{String(models[key])}</code>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

function EvaluationMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={styles.evaluationMetric}>
      <span className={styles.evaluationMetricIcon}>{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function SystemView() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<HealthPayload>({});
  const [evaluation, setEvaluation] = useState<EvaluationPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(t("system.healthError"));
      setHealth(await response.json());
      const evaluationResponse = await fetch("/api/evaluation", {
        cache: "no-store",
        credentials: "include",
      }).catch(() => null);
      if (evaluationResponse?.ok) {
        setEvaluation(await evaluationResponse.json());
      } else {
        setEvaluation(undefined);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("system.healthError"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const blind = evaluation?.metrics?.blind;
  const fixedRag = evaluation?.metrics?.baselines?.fixedRag;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t("system.title")}</h1>
          <p>{t("system.subtitle")}</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : ""} size={14} />
          {t("system.refresh")}
        </button>
      </header>
      <main className={styles.content}>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className={styles.statusGrid}>
          <StatusPanel
            title="Next.js"
            payload={health.next}
            endpoint="localhost:3000"
            loading={loading}
          />
          <StatusPanel
            title="Kotaemon chat BFF"
            payload={health.kotaemon}
            endpoint="localhost:7860"
            loading={loading}
          />
          <StatusPanel
            title="Citation graph"
            payload={health.citation}
            endpoint="localhost:8001"
            loading={loading}
          />
          <StatusPanel
            title="Index worker"
            payload={health.worker}
            endpoint="local worker"
            loading={loading}
          />
          <StatusPanel
            title="VibeVoice TTS"
            payload={health.vibevoice}
            endpoint="localhost:8002"
            loading={loading}
          />
        </div>
        <section className={styles.evaluationPanel}>
          <div className={styles.evaluationHeader}>
            <div>
              <span className={styles.evaluationEyebrow}>
                <ShieldCheck size={14} />
                {t("system.protocol")}
              </span>
              <h2>{t("system.evaluationTitle")}</h2>
              <p>{t("system.evaluationSubtitle")}</p>
            </div>
            {evaluation?.generated_at ? (
              <code>
                {new Date(evaluation.generated_at).toLocaleString()}
              </code>
            ) : null}
          </div>
          {blind ? (
            <>
              <div className={styles.evaluationGrid}>
                <EvaluationMetric
                  icon={<ShieldCheck size={16} />}
                  label={t("system.blindPass")}
                  value={formatPercent(blind.passRate)}
                  detail={`${blind.total} ${t("system.evaluationCases")}`}
                />
                <EvaluationMetric
                  icon={<Scale size={16} />}
                  label={t("system.baselinePass")}
                  value={formatPercent(
                    fixedRag?.baselinePassRate ??
                      blind.baselinePassRate ??
                      0,
                  )}
                  detail={`${fixedRag?.wins ?? 0}/${fixedRag?.losses ?? 0}/${fixedRag?.ties ?? 0} ${t("system.baselineRecord")}`}
                />
                <EvaluationMetric
                  icon={<BarChart3 size={16} />}
                  label={t("system.baselineGap")}
                  value={formatPointDelta(
                    fixedRag?.absolutePassRateGain ??
                      blind.baselinePassRateGain ??
                      0,
                  )}
                  detail={t("system.baselineGapHint")}
                />
                <EvaluationMetric
                  icon={<Timer size={16} />}
                  label={t("system.latency")}
                  value={formatLatency(blind.averageLatencyMs)}
                  detail={`P95 ${formatLatency(blind.p95LatencyMs)}`}
                />
              </div>
              <div className={styles.evaluationFooter}>
                <span>
                  {evaluation?.protocol?.name ?? "blind-v1"} ·{" "}
                  {evaluation?.protocol?.executed ?? blind.total}/
                  {evaluation?.protocol?.total ?? blind.total}
                </span>
                <code
                  title={evaluation?.protocol?.question_set_sha256 ?? ""}
                >
                  sha256:
                  {(evaluation?.protocol?.question_set_sha256 ?? "").slice(
                    0,
                    12,
                  ) || "unavailable"}
                </code>
                <span>
                  {t("system.baselineLatency")}:{" "}
                  {formatLatency(
                    fixedRag?.baselineAverageLatencyMs ?? 0,
                  )}
                </span>
              </div>
            </>
          ) : (
            <p className={styles.evaluationEmpty}>
              {t("system.notEvaluated")}
            </p>
          )}
        </section>
        {health.generated_at ? (
          <p className={styles.generatedAt}>
            {health.generated_at}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function formatPercent(value: number) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatPointDelta(value: number) {
  const points = Number(value) * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pp`;
}

function formatLatency(value: number) {
  const seconds = Number(value) / 1000;
  return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)} s`;
}

function fieldLabel(t: (key: MessageKey) => string, key: string) {
  const labels: Record<string, MessageKey> = {
    service: "system.service",
    version: "system.version",
    default_user_id: "system.defaultUser",
    sessions: "system.sessions",
    network_backend: "system.networkBackend",
    cache_dir: "system.cacheDir",
  };
  return labels[key] ? t(labels[key]) : key.replaceAll("_", " ");
}

function modelLabel(t: (key: MessageKey) => string, key: string) {
  const labels: Record<string, MessageKey> = {
    flash: "system.flashModel",
    complex: "system.complexModel",
    embedding: "system.embeddingModel",
    rerank: "system.rerankModel",
  };
  return labels[key] ? t(labels[key]) : `${key} model`;
}
