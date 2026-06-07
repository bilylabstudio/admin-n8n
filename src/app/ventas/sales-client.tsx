'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Period = 'ytd' | '7d' | '30d' | '90d';
type Platform = 'all' | 'shopify';

type SyncStateView = {
  platform: string;
  lastSyncRunAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  ordersImported: number;
};

type SalesData = {
  ok: boolean;
  period: Period;
  platform: string;
  since: string;
  until: string;
  syncState: SyncStateView[];
  kpis: {
    grossRevenue: number;
    netRevenue: number;
    totalOrders: number;
    refundedOrders: number;
    refundRate: number;
    totalUnits: number;
    unitsPerOrder: number;
    aov: number;
    currency: string;
  };
  byDay: { date: string; orders: number; revenue: number; units: number }[];
  byPlatform: { platform: string; orders: number; revenue: number }[];
};

const POLL_MS = 60_000;
const PERIODS: { id: Period; label: string }[] = [
  { id: 'ytd', label: 'Este año' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' }
];
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'shopify', label: 'Shopify' }
];

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
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function BarChart({ data, valueKey }: { data: { date: string; [k: string]: number | string }[]; valueKey: string }) {
  if (!data.length) {
    return <div className="empty-state" style={{ minHeight: 100 }}>Sin datos en el periodo.</div>;
  }
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
          {i % Math.max(1, Math.ceil(data.length / 7)) === 0 && (
            <span className="db-bar-label">{formatDate(d.date)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'warning' | 'error' | 'ok';
}) {
  return (
    <div className={`db-kpi-card ${tone ? `db-kpi-${tone}` : ''}`}>
      <span className="db-kpi-label">{label}</span>
      <strong className="db-kpi-value">{value}</strong>
      {sub && <span className="db-kpi-sub">{sub}</span>}
    </div>
  );
}

function PercentBar({ value, label, hint }: { value: number; label: string; hint?: string }) {
  return (
    <div className="db-pct-row">
      <span className="db-pct-label">{label}</span>
      <div className="db-pct-track">
        <div className="db-pct-fill" style={{ width: `${Math.min(100, value)}%`, background: 'var(--gummy-teal)' }} />
      </div>
      <span className="db-pct-value">{hint ?? `${value}%`}</span>
    </div>
  );
}

function SyncStatusBanner({ states }: { states: SyncStateView[] }) {
  if (!states.length) {
    return (
      <section className="db-section panel" style={{ padding: 14 }}>
        <p style={{ margin: 0 }}>Aún no se ha ejecutado ningún sync.</p>
      </section>
    );
  }
  return (
    <section className="db-section panel" style={{ padding: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        {states.map((s) => {
          const ok = s.lastSyncStatus === 'ok';
          const failed = s.lastSyncStatus === 'failed';
          return (
            <div key={s.platform} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ textTransform: 'capitalize' }}>{s.platform}</strong>
              <span style={{ color: ok ? 'var(--gummy-teal)' : failed ? 'var(--error-red)' : 'var(--ink-soft)' }}>
                {ok ? '✓ OK' : failed ? '✕ Error' : '— Sin info'}
              </span>
              {s.lastSyncRunAt && <span style={{ color: 'var(--ink-soft)' }}>último run {formatRelative(s.lastSyncRunAt)}</span>}
              <span style={{ color: 'var(--ink-soft)' }}>{formatNumber(s.ordersImported)} pedidos importados</span>
              {failed && s.lastSyncError && (
                <span style={{ color: 'var(--error-red)', flexBasis: '100%' }}>{s.lastSyncError}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SalesClient() {
  const [data, setData] = useState<SalesData | null>(null);
  const [period, setPeriod] = useState<Period>('ytd');
  const [platform, setPlatform] = useState<Platform>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (p: Period, pl: Platform, initial = false) => {
      if (initial) setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/sales?period=${p}&platform=${pl}`, { cache: 'no-store' });
        const json = (await res.json()) as SalesData & { error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar la vista.');
        setData(json);
        setUpdatedAt(new Date().toISOString());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar.');
      } finally {
        if (initial) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(period, platform, true);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => void load(period, platform), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, period, platform]);

  const currency = data?.kpis.currency ?? 'EUR';
  const totalByPlatformRevenue = data?.byPlatform.reduce((s, p) => s + p.revenue, 0) ?? 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
            style={{ width: 90, height: 'auto' }}
          />
          <h1>Ventas</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--ink-soft)', flexWrap: 'wrap' }}>
          <span className="db-updated">
            <span className="db-live-dot" />
            {updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Cargando...'}
          </span>
          <div className="db-period-selector">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={platform === p.id ? 'db-period-btn active' : 'db-period-btn'}
                type="button"
                onClick={() => setPlatform(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="db-period-selector">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                className={period === p.id ? 'db-period-btn active' : 'db-period-btn'}
                type="button"
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <a href="/">← Volver al inbox</a>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1200 }}>
        {error && <p style={{ color: 'var(--error-red)', marginBottom: 16 }}>{error}</p>}
        {loading && !data && <div className="empty-state" style={{ marginTop: 40 }}>Cargando ventas...</div>}

        {data && (
          <>
            <SyncStatusBanner states={data.syncState} />

            <section className="db-section">
              <h2 className="db-section-title">Resumen del periodo</h2>
              <div className="db-kpi-grid">
                <KpiCard label="Ingresos brutos" value={formatMoney(data.kpis.grossRevenue, currency)} sub="suma de total_price" />
                <KpiCard label="Ingresos netos" value={formatMoney(data.kpis.netRevenue, currency)} sub="brutos − reembolsos" />
                <KpiCard label="Pedidos totales" value={formatNumber(data.kpis.totalOrders)} sub="excl. cancelados y test" />
                <KpiCard label="Ticket promedio (AOV)" value={formatMoney(data.kpis.aov, currency)} sub="bruto / pedidos" />
              </div>
              <div className="db-kpi-grid" style={{ marginTop: 12 }}>
                <KpiCard
                  label="Tasa de reembolso"
                  value={`${data.kpis.refundRate}%`}
                  sub={`${formatNumber(data.kpis.refundedOrders)} pedidos`}
                  tone={data.kpis.refundRate > 10 ? 'warning' : undefined}
                />
                <KpiCard label="Unidades vendidas" value={formatNumber(data.kpis.totalUnits)} sub="Σ line_items.quantity" />
                <KpiCard label="Unidades por pedido" value={formatNumber(data.kpis.unitsPerOrder, 2)} sub="promedio" />
              </div>
            </section>

            <div className="db-two-col">
              <section className="db-section panel">
                <h2 className="db-section-title">Ingresos por día</h2>
                <BarChart data={data.byDay} valueKey="revenue" />
                <p className="db-chart-total">
                  {formatMoney(data.kpis.grossRevenue, currency)} en total · periodo {period}
                </p>
              </section>

              <section className="db-section panel">
                <h2 className="db-section-title">Pedidos por día</h2>
                <BarChart data={data.byDay} valueKey="orders" />
                <p className="db-chart-total">
                  {formatNumber(data.kpis.totalOrders)} pedidos en total
                </p>
              </section>
            </div>

            <section className="db-section panel">
              <h2 className="db-section-title">Por plataforma</h2>
              {data.byPlatform.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {data.byPlatform.map((p) => {
                    const pct = totalByPlatformRevenue > 0 ? Math.round((p.revenue / totalByPlatformRevenue) * 100) : 0;
                    return (
                      <PercentBar
                        key={p.platform}
                        label={`${p.platform[0].toUpperCase()}${p.platform.slice(1)} · ${formatNumber(p.orders)} pedidos`}
                        value={pct}
                        hint={`${formatMoney(p.revenue, currency)} · ${pct}%`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">Sin ventas en el periodo.</div>
              )}
            </section>

            <RawOrdersSection platform={platform} currency={currency} />
          </>
        )}
      </div>
    </main>
  );
}

type RawOrder = {
  id: string;
  platform: string;
  externalOrderId: string;
  orderNumber: string | null;
  currency: string;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  isTest: boolean;
  totalPrice: number;
  totalRefunded: number;
  totalUnits: number;
  customerEmail: string | null;
  countryCode: string | null;
  channel: string | null;
  externalUpdatedAt: string;
};

function RawOrdersSection({ platform, currency }: { platform: Platform; currency: string }) {
  const [expanded, setExpanded] = useState(false);
  const [orders, setOrders] = useState<RawOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/sales/orders?platform=${platform}&limit=2000`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo cargar.');
      setOrders(json.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    if (expanded && orders === null) void load();
  }, [expanded, orders, load]);

  useEffect(() => {
    setOrders(null);
  }, [platform]);

  return (
    <section className="db-section panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="db-section-title" style={{ margin: 0 }}>Detalle de pedidos</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {expanded && orders ? (
            <button className="ghost-button" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Recargando...' : 'Recargar'}
            </button>
          ) : null}
          <button className="ghost-button" type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar' : `Ver pedidos en bruto${orders ? ` (${orders.length})` : ''}`}
          </button>
        </div>
      </div>

      {expanded ? (
        <div style={{ marginTop: 12 }}>
          {error ? <p style={{ color: 'var(--error-red)' }}>{error}</p> : null}
          {loading && !orders ? <div className="empty-state" style={{ minHeight: 80 }}>Cargando pedidos...</div> : null}
          {orders && orders.length === 0 ? <div className="empty-state">No hay pedidos guardados aún.</div> : null}
          {orders && orders.length > 0 ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 8px' }}>
                Mostrando los últimos {orders.length} pedidos ordenados por fecha. Tope: 2.000.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--neutral-border, #e5e7eb)' }}>
                      <th style={{ padding: '8px 10px' }}>Fecha</th>
                      <th style={{ padding: '8px 10px' }}>Plataforma</th>
                      <th style={{ padding: '8px 10px' }}>Pedido</th>
                      <th style={{ padding: '8px 10px' }}>Cliente</th>
                      <th style={{ padding: '8px 10px' }}>País</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Reemb.</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Uds.</th>
                      <th style={{ padding: '8px 10px' }}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid var(--neutral-border, #f3f4f6)' }}>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{formatFullDate(o.processedAt)}</td>
                        <td style={{ padding: '6px 10px' }}>{o.platform}</td>
                        <td style={{ padding: '6px 10px' }}>{o.orderNumber || o.externalOrderId}</td>
                        <td style={{ padding: '6px 10px' }}>{o.customerEmail || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{o.countryCode || '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{formatMoney(o.totalPrice, o.currency || currency)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: o.totalRefunded > 0 ? 'var(--error-red)' : 'var(--ink-soft)' }}>
                          {o.totalRefunded > 0 ? formatMoney(o.totalRefunded, o.currency || currency) : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{o.totalUnits}</td>
                        <td style={{ padding: '6px 10px' }}>{o.financialStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
                Más antiguo: {formatFullDate(orders[orders.length - 1].processedAt)} · Más reciente: {formatFullDate(orders[0].processedAt)}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatFullDate(iso: string) {
  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  }).format(new Date(iso));
}
