'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './panel.module.css';

// ----------------------------- Tipos de la API -----------------------------

type Kpis = {
  netSales: number;
  grossSales: number;
  orders: number;
  units: number;
  aov: number;
  refundRate: number;
  contribution: number;
  contributionRate: number | null;
};

type Channel = {
  platform: string;
  kpis: Kpis;
  previous: Kpis;
  share: number;
  delta: number | null;
  pendingOrders: number;
  zeroAmountOrders: number;
  contribution: {
    netSales: number;
    fees: number;
    feesSource: 'api' | 'estimated' | 'missing';
    productCost: number;
    ads: number;
    adsSource: 'api' | 'missing';
    contribution: number;
    contributionRate: number | null;
  };
};

type Alert = { level: 'critical' | 'warning' | 'info'; platform: string | null; title: string; detail: string };

type PanelResponse = {
  ok: true;
  range: {
    preset: string;
    current: { start: string; end: string };
    previous: { start: string; end: string };
    compareLabel: string;
    today: string;
  };
  hasPrevious: boolean;
  kpis: Kpis;
  previous: Kpis;
  deltas: Record<'netSales' | 'grossSales' | 'orders' | 'aov' | 'contribution' | 'refundRate', number | null>;
  channels: Channel[];
  marketing: { totalAds: number; totalFees: number; mer: number | null };
  forecast: {
    month: string;
    daysElapsed: number;
    daysInMonth: number;
    netToDate: number;
    projectedNet: number;
    projectedByLast7: number;
    previousMonthNet: number;
    vsPreviousMonth: number | null;
  } | null;
  series: {
    granularity: 'day' | 'week' | 'month';
    points: { key: string; values: Record<string, number>; orders: Record<string, number> }[];
  };
  trend: { month: string; platform: string; orders: number; net: number }[];
  customers: { platform: string; customers: number; returningCustomers: number; multiOrderCustomers: number; netSales: number }[];
  countries: { country: string; orders: number; netSales: number }[];
  freshness: {
    platform: string;
    lastOrderAt: string | null;
    lastSyncRunAt: string | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
  }[];
  alerts: Alert[];
};

// ----------------------------- Constantes -----------------------------

const PLATFORMS = ['shopify', 'amazon', 'tiktok_shop'] as const;
const PLATFORM_LABELS: Record<string, string> = { shopify: 'Shopify', amazon: 'Amazon', tiktok_shop: 'TikTok Shop' };
// Orden fijo de color por canal (validado para daltonismo; ver skill dataviz).
const PLATFORM_COLORS: Record<string, string> = { shopify: '#334fb4', amazon: '#e08a2c', tiktok_shop: '#a891f6' };

const PRESETS = [
  { id: 'mtd', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'ytd', label: 'Este año' }
];

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'España', PT: 'Portugal', FR: 'Francia', IT: 'Italia', DE: 'Alemania', GB: 'Reino Unido',
  NL: 'Países Bajos', BE: 'Bélgica', IE: 'Irlanda', AT: 'Austria', CH: 'Suiza', US: 'Estados Unidos',
  MX: 'México', AD: 'Andorra', PL: 'Polonia', SE: 'Suecia', '??': 'Sin país'
};

// ----------------------------- Formato -----------------------------

const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

function money(v: number) {
  return eur0.format(v);
}
function compactMoney(v: number) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toLocaleString('es-ES', { maximumFractionDigits: 0 })} k€`;
  return eur0.format(v);
}
function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}
function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', { ...opts, timeZone: 'UTC' });
}
function monthLabel(month: string, long = false) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-ES', {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : '2-digit',
    timeZone: 'UTC'
  });
}
function bucketLabel(key: string, g: 'day' | 'week' | 'month', long = false) {
  if (g === 'month') return monthLabel(key, long);
  if (g === 'week') return `${long ? 'Semana del ' : ''}${dayLabel(key)}`;
  return long ? dayLabel(key, { weekday: 'short', day: 'numeric', month: 'short' }) : dayLabel(key);
}
function relativeTime(iso: string | null) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  if (h < 1) return `hace ${Math.max(1, Math.round(diff / 60_000))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

// ----------------------------- Hooks -----------------------------

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ----------------------------- Componente principal -----------------------------

export function PanelClient() {
  const [preset, setPreset] = useState('mtd');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [data, setData] = useState<PanelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (params: URLSearchParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/panel?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/ventas/login';
        return;
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Error cargando el panel');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando el panel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (preset === 'custom') return;
    void load(new URLSearchParams({ preset }));
  }, [preset, load]);

  const applyCustom = () => {
    if (!custom.start || !custom.end) return;
    setPreset('custom');
    void load(new URLSearchParams({ start: custom.start, end: custom.end }));
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>V-Gummies</p>
          <h1 className={styles.title}>Panel de negocio</h1>
          {data && (
            <p className={styles.subtitle}>
              {dayLabel(data.range.current.start, { day: 'numeric', month: 'long', year: 'numeric' })} –{' '}
              {dayLabel(data.range.current.end, { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
              {data.range.compareLabel}
            </p>
          )}
        </div>
        <nav className={styles.links}>
          <a href="/ventas">Detalle de ventas</a>
          <a href="/">Inbox</a>
        </nav>
      </header>

      <div className={styles.filters} role="toolbar" aria-label="Periodo">
        <div className={styles.chips}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip} ${preset === p.id ? styles.chipActive : ''}`}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.customRange}>
          <input
            type="date"
            aria-label="Desde"
            value={custom.start}
            onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
          />
          <span>–</span>
          <input
            type="date"
            aria-label="Hasta"
            value={custom.end}
            onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
          />
          <button
            type="button"
            className={`${styles.chip} ${preset === 'custom' ? styles.chipActive : ''}`}
            onClick={applyCustom}
            disabled={!custom.start || !custom.end}
          >
            Aplicar
          </button>
        </div>
      </div>

      {error && <div className={`${styles.alert} ${styles.alertCritical}`}>{error}</div>}
      {!data && loading && <div className={styles.loading}>Cargando datos…</div>}

      {data && (
        <div className={loading ? styles.dimmed : undefined} aria-busy={loading}>
          <Alerts alerts={data.alerts} />
          <KpiRow data={data} />
          <div className={styles.grid2}>
            <SalesChart data={data} />
            <ForecastCard data={data} />
          </div>
          <ChannelTable data={data} />
          <TrendChart data={data} />
          <div className={styles.grid2even}>
            <CustomersCard data={data} />
            <CountriesCard data={data} />
          </div>
          <SourcesCard data={data} />
        </div>
      )}
    </div>
  );
}

// ----------------------------- Alertas -----------------------------

function Alerts({ alerts }: { alerts: Alert[] }) {
  const important = alerts.filter((a) => a.level !== 'info');
  if (!important.length) return null;
  return (
    <section className={styles.alerts} aria-label="Avisos de datos">
      {important.map((a, i) => (
        <div key={i} className={`${styles.alert} ${a.level === 'critical' ? styles.alertCritical : styles.alertWarning}`}>
          <span className={styles.alertIcon} aria-hidden>
            {a.level === 'critical' ? '!' : 'i'}
          </span>
          <div>
            <strong>{a.title}</strong>
            <span className={styles.alertDetail}>{a.detail}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

// ----------------------------- KPIs -----------------------------

function Delta({ value, unit = '%', invert = false }: { value: number | null; unit?: string; invert?: boolean }) {
  if (value === null || value === undefined) return <span className={styles.deltaMuted}>sin comparativa</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  const arrow = flat ? '→' : value > 0 ? '↑' : '↓';
  return (
    <span className={flat ? styles.deltaMuted : good ? styles.deltaUp : styles.deltaDown}>
      {arrow} {Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: 1 })}
      {unit === 'pp' ? ' pp' : ' %'}
    </span>
  );
}

function KpiRow({ data }: { data: PanelResponse }) {
  const k = data.kpis;
  const p = data.previous;
  const estimated = data.channels.some((c) => c.kpis.orders > 0 && (c.contribution.feesSource !== 'api' || c.contribution.adsSource !== 'api'));
  const tiles = [
    { label: 'Ventas netas', hint: 'Sin IVA y descontadas devoluciones', value: money(k.netSales), prev: money(p.netSales), delta: <Delta value={data.deltas.netSales} /> },
    { label: 'Facturación', hint: 'Con IVA', value: money(k.grossSales), prev: money(p.grossSales), delta: <Delta value={data.deltas.grossSales} /> },
    { label: 'Pedidos', hint: `${int.format(k.units)} unidades`, value: int.format(k.orders), prev: int.format(p.orders), delta: <Delta value={data.deltas.orders} /> },
    { label: 'Ticket medio', hint: 'Venta neta por pedido', value: eur2.format(k.aov), prev: eur2.format(p.aov), delta: <Delta value={data.deltas.aov} /> },
    {
      label: 'Margen de contribución',
      hint: estimated ? 'Estimado · ver cobertura abajo' : 'Tras comisiones, producto y anuncios',
      value: money(k.contribution),
      sub: k.contributionRate !== null ? `${pct(k.contributionRate)} de las ventas` : undefined,
      prev: money(p.contribution),
      delta: <Delta value={data.deltas.contribution} />
    },
    { label: 'Devoluciones', hint: 'Pedidos con reembolso', value: pct(k.refundRate), prev: pct(p.refundRate), delta: <Delta value={data.deltas.refundRate} unit="pp" invert /> }
  ];
  return (
    <section className={styles.kpis} aria-label="Indicadores principales">
      {tiles.map((t) => (
        <div key={t.label} className={styles.kpi}>
          <span className={styles.kpiLabel}>{t.label}</span>
          <span className={styles.kpiValue}>{t.value}</span>
          {t.sub && <span className={styles.kpiSub}>{t.sub}</span>}
          <span className={styles.kpiDelta}>
            {t.delta}
            {data.hasPrevious && <span className={styles.kpiPrev}> · antes {t.prev}</span>}
          </span>
          <span className={styles.kpiHint}>{t.hint}</span>
        </div>
      ))}
    </section>
  );
}

// ----------------------------- Leyenda -----------------------------

function Legend({ platforms }: { platforms: string[] }) {
  return (
    <ul className={styles.legend}>
      {platforms.map((p) => (
        <li key={p}>
          <span className={styles.swatch} style={{ background: PLATFORM_COLORS[p] ?? '#8f889f' }} />
          {PLATFORM_LABELS[p] ?? p}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------- Grafica de barras apiladas -----------------------------

type StackDatum = { key: string; label: string; longLabel: string; values: Record<string, number>; orders?: Record<string, number> };

function StackedBars({ data, platforms, height = 240 }: { data: StackDatum[]; platforms: string[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56;
  const padB = 26;
  const padT = 8;
  const innerW = Math.max(0, width - padL - 8);
  const innerH = height - padB - padT;
  const totals = data.map((d) => platforms.reduce((a, p) => a + Math.max(0, d.values[p] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = data.length ? innerW / data.length : 0;
  const barW = Math.max(2, Math.min(36, step * 0.72));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  return (
    <div ref={ref} className={styles.chartWrap} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Gráfica de ventas netas por canal">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} className={t === 0 ? styles.axis : styles.grid} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className={styles.tick}>
                {compactMoney(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * step + (step - barW) / 2;
            let acc = 0;
            const segs = platforms
              .map((p) => ({ p, v: Math.max(0, d.values[p] ?? 0) }))
              .filter((s) => s.v > 0);
            return (
              <g key={d.key} opacity={hover === null || hover === i ? 1 : 0.45}>
                {segs.map((s, si) => {
                  const y0 = y(acc);
                  acc += s.v;
                  const y1 = y(acc);
                  const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0));
                  const isTop = si === segs.length - 1;
                  return (
                    <path
                      key={s.p}
                      d={barPath(x, y1, barW, h, isTop ? Math.min(4, barW / 2, h) : 0)}
                      fill={PLATFORM_COLORS[s.p] ?? '#8f889f'}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 8} textAnchor="middle" className={styles.tick}>
                    {d.label}
                  </text>
                )}
                <rect
                  x={padL + i * step}
                  y={padT}
                  width={step}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(Math.max(padL + hover * step + step / 2, 90), width - 90),
            top: 0
          }}
        >
          <strong>{data[hover].longLabel}</strong>
          {platforms.map((p) => (
            <div key={p} className={styles.tooltipRow}>
              <span className={styles.swatch} style={{ background: PLATFORM_COLORS[p] }} />
              <span>{PLATFORM_LABELS[p]}</span>
              <span className={styles.tooltipValue}>{money(data[hover].values[p] ?? 0)}</span>
            </div>
          ))}
          <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>
            <span />
            <span>Total</span>
            <span className={styles.tooltipValue}>{money(totals[hover])}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function barPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function SalesChart({ data }: { data: PanelResponse }) {
  const g = data.series.granularity;
  const active = PLATFORMS.filter((p) => data.series.points.some((pt) => (pt.values[p] ?? 0) > 0));
  const platforms = active.length ? [...active] : ['shopify'];
  const rows: StackDatum[] = data.series.points.map((pt) => ({
    key: pt.key,
    label: bucketLabel(pt.key, g),
    longLabel: bucketLabel(pt.key, g, true),
    values: pt.values,
    orders: pt.orders
  }));
  const unit = g === 'day' ? 'día' : g === 'week' ? 'semana' : 'mes';
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Ventas netas por {unit}</h2>
        <Legend platforms={platforms} />
      </div>
      <StackedBars data={rows} platforms={platforms} />
    </section>
  );
}

function TrendChart({ data }: { data: PanelResponse }) {
  const months = [...new Set(data.trend.map((t) => t.month))].sort();
  const platforms = PLATFORMS.filter((p) => data.trend.some((t) => t.platform === p && t.net > 0));
  const rows: StackDatum[] = months.map((m) => {
    const values: Record<string, number> = {};
    for (const t of data.trend.filter((t) => t.month === m)) values[t.platform] = t.net;
    return { key: m, label: monthLabel(m), longLabel: monthLabel(m, true), values };
  });
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Evolución de los últimos 12 meses</h2>
        <Legend platforms={platforms.length ? [...platforms] : ['shopify']} />
      </div>
      <StackedBars data={rows} platforms={platforms.length ? [...platforms] : ['shopify']} height={220} />
    </section>
  );
}

// ----------------------------- Prevision -----------------------------

function ForecastCard({ data }: { data: PanelResponse }) {
  const f = data.forecast;
  return (
    <section className={`${styles.card} ${styles.forecast}`}>
      <h2>Previsión de cierre de mes</h2>
      {!f ? (
        <p className={styles.muted}>Disponible a partir del segundo día del mes.</p>
      ) : (
        <>
          <p className={styles.forecastMonth}>{monthLabel(f.month, true)}</p>
          <p className={styles.forecastValue}>{money(f.projectedNet)}</p>
          <p className={styles.muted}>al ritmo medio del mes ({f.daysElapsed} de {f.daysInMonth} días)</p>
          <div className={styles.progress} aria-hidden>
            <span style={{ width: `${Math.min(100, (f.netToDate / Math.max(1, f.projectedNet)) * 100)}%` }} />
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Llevamos</dt>
              <dd>{money(f.netToDate)}</dd>
            </div>
            <div>
              <dt>Al ritmo de los últimos 7 días</dt>
              <dd>{money(f.projectedByLast7)}</dd>
            </div>
            <div>
              <dt>Mes anterior completo</dt>
              <dd>
                {money(f.previousMonthNet)} <Delta value={f.vsPreviousMonth} />
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

// ----------------------------- Tabla de canales -----------------------------

const SOURCE_LABEL = { api: 'real', estimated: 'estimada', missing: 'sin datos' } as const;

function ChannelTable({ data }: { data: PanelResponse }) {
  const rows = data.channels.filter((c) => PLATFORMS.includes(c.platform as (typeof PLATFORMS)[number]));
  const total = data.kpis;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Rendimiento por canal</h2>
        <span className={styles.muted}>Margen = ventas netas − comisiones − coste de producto − anuncios</span>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Canal</th>
              <th className={styles.num}>Ventas netas</th>
              <th className={styles.num}>Var.</th>
              <th>Peso</th>
              <th className={styles.num}>Pedidos</th>
              <th className={styles.num}>Ticket medio</th>
              <th className={styles.num}>Comisiones</th>
              <th className={styles.num}>Coste producto</th>
              <th className={styles.num}>Anuncios</th>
              <th className={styles.num}>Margen</th>
              <th className={styles.num}>% margen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.platform}>
                <td>
                  <span className={styles.swatch} style={{ background: PLATFORM_COLORS[c.platform] }} />
                  {PLATFORM_LABELS[c.platform] ?? c.platform}
                </td>
                <td className={styles.num}>{c.kpis.orders ? money(c.kpis.netSales) : '—'}</td>
                <td className={styles.num}>{c.kpis.orders ? <Delta value={c.delta} /> : '—'}</td>
                <td>
                  <div className={styles.shareBar}>
                    <span style={{ width: `${c.share}%`, background: PLATFORM_COLORS[c.platform] }} />
                  </div>
                  <span className={styles.shareText}>{pct(c.share, 0)}</span>
                </td>
                <td className={styles.num}>{int.format(c.kpis.orders)}</td>
                <td className={styles.num}>{c.kpis.orders ? eur2.format(c.kpis.aov) : '—'}</td>
                <td className={styles.num}>
                  {c.kpis.orders ? money(c.contribution.fees) : '—'}
                  {c.kpis.orders > 0 && <SourceTag source={c.contribution.feesSource} />}
                </td>
                <td className={styles.num}>
                  {c.kpis.orders ? money(c.contribution.productCost) : '—'}
                  {c.kpis.orders > 0 && <SourceTag source="estimated" />}
                </td>
                <td className={styles.num}>
                  {c.kpis.orders ? money(c.contribution.ads) : '—'}
                  {c.kpis.orders > 0 && <SourceTag source={c.contribution.adsSource} />}
                </td>
                <td className={styles.num}>{c.kpis.orders ? <strong>{money(c.contribution.contribution)}</strong> : '—'}</td>
                <td className={styles.num}>{pct(c.contribution.contributionRate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className={styles.num}>{money(total.netSales)}</td>
              <td className={styles.num}>
                <Delta value={data.deltas.netSales} />
              </td>
              <td />
              <td className={styles.num}>{int.format(total.orders)}</td>
              <td className={styles.num}>{eur2.format(total.aov)}</td>
              <td className={styles.num}>{money(data.channels.reduce((a, c) => a + c.contribution.fees, 0))}</td>
              <td className={styles.num}>{money(data.channels.reduce((a, c) => a + c.contribution.productCost, 0))}</td>
              <td className={styles.num}>{money(data.marketing.totalAds)}</td>
              <td className={styles.num}>
                <strong>{money(total.contribution)}</strong>
              </td>
              <td className={styles.num}>{pct(total.contributionRate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.footnote}>
        Las cifras marcadas como <em>estimada</em> usan las tasas del panel financiero de /ventas (comisión por pedido, % de
        venta y coste por unidad). Se sustituyen solas por datos reales cuando se sincronizan comisiones y publicidad.
      </p>
    </section>
  );
}

function SourceTag({ source }: { source: 'api' | 'estimated' | 'missing' }) {
  return <span className={`${styles.tag} ${styles[`tag_${source}`]}`}>{SOURCE_LABEL[source]}</span>;
}

// ----------------------------- Clientes y paises -----------------------------

function CustomersCard({ data }: { data: PanelResponse }) {
  const rows = data.customers.filter((c) => c.customers > 0);
  return (
    <section className={styles.card}>
      <h2>Clientes del periodo</h2>
      {!rows.length ? (
        <p className={styles.muted}>No hay emails de cliente en el periodo.</p>
      ) : (
        <div className={styles.customerList}>
          {rows.map((c) => {
            const returningPct = (c.returningCustomers / c.customers) * 100;
            return (
              <div key={c.platform} className={styles.customerRow}>
                <div className={styles.customerHead}>
                  <span>
                    <span className={styles.swatch} style={{ background: PLATFORM_COLORS[c.platform] }} />
                    {PLATFORM_LABELS[c.platform] ?? c.platform}
                  </span>
                  <span className={styles.muted}>{int.format(c.customers)} clientes</span>
                </div>
                <div className={styles.split} aria-hidden>
                  <span className={styles.splitNew} style={{ width: `${100 - returningPct}%` }} />
                  <span className={styles.splitReturning} style={{ width: `${returningPct}%` }} />
                </div>
                <div className={styles.customerFacts}>
                  <span>Nuevos: {int.format(c.customers - c.returningCustomers)} ({pct(100 - returningPct, 0)})</span>
                  <span>Recurrentes: {int.format(c.returningCustomers)} ({pct(returningPct, 0)})</span>
                  <span>Compran 2+ veces en el periodo: {int.format(c.multiOrderCustomers)} ({pct((c.multiOrderCustomers / c.customers) * 100, 0)})</span>
                </div>
              </div>
            );
          })}
          <p className={styles.footnote}>
            Recurrente = ya había comprado antes del periodo. Amazon suele ocultar el email del comprador, por eso puede no
            aparecer.
          </p>
        </div>
      )}
    </section>
  );
}

function CountriesCard({ data }: { data: PanelResponse }) {
  const max = Math.max(1, ...data.countries.map((c) => c.netSales));
  return (
    <section className={styles.card}>
      <h2>Ventas por país</h2>
      {!data.countries.length ? (
        <p className={styles.muted}>Sin datos de país.</p>
      ) : (
        <ul className={styles.countries}>
          {data.countries.map((c) => (
            <li key={c.country}>
              <span className={styles.countryName}>{COUNTRY_NAMES[c.country] ?? c.country}</span>
              <span className={styles.countryBar}>
                <span style={{ width: `${(c.netSales / max) * 100}%` }} />
              </span>
              <span className={styles.countryValue}>{money(c.netSales)}</span>
              <span className={styles.countryOrders}>{int.format(c.orders)} ped.</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ----------------------------- Fuentes de datos -----------------------------

function SourcesCard({ data }: { data: PanelResponse }) {
  const infos = data.alerts.filter((a) => a.level === 'info');
  const channelBy = useMemo(() => Object.fromEntries(data.channels.map((c) => [c.platform, c])), [data.channels]);
  return (
    <section className={styles.card}>
      <h2>Estado de las fuentes de datos</h2>
      <div className={styles.sources}>
        {data.freshness.map((f) => {
          const c = channelBy[f.platform];
          const ok = f.lastOrderAt && (!f.lastSyncStatus || f.lastSyncStatus === 'ok');
          const stale = f.lastOrderAt && Date.now() - new Date(f.lastOrderAt).getTime() > 48 * 3_600_000;
          const state = !f.lastOrderAt ? 'Sin conectar' : !ok || stale ? 'Revisar' : 'Sincronizando';
          const tone = !f.lastOrderAt || !ok || stale ? styles.statusBad : styles.statusOk;
          return (
            <div key={f.platform} className={styles.source}>
              <div className={styles.sourceHead}>
                <span>
                  <span className={styles.swatch} style={{ background: PLATFORM_COLORS[f.platform] }} />
                  <strong>{PLATFORM_LABELS[f.platform] ?? f.platform}</strong>
                </span>
                <span className={`${styles.status} ${tone}`}>
                  <span aria-hidden>{tone === styles.statusOk ? '●' : '▲'}</span> {state}
                </span>
              </div>
              <dl className={styles.sourceFacts}>
                <div>
                  <dt>Último pedido</dt>
                  <dd>{relativeTime(f.lastOrderAt)}</dd>
                </div>
                <div>
                  <dt>Última sincronización</dt>
                  <dd>{relativeTime(f.lastSyncRunAt)}</dd>
                </div>
                <div>
                  <dt>Comisiones</dt>
                  <dd>{c?.kpis.orders ? SOURCE_LABEL[c.contribution.feesSource] : '—'}</dd>
                </div>
                <div>
                  <dt>Publicidad</dt>
                  <dd>{c?.kpis.orders ? SOURCE_LABEL[c.contribution.adsSource] : '—'}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      {infos.length > 0 && (
        <ul className={styles.infoList}>
          {infos.map((a, i) => (
            <li key={i}>
              <strong>{a.title}.</strong> {a.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
