'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Period = '7d' | '30d' | '90d';
type Sentiment = 'molesto' | 'neutral' | 'contento';

type ReasonByFamily = {
  family: string;
  label: string;
  count: number;
  percent: number;
  topReasons: {
    id: string | null;
    label: string;
    count: number;
    percentOfTotal: number;
    percentOfFamily: number;
  }[];
};

type RouteSourceBreakdown = {
  source: string | null;
  label: string;
  count: number;
  percent: number;
};

type SentimentBreakdown = {
  sentiment: Sentiment;
  label: string;
  count: number;
  percent: number;
};

type SentimentByFamily = {
  family: string;
  label: string;
  count: number;
  molesto: number;
  neutral: number;
  contento: number;
  molestoPercent: number;
  neutralPercent: number;
  contentoPercent: number;
};

type DashboardData = {
  ok: boolean;
  period: Period;
  realtime: { pendingNow: number; avgWaitMinutes: number; receivedToday: number; sendFailed: number };
  volumeByDay: { date: string; count: number }[];
  avgResponseByDay: { date: string; avgMinutes: number | null }[];
  statusBreakdown: { status: string; count: number }[];
  topCategories: { category: string; count: number }[];
  topIntents: { intent: string; count: number }[];
  reasonsByFamily: ReasonByFamily[];
  routeSourceBreakdown: RouteSourceBreakdown[];
  closedLabelRate: number;
  sentimentBreakdown: SentimentBreakdown[];
  sentimentCoverage: number;
  sentimentByFamily: SentimentByFamily[];
  totalInPeriod: number;
  aiAccuracy: number;
  abandonRate: number;
  escalationRate: number;
  sensitiveRate: number;
  serverTime: string;
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Sin respuesta IA',
  ai_generated: 'Generado por IA',
  pending_review: 'Por revisar',
  approved_sent: 'Aprobado',
  edited_sent: 'Editado y enviado',
  discarded: 'Descartado',
  manual: 'Manual',
  send_failed: 'Error de envío',
};

const STATUS_COLORS: Record<string, string> = {
  approved_sent: 'var(--gummy-teal)',
  edited_sent: 'var(--gummy-blue)',
  pending_review: 'var(--review-amber)',
  discarded: 'var(--ink-muted)',
  send_failed: 'var(--error-red)',
  new: 'var(--neutral-bg)',
  ai_generated: 'var(--gummy-violet)',
  manual: 'var(--manual-violet)',
};

const SENTIMENT_COLORS: Record<Sentiment, string> = {
  molesto: 'var(--error-red)',
  neutral: 'var(--ink-muted)',
  contento: 'var(--gummy-teal)',
};

const POLL_MS = 30_000;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Madrid'
  }).format(new Date(iso));
}

function formatRelative(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
}

function BarChart({ data, valueKey }: { data: { date: string; [k: string]: number | string | null }[]; valueKey: string }) {
  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  return (
    <div className="db-bar-chart">
      {data.map((d, i) => (
        <div key={d.date} className="db-bar-col">
          <div className="db-bar-wrap">
            <div
              className="db-bar"
              style={{ height: `${Math.round((values[i] / max) * 100)}%` }}
              title={`${formatDate(d.date)}: ${values[i]}`}
            />
          </div>
          {i % Math.ceil(data.length / 7) === 0 && (
            <span className="db-bar-label">{formatDate(d.date)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function PercentBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  return (
    <div className="db-pct-row">
      {label && <span className="db-pct-label">{label}</span>}
      <div className="db-pct-track">
        <div className="db-pct-fill" style={{ width: `${value}%`, background: color || 'var(--gummy-teal)' }} />
      </div>
      <span className="db-pct-value">{value}%</span>
    </div>
  );
}

function StackedBar({
  segments
}: {
  segments: { key: Sentiment; label: string; count: number }[];
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);

  return (
    <div className="db-stacked-bar">
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <span
            key={segment.key}
            className="db-stacked-segment"
            style={{
              width: `${Math.max(3, Math.round((segment.count / Math.max(total, 1)) * 100))}%`,
              background: SENTIMENT_COLORS[segment.key]
            }}
            title={`${segment.label}: ${segment.count}`}
          />
        ))}
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'warning' | 'error' | 'ok' }) {
  return (
    <div className={`db-kpi-card ${tone ? `db-kpi-${tone}` : ''}`}>
      <span className="db-kpi-label">{label}</span>
      <strong className="db-kpi-value">{value}</strong>
      {sub && <span className="db-kpi-sub">{sub}</span>}
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [period, setPeriod] = useState<Period>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (p: Period, initial = false) => {
      if (initial) setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/dashboard?period=${p}`, { cache: 'no-store' });
        const json = (await res.json()) as DashboardData;
        if (!res.ok || !json.ok) throw new Error('No se pudo cargar el dashboard.');
        setData(json);
        setUpdatedAt(json.serverTime);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar.');
      } finally {
        if (initial) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(period, true);
    timerRef.current = setInterval(() => void load(period), POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load, period]);

  const maxCat = data?.topCategories[0]?.count ?? 1;
  const maxInt = data?.topIntents[0]?.count ?? 1;
  const totalStatus = data?.statusBreakdown.reduce((s, r) => s + r.count, 0) ?? 1;
  const sentimentMolesto = data?.sentimentBreakdown.find((s) => s.sentiment === 'molesto') ?? {
    sentiment: 'molesto' as const,
    label: 'Molestos',
    count: 0,
    percent: 0
  };
  const sentimentNeutral = data?.sentimentBreakdown.find((s) => s.sentiment === 'neutral') ?? {
    sentiment: 'neutral' as const,
    label: 'Neutrales',
    count: 0,
    percent: 0
  };
  const sentimentContento = data?.sentimentBreakdown.find((s) => s.sentiment === 'contento') ?? {
    sentiment: 'contento' as const,
    label: 'Contentos',
    count: 0,
    percent: 0
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220" alt="V-gummies" style={{ width: 90, height: 'auto' }} />
          <h1>Dashboard de soporte</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--ink-soft)' }}>
          <span className="db-updated"><span className="db-live-dot" />{updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Cargando...'}</span>
          <div className="db-period-selector">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <button key={p} className={period === p ? 'db-period-btn active' : 'db-period-btn'} type="button" onClick={() => setPeriod(p)}>
                {p === '7d' ? '7 días' : p === '30d' ? '30 días' : '90 días'}
              </button>
            ))}
          </div>
          <a href="/ventas">Ventas</a>
          <a href="/">← Volver al inbox</a>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1200 }}>
        {error && <p style={{ color: 'var(--error-red)', marginBottom: 16 }}>{error}</p>}
        {loading && !data && <div className="empty-state" style={{ marginTop: 40 }}>Cargando dashboard...</div>}

        {data && (
          <>
            {/* ── Tiempo real ── */}
            <section className="db-section">
              <h2 className="db-section-title">Tiempo real</h2>
              <div className="db-kpi-grid">
                <KpiCard
                  label="Pendientes ahora"
                  value={data.realtime.pendingNow}
                  sub="en cola de revisión"
                  tone={data.realtime.pendingNow > 10 ? 'warning' : undefined}
                />
                <KpiCard
                  label="Espera promedio"
                  value={`${data.realtime.avgWaitMinutes} min`}
                  sub="tickets pendientes"
                  tone={data.realtime.avgWaitMinutes > 60 ? 'error' : data.realtime.avgWaitMinutes > 30 ? 'warning' : 'ok'}
                />
                <KpiCard
                  label="Recibidos hoy"
                  value={data.realtime.receivedToday}
                  sub="últimas 24 horas"
                />
                <KpiCard
                  label="Errores de envío"
                  value={data.realtime.sendFailed}
                  sub="tickets send_failed"
                  tone={data.realtime.sendFailed > 0 ? 'error' : 'ok'}
                />
              </div>
            </section>

            {/* ── Volumen por día ── */}
            <div className="db-two-col">
              <section className="db-section panel">
                <h2 className="db-section-title">Mensajes recibidos por día</h2>
                <BarChart data={data.volumeByDay} valueKey="count" />
                <p className="db-chart-total">{data.totalInPeriod} en total · periodo {period}</p>
              </section>

              <section className="db-section panel">
                <h2 className="db-section-title">Tiempo medio de respuesta (min)</h2>
                {data.avgResponseByDay.length > 0 ? (
                  <BarChart
                    data={data.avgResponseByDay.map((d) => ({ date: d.date, avgMinutes: d.avgMinutes ?? 0 }))}
                    valueKey="avgMinutes"
                  />
                ) : (
                  <div className="empty-state" style={{ minHeight: 100 }}>Sin datos de respuesta enviada.</div>
                )}
              </section>
            </div>

            {/* ── KPIs de calidad ── */}
            <section className="db-section">
              <h2 className="db-section-title">Calidad y satisfacción</h2>
              <div className="db-kpi-grid">
                <KpiCard
                  label="Precisión IA"
                  value={`${data.aiAccuracy}%`}
                  sub="aprobados sin editar"
                  tone={data.aiAccuracy >= 70 ? 'ok' : data.aiAccuracy >= 50 ? 'warning' : 'error'}
                />
                <KpiCard
                  label="Tasa de escalación"
                  value={`${data.escalationRate}%`}
                  sub="requirieron atención humana"
                  tone={data.escalationRate > 20 ? 'warning' : undefined}
                />
                <KpiCard
                  label="Tasa de abandono"
                  value={`${data.abandonRate}%`}
                  sub="tickets descartados"
                  tone={data.abandonRate > 15 ? 'warning' : undefined}
                />
                <KpiCard
                  label="Casos sensibles"
                  value={`${data.sensitiveRate}%`}
                  sub="con riskFlags activos"
                  tone={data.sensitiveRate > 30 ? 'warning' : undefined}
                />
              </div>
            </section>

            <section className="db-section">
              <h2 className="db-section-title">Motivos y etiquetado</h2>
              <div className="db-kpi-grid">
                <KpiCard
                  label="Etiqueta cerrada"
                  value={`${data.closedLabelRate}%`}
                  sub={`${data.totalInPeriod} tickets del periodo`}
                  tone={data.closedLabelRate >= 80 ? 'ok' : data.closedLabelRate >= 50 ? 'warning' : 'error'}
                />
                <KpiCard
                  label="Sentimiento analizado"
                  value={`${data.sentimentCoverage}%`}
                  sub="tickets con sentimiento"
                  tone={data.sentimentCoverage >= 80 ? 'ok' : data.sentimentCoverage >= 50 ? 'warning' : 'error'}
                />
                <KpiCard
                  label="Familias activas"
                  value={data.reasonsByFamily.filter((reason) => reason.family !== 'sin_etiqueta').length}
                  sub="con etiqueta cerrada"
                />
                <KpiCard
                  label="Fuentes de ruta"
                  value={data.routeSourceBreakdown.length}
                  sub="orígenes detectados"
                />
              </div>
            </section>

            <div className="db-two-col">
              <section className="db-section panel">
                <h2 className="db-section-title">Motivos de contacto</h2>
                <div className="db-reason-list">
                  {data.reasonsByFamily.map((group) => (
                    <div key={group.family} className="db-reason-group">
                      <div className="db-reason-head">
                        <strong>{group.label}</strong>
                        <span>{group.count} · {group.percent}%</span>
                      </div>
                      <div className="db-reason-track">
                        <div className="db-reason-fill" style={{ width: `${group.percent}%` }} />
                      </div>
                      <div className="db-mini-list">
                        {group.topReasons.map((reason) => (
                          <div key={reason.id ?? 'sin-etiqueta'} className="db-mini-row">
                            <span>{reason.label}</span>
                            <strong>{reason.count}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {data.reasonsByFamily.length === 0 && <div className="empty-state">Sin datos.</div>}
                </div>
              </section>

              <section className="db-section panel">
                <h2 className="db-section-title">Origen de etiquetas</h2>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.routeSourceBreakdown.map((source) => (
                    <PercentBar
                      key={source.source ?? 'sin-fuente'}
                      label={source.label}
                      value={source.percent}
                      color={source.source ? 'var(--gummy-teal)' : 'var(--ink-muted)'}
                    />
                  ))}
                  {data.routeSourceBreakdown.length === 0 && <div className="empty-state">Sin datos.</div>}
                </div>
              </section>
            </div>

            <section className="db-section">
              <h2 className="db-section-title">Sentimiento de clientes</h2>
              <div className="db-kpi-grid">
                <KpiCard
                  label={sentimentMolesto.label}
                  value={`${sentimentMolesto.percent}%`}
                  sub={`${sentimentMolesto.count} tickets`}
                  tone={sentimentMolesto.percent > 25 ? 'error' : sentimentMolesto.percent > 12 ? 'warning' : undefined}
                />
                <KpiCard
                  label={sentimentNeutral.label}
                  value={`${sentimentNeutral.percent}%`}
                  sub={`${sentimentNeutral.count} tickets`}
                />
                <KpiCard
                  label={sentimentContento.label}
                  value={`${sentimentContento.percent}%`}
                  sub={`${sentimentContento.count} tickets`}
                  tone={sentimentContento.percent >= 35 ? 'ok' : undefined}
                />
                <KpiCard
                  label="Cobertura"
                  value={`${data.sentimentCoverage}%`}
                  sub="del periodo"
                  tone={data.sentimentCoverage >= 80 ? 'ok' : data.sentimentCoverage >= 50 ? 'warning' : 'error'}
                />
              </div>
            </section>

            <section className="db-section panel">
              <h2 className="db-section-title">Sentimiento por motivo</h2>
              <div className="db-stacked-list">
                {data.sentimentByFamily.map((item) => (
                  <div key={item.family} className="db-stacked-row">
                    <div className="db-stacked-head">
                      <strong>{item.label}</strong>
                      <span>{item.count}</span>
                    </div>
                    <StackedBar
                      segments={[
                        { key: 'molesto', label: 'Molestos', count: item.molesto },
                        { key: 'neutral', label: 'Neutrales', count: item.neutral },
                        { key: 'contento', label: 'Contentos', count: item.contento },
                      ]}
                    />
                    <div className="db-stacked-legend">
                      <span>{item.molestoPercent}% molestos</span>
                      <span>{item.neutralPercent}% neutrales</span>
                      <span>{item.contentoPercent}% contentos</span>
                    </div>
                  </div>
                ))}
                {data.sentimentByFamily.length === 0 && <div className="empty-state">Sin datos de sentimiento.</div>}
              </div>
            </section>

            {/* ── Estado y dudas frecuentes ── */}
            <div className="db-two-col">
              <section className="db-section panel">
                <h2 className="db-section-title">Distribución de estados</h2>
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.statusBreakdown
                    .sort((a, b) => b.count - a.count)
                    .map((s) => (
                      <PercentBar
                        key={s.status}
                        label={STATUS_LABELS[s.status] ?? s.status}
                        value={Math.round((s.count / totalStatus) * 100)}
                        color={STATUS_COLORS[s.status]}
                      />
                    ))}
                </div>
              </section>

              <section className="db-section panel">
                <h2 className="db-section-title">Dudas frecuentes — Categorías</h2>
                <div style={{ display: 'grid', gap: 7 }}>
                  {data.topCategories.slice(0, 8).map((c) => (
                    <PercentBar
                      key={c.category}
                      label={c.category}
                      value={Math.round((c.count / maxCat) * 100)}
                    />
                  ))}
                  {data.topCategories.length === 0 && <div className="empty-state">Sin datos.</div>}
                </div>
              </section>
            </div>

            {/* ── Intents ── */}
            <section className="db-section panel">
              <h2 className="db-section-title">Intenciones más frecuentes</h2>
              <div className="db-intent-grid">
                {data.topIntents.slice(0, 8).map((i) => (
                  <div key={i.intent} className="db-intent-card">
                    <span className="db-intent-name">{i.intent}</span>
                    <strong className="db-intent-count">{i.count}</strong>
                    <div className="db-intent-bar">
                      <div style={{ width: `${Math.round((i.count / maxInt) * 100)}%`, background: 'var(--gummy-teal)', height: '100%', borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
