'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Period = '7d' | '30d' | '90d';

type DashboardData = {
  ok: boolean;
  period: Period;
  realtime: { pendingNow: number; avgWaitMinutes: number; receivedToday: number; sendFailed: number };
  volumeByDay: { date: string; count: number }[];
  avgResponseByDay: { date: string; avgMinutes: number | null }[];
  statusBreakdown: { status: string; count: number }[];
  topCategories: { category: string; count: number }[];
  topIntents: { intent: string; count: number }[];
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

const POLL_MS = 30_000;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
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
