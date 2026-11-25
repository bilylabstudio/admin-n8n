'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import s from './dashboard.module.css';

// Panel de negocio · Ventas (rediseño 25-nov-2026). Evolución del panel anterior (/panel/anterior),
// con los datos de /api/panel/v2 (mismas cifras verificadas + comparación, productos e insights).

// ----------------------------- Tipos -----------------------------

type Kpis = {
  netSales: number;
  grossSales: number;
  orders: number;
  units: number;
  aov: number;
  refundRate: number;
};
type Point = { key: string; values: Record<string, number>; orders: Record<string, number> };
type Channel = { platform: string; selected: boolean; kpis: Kpis; previous: Kpis; share: number; delta: number | null };
type Report = {
  orders: number;
  units: number;
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  taxes: number;
  totalSales: number;
  shipping: number;
};
type Alert = { level: 'critical' | 'warning' | 'info'; platform: string | null; title: string; detail: string };
type Data = {
  ok: true;
  range: { preset: string; current: { start: string; end: string }; previous: { start: string; end: string }; compareLabel: string; today: string };
  compare: { mode: 'previous' | 'year'; window: { start: string; end: string }; label: string };
  channel: string;
  hasPrevious: boolean;
  kpis: Kpis & { customers: number; newCustomers: number };
  previous: Kpis;
  deltas: Record<'netSales' | 'totalSales' | 'orders' | 'aov' | 'units' | 'refundRate', number | null>;
  channels: Channel[];
  shopifyReport: { current: Report; previous: Report };
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
  pulse: { month: string; daysInMonth: number; today: number; current: number[]; previous: number[] };
  insights: { tone: 'up' | 'down' | 'neutral'; text: string }[];
  series: { granularity: 'day' | 'week' | 'month'; points: Point[]; previous: Point[] };
  daily: Point[];
  products: { product: string; netSales: number; units: number; orders: number; previousNetSales: number }[];
  trend: { month: string; platform: string; orders: number; net: number }[];
  customers: { platform: string; customers: number; returningCustomers: number }[];
  countries: { country: string; orders: number; netSales: number }[];
  freshness: { platform: string; lastOrderAt: string | null; lastSyncRunAt: string | null }[];
  alerts: Alert[];
};

// ----------------------------- Constantes y formato -----------------------------

// TikTok Shop oculto de momento (ver HIDDEN_PANEL_PLATFORMS en src/lib/panel.ts).
const PLATFORMS = ['shopify', 'amazon'];
const LABEL: Record<string, string> = { shopify: 'Shopify', amazon: 'Amazon', tiktok_shop: 'TikTok Shop' };
// Orden fijo de color por canal (validado para daltonismo).
const COLOR: Record<string, string> = { shopify: '#334fb4', amazon: '#e08a2c', tiktok_shop: '#a891f6' };
const PRESETS = [
  { id: 'mtd', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'ytd', label: 'Este año' }
];
const COUNTRY: Record<string, string> = {
  ES: 'España', PT: 'Portugal', FR: 'Francia', IT: 'Italia', DE: 'Alemania', GB: 'Reino Unido', NL: 'Países Bajos',
  BE: 'Bélgica', IE: 'Irlanda', AT: 'Austria', CH: 'Suiza', US: 'Estados Unidos', MX: 'México', AD: 'Andorra',
  PL: 'Polonia', SE: 'Suecia', SK: 'Eslovaquia', LU: 'Luxemburgo', DK: 'Dinamarca', FI: 'Finlandia', CZ: 'Chequia',
  GR: 'Grecia', NO: 'Noruega', HU: 'Hungría', RO: 'Rumanía', BG: 'Bulgaria', HR: 'Croacia', SI: 'Eslovenia',
  LT: 'Lituania', LV: 'Letonia', EE: 'Estonia', CY: 'Chipre', MT: 'Malta', '??': 'Sin país'
};

const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const money = (v: number) => eur0.format(v);
const compact = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€`
    : Math.abs(v) >= 1_000
      ? `${(v / 1_000).toLocaleString('es-ES', { maximumFractionDigits: 0 })} k€`
      : eur0.format(v);
const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d })} %`;
const day = (d: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { ...o, timeZone: 'UTC' });
const monthName = (m: string, long = false) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
const bucket = (k: string, g: 'day' | 'week' | 'month', long = false) =>
  g === 'month'
    ? monthName(k, long)
    : g === 'week'
      ? `${long ? 'Semana del ' : ''}${day(k)}`
      : long
        ? day(k, { weekday: 'long', day: 'numeric', month: 'long' })
        : day(k);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "1–25 oct", "1–25 nov 2025", "1 ene – 25 nov" (año solo si no es el actual). */
function fmtRange(w: { start: string; end: string }, today: string) {
  const y = (d: string) => (d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : '');
  const dd = (d: string) => String(Number(d.slice(8, 10)));
  const mm = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  if (w.start.slice(0, 7) === w.end.slice(0, 7)) {
    return w.start === w.end ? `${dd(w.start)} ${mm(w.start)}${y(w.start)}` : `${dd(w.start)}–${dd(w.end)} ${mm(w.end)}${y(w.end)}`;
  }
  return `${dd(w.start)} ${mm(w.start)}${w.start.slice(0, 4) !== w.end.slice(0, 4) ? y(w.start) : ''} – ${dd(w.end)} ${mm(w.end)}${y(w.end)}`;
}
function shiftYearDay(d: string) {
  const y = Number(d.slice(0, 4)) - 1;
  const m = d.slice(5, 7);
  const max = new Date(Date.UTC(y, Number(m), 0)).getUTCDate();
  return `${y}-${m}-${String(Math.min(Number(d.slice(8, 10)), max)).padStart(2, '0')}`;
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const change = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
const ago = (iso: string | null) => {
  if (!iso) return 'sin datos';
  const m = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (m < 60) return `hace ${Math.max(1, Math.round(m))} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((x) => n <= x) ?? 10) * p;
}

// ----------------------------- Piezas comunes -----------------------------

export function PanelTabs({ active }: { active: 'ventas' | 'pyg' }) {
  return (
    <nav className={s.tabs} aria-label="Secciones del panel">
      <a href="/panel" className={active === 'ventas' ? s.tabActive : s.tab} aria-current={active === 'ventas' ? 'page' : undefined}>
        Ventas
      </a>
      <a href="/panel/pyg" className={active === 'pyg' ? s.tabActive : s.tab} aria-current={active === 'pyg' ? 'page' : undefined}>
        P&amp;L
      </a>
    </nav>
  );
}

function Delta({ value, unit = '%', invert = false, label }: { value: number | null; unit?: '%' | 'pp'; invert?: boolean; label?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={s.deltaNone}>sin comparación</span>;
  const flat = Math.abs(value) < 0.05;
  const good = invert ? value < 0 : value > 0;
  const n = Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (
    <span className={flat ? s.deltaFlat : good ? s.deltaUp : s.deltaDown} title={label}>
      <span aria-hidden>{flat ? '→' : value > 0 ? '↑' : '↓'}</span> {n} {unit === 'pp' ? 'pp' : '%'}
      {label ? <span className={s.srOnly}> {label}</span> : null}
    </span>
  );
}

function Spark({ values, color = 'currentColor', height = 36 }: { values: number[]; color?: string; height?: number }) {
  const id = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);
  if (values.length < 2) return null;
  const w = 160;
  const h = height;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden style={{ color, height: h }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.card} ${className ?? ''}`}>
      {title || aside ? (
        <header className={s.cardHead}>
          {title ? <h2>{title}</h2> : <span />}
          {aside ? <div className={s.cardAside}>{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ----------------------------- KPIs -----------------------------

function Kpis({ data }: { data: Data }) {
  const dNet = data.daily.map((p) => sum(p.values));
  const dOrders = data.daily.map((p) => sum(p.orders));
  const dAov = data.daily.map((p) => (sum(p.orders) ? sum(p.values) / sum(p.orders) : 0));
  const k = data.kpis;
  const p = data.previous;
  const cmp = data.compare.label;
  const cw = fmtRange(data.compare.window, data.range.today);
  const prev = (v: string) => (data.hasPrevious ? <span className={s.kpiPrev}>{cw}: {v}</span> : null);
  return (
    <section className={s.kpis} aria-label="Indicadores principales">
      <div className={`${s.kpi} ${s.kpiMain}`}>
        <span className={s.kpiLabel}>Ventas netas</span>
        <span className={s.kpiMainValue}>{money(k.netSales)}</span>
        <span className={s.kpiLine}>
          {data.hasPrevious ? <Delta value={data.deltas.netSales} label={cmp} /> : <span className={s.deltaNone}>sin comparación</span>}
          {prev(money(p.netSales))}
        </span>
        <Spark values={dNet} color="#2c8a8f" height={30} />
        <span className={s.kpiHint}>
          Sin IVA, tras descuentos y devoluciones · {money(k.grossSales)} con IVA
        </span>
      </div>
      <div className={s.kpi}>
        <span className={s.kpiLabel}>Pedidos</span>
        <span className={s.kpiValue}>{int.format(k.orders)}</span>
        <span className={s.kpiLine}>
          <Delta value={data.hasPrevious ? data.deltas.orders : null} label={cmp} />
          {prev(int.format(p.orders))}
        </span>
        <Spark values={dOrders} color="#334fb4" height={30} />
      </div>
      <div className={s.kpi}>
        <span className={s.kpiLabel}>Unidades</span>
        <span className={s.kpiValue}>{int.format(k.units)}</span>
        <span className={s.kpiLine}>
          <Delta value={data.hasPrevious ? data.deltas.units : null} label={cmp} />
          {prev(int.format(p.units))}
        </span>
        <dl className={s.kpiFacts}>
          <div><dt>Por pedido</dt><dd>{k.orders ? (k.units / k.orders).toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'}</dd></div>
          <div><dt>Precio por unidad</dt><dd>{k.units ? eur2.format(k.netSales / k.units) : '—'}</dd></div>
        </dl>
      </div>
      <div className={s.kpi}>
        <span className={s.kpiLabel}>Ticket medio</span>
        <span className={s.kpiValue}>{eur2.format(k.aov)}</span>
        <span className={s.kpiLine}>
          <Delta value={data.hasPrevious ? data.deltas.aov : null} label={cmp} />
          {prev(eur2.format(p.aov))}
        </span>
        <Spark values={dAov} color="#6b6680" height={30} />
      </div>
      <div className={s.kpi}>
        <span className={s.kpiLabel}>Devoluciones</span>
        <span className={s.kpiValue}>{pct(k.refundRate)}</span>
        <span className={s.kpiLine}>
          <Delta value={data.hasPrevious ? data.deltas.refundRate : null} unit="pp" invert label={cmp} />
          {prev(pct(p.refundRate))}
        </span>
        <div className={s.miniTrack} aria-hidden>
          <span style={{ width: `${Math.min(100, k.refundRate * 4)}%` }} />
        </div>
        <span className={s.kpiHint}>Pedidos con reembolso sobre el total</span>
      </div>
    </section>
  );
}

function Insights({ items }: { items: Data['insights'] }) {
  if (!items.length) return null;
  return (
    <ul className={s.insights} aria-label="Lo más destacado">
      {items.map((i) => (
        <li key={i.text} className={i.tone === 'up' ? s.insUp : i.tone === 'down' ? s.insDown : s.insNeutral}>
          <span className={s.insDot} aria-hidden>
            {i.tone === 'up' ? '↑' : i.tone === 'down' ? '↓' : '★'}
          </span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------- Ventas por periodo -----------------------------

function SalesChart({ data }: { data: Data }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [metric, setMetric] = useState<'net' | 'orders'>('net');
  const [showPrev, setShowPrev] = useState(true);
  const { points, previous, granularity } = data.series;
  const visible = PLATFORMS.filter((p) => data.channel === 'all' || data.channel === p);
  const val = (p: Point, pl: string) => (metric === 'net' ? p.values[pl] ?? 0 : p.orders[pl] ?? 0);
  const tot = (p: Point | undefined) => (p ? visible.reduce((a, pl) => a + val(p, pl), 0) : 0);
  const withPrev = showPrev && data.hasPrevious;
  const h = 230;
  const left = 48;
  const bottom = 24;
  const plotW = Math.max(0, width - left);
  const max = niceMax(Math.max(...points.map(tot), ...(withPrev ? previous.slice(0, points.length).map(tot) : []), 1));
  const step = points.length ? plotW / points.length : 0;
  const barW = Math.max(3, Math.min(30, step * 0.62));
  const y = (v: number) => h - bottom - (v / max) * (h - bottom - 12);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const every = Math.ceil(points.length / Math.max(1, Math.floor(plotW / 58)));
  const fmt = metric === 'net' ? compact : (v: number) => int.format(v);
  const prevPath = withPrev
    ? previous
        .slice(0, points.length)
        .map((p, i) => `${i ? 'L' : 'M'}${(left + i * step + step / 2).toFixed(1)},${y(tot(p)).toFixed(1)}`)
        .join(' ')
    : '';
  const total = points.reduce((a, p) => a + tot(p), 0);
  const best = points.reduce((b, p, i) => (tot(p) > tot(points[b] ?? p) ? i : b), 0);

  return (
    <Card
      className={s.salesCard}
      title={`${metric === 'net' ? 'Ventas netas' : 'Pedidos'} por ${granularity === 'day' ? 'día' : granularity === 'week' ? 'semana' : 'mes'} y canal`}
      aside={
        <>
          {data.hasPrevious ? (
            <label className={s.toggle}>
              <input type="checkbox" checked={showPrev} onChange={(e) => setShowPrev(e.target.checked)} />
              Comparar
            </label>
          ) : null}
          <Segmented
            label="Métrica del gráfico"
            value={metric}
            onChange={setMetric}
            options={[
              { id: 'net', label: 'Ventas' },
              { id: 'orders', label: 'Pedidos' }
            ]}
          />
        </>
      }
    >
      <p className={s.chartSummary}>
        <strong>{metric === 'net' ? money(total) : int.format(total)}</strong> en el periodo · mejor{' '}
        {granularity === 'day' ? 'día' : granularity === 'week' ? 'semana' : 'mes'}:{' '}
        <strong>{points[best] ? bucket(points[best].key, granularity, true) : '—'}</strong>
        {points[best] ? ` (${fmt(tot(points[best]))})` : ''}
      </p>
      <div className={s.chartWrap} ref={ref}>
        {width > 0 ? (
          <svg width={width} height={h} role="img" aria-label="Ventas por periodo y canal" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? s.baseline : s.grid} />
                <text x={left - 10} y={y(t) + 4} textAnchor="end" className={s.axis}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              let acc = 0;
              const x = left + i * step + (step - barW) / 2;
              const dim = hover !== null && hover !== i;
              const segs = visible.filter((pl) => val(p, pl) > 0);
              return (
                <g key={p.key} onMouseEnter={() => setHover(i)}>
                  <rect x={left + i * step} y={0} width={step} height={h - bottom} fill="transparent" />
                  {hover === i ? <rect x={left + i * step + 1} y={4} width={step - 2} height={h - bottom - 4} rx={6} className={s.hoverBand} /> : null}
                  {segs.map((pl, j) => {
                    const y0 = y(acc);
                    acc += val(p, pl);
                    const y1 = y(acc);
                    const top = j === segs.length - 1;
                    const r = top ? Math.min(5, barW / 2.5) : 0;
                    const hh = Math.max(0, y0 - y1 - (j ? 2 : 0));
                    return (
                      <path
                        key={pl}
                        d={roundedTop(x, y1, barW, hh, r)}
                        fill={COLOR[pl]}
                        opacity={dim ? 0.45 : 1}
                        className={s.bar}
                      />
                    );
                  })}
                  {i % every === 0 ? (
                    <text x={left + i * step + step / 2} y={h - 8} textAnchor="middle" className={s.axis}>
                      {bucket(p.key, granularity)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {prevPath ? <path d={prevPath} className={s.prevLine} /> : null}
          </svg>
        ) : null}
        {hover !== null && points[hover] ? (
          <div className={s.tip} style={{ left: Math.min(Math.max(left + hover * step + step / 2, 110), width - 110) }}>
            <b>{cap(bucket(points[hover].key, granularity, true))}</b>
            {visible.map((pl) => (
              <span key={pl} className={s.tipRow}>
                <i style={{ background: COLOR[pl] }} /> {LABEL[pl]} <em>{metric === 'net' ? money(val(points[hover], pl)) : int.format(val(points[hover], pl))}</em>
              </span>
            ))}
            <span className={s.tipTotal}>
              Total <em>{metric === 'net' ? money(tot(points[hover])) : int.format(tot(points[hover]))}</em>
            </span>
            {withPrev && previous[hover] ? (
              <span className={s.tipPrev}>
                Comparación <em>{metric === 'net' ? money(tot(previous[hover])) : int.format(tot(previous[hover]))}</em>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <ul className={s.legend}>
        {visible.map((pl) => (
          <li key={pl}>
            <i style={{ background: COLOR[pl] }} /> {LABEL[pl]}
          </li>
        ))}
        {withPrev ? (
          <li>
            <i className={s.legDash} /> Comparación: {fmtRange(data.compare.window, data.range.today)}
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

// ----------------------------- Previsión -----------------------------

function Forecast({ data }: { data: Data }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = data.forecast;
  const pulse = data.pulse;
  if (!f) {
    return (
      <Card title="Previsión de cierre">
        <p className={s.muted}>La previsión aparece a partir del segundo día del mes.</p>
      </Card>
    );
  }
  const h = 64;
  const days = Math.max(pulse.daysInMonth, pulse.previous.length);
  const last = pulse.current.at(-1) ?? 0;
  const max = Math.max(f.projectedNet, ...pulse.previous, last, 1) * 1.05;
  const x = (d: number) => ((d - 1) / Math.max(1, days - 1)) * width;
  const y = (v: number) => h - (v / max) * h;
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const progress = Math.min(100, (f.netToDate / f.projectedNet) * 100);
  const sameDayPrev = pulse.previous[Math.min(pulse.today, pulse.previous.length) - 1] ?? 0;
  return (
    <Card title={`Previsión de ${monthName(f.month, true).split(' ')[0]}`} className={s.forecastCard}>
      <p className={s.forecastValue}>{money(f.projectedNet)}</p>
      <p className={s.forecastSub}>
        <Delta value={f.vsPreviousMonth} /> frente a {money(f.previousMonthNet)} del mes anterior
      </p>
      <div className={s.progress} aria-label={`Llevamos el ${Math.round(progress)} % de la previsión`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className={s.progressText}>
        <strong>{money(f.netToDate)}</strong> vendidos · día {f.daysElapsed + 1} de {f.daysInMonth}
      </p>
      <div ref={ref} className={s.pulse}>
        {width > 0 ? (
          <svg width={width} height={h + 4} role="img" aria-label="Ventas acumuladas del mes frente al mes anterior">
            <path d={line(pulse.previous)} className={s.pulsePrev} />
            {pulse.today < pulse.daysInMonth ? <path d={`M${x(pulse.today)},${y(last)} L${x(pulse.daysInMonth)},${y(f.projectedNet)}`} className={s.pulseProj} /> : null}
            <path d={line(pulse.current)} className={s.pulseCur} />
            <circle cx={x(pulse.today)} cy={y(last)} r={3.5} className={s.pulseDot} />
          </svg>
        ) : null}
      </div>
      <dl className={s.facts}>
        <div>
          <dt>A estas alturas del mes pasado</dt>
          <dd>
            {money(sameDayPrev)} <Delta value={change(last, sameDayPrev)} />
          </dd>
        </div>
        <div>
          <dt>Al ritmo de los últimos 7 días</dt>
          <dd>{money(f.projectedByLast7)}</dd>
        </div>
      </dl>
      <ul className={s.legendSmall}>
        <li><i className={s.lgCur} /> Este mes</li>
        <li><i className={s.lgProj} /> Previsión</li>
        <li><i className={s.lgPrev} /> Mes anterior</li>
      </ul>
    </Card>
  );
}

// ----------------------------- Canales -----------------------------

function Channels({ data }: { data: Data }) {
  const dailyBy = (pl: string) => data.daily.map((p) => p.values[pl] ?? 0);
  return (
    <>
      {data.channels.map((c) => (
        <article key={c.platform} className={`${s.channel} ${c.selected ? '' : s.channelDim}`}>
          <header className={s.channelHead}>
            <span className={s.channelName}>
              <i style={{ background: COLOR[c.platform] }} /> {LABEL[c.platform]}
            </span>
            <span className={s.channelShare}>{pct(c.share, 0)} del total</span>
          </header>
          <div className={s.channelMain}>
            <div>
              <p className={s.channelValue}>{money(c.kpis.netSales)}</p>
              <p className={s.channelDelta}>
                {data.hasPrevious ? <Delta value={c.delta} label={data.compare.label} /> : null}
                {data.hasPrevious ? <span className={s.kpiPrev}>{fmtRange(data.compare.window, data.range.today)}: {money(c.previous.netSales)}</span> : null}
              </p>
            </div>
            <Spark values={dailyBy(c.platform)} color={COLOR[c.platform]} height={32} />
          </div>
          <div className={s.shareTrack}>
            <span style={{ width: `${c.share}%`, background: COLOR[c.platform] }} />
          </div>
          <dl className={s.channelFacts}>
            <div><dt>Pedidos</dt><dd>{int.format(c.kpis.orders)}</dd></div>
            <div><dt>Unidades</dt><dd>{int.format(c.kpis.units)}</dd></div>
            <div><dt>Ticket medio</dt><dd>{c.kpis.orders ? eur2.format(c.kpis.aov) : '—'}</dd></div>
            <div><dt>Precio por unidad</dt><dd>{c.kpis.units ? eur2.format(c.kpis.netSales / c.kpis.units) : '—'}</dd></div>
          </dl>
          <p className={s.source}>
            {c.platform === 'shopify'
              ? 'Mismo criterio que el informe de Shopify «Ventas por variante de producto».'
              : 'API de Amazon: importe de los pedidos cobrados. Amazon cuenta artículos (packs).'}
          </p>
        </article>
      ))}
    </>
  );
}

// ----------------------------- Informe Shopify -----------------------------

function ShopifyReport({ data }: { data: Data }) {
  const cur = data.shopifyReport.current;
  const prev = data.shopifyReport.previous;
  const rows: [string, keyof Report, boolean?, boolean?][] = [
    ['Ventas brutas', 'grossSales'],
    ['Descuentos', 'discounts', true],
    ['Devoluciones', 'returns', true],
    ['Ventas netas', 'netSales', false, true],
    ['Impuestos', 'taxes'],
    ['Ventas totales', 'totalSales', false, true]
  ];
  const max = Math.max(cur.grossSales, 1);
  return (
    <Card title="Informe de Shopify" aside={<span className={s.muted}>«Copia de ventas por variante de producto» · envíos aparte</span>}>
      <div className={s.reportGrid}>
        {rows.map(([label, key, neg, strong]) => {
          const d = change(cur[key], prev[key]);
          return (
            <div key={key} className={`${s.reportRow} ${strong ? s.reportStrong : ''}`}>
              <span className={s.reportLabel}>{label}</span>
              <span className={s.reportBar}>
                <i style={{ width: `${(Math.abs(cur[key]) / max) * 100}%` }} className={neg ? s.reportNeg : strong ? s.reportPos : undefined} />
              </span>
              <span className={s.reportValue}>
                {neg && cur[key] ? '−' : ''}
                {eur2.format(cur[key])}
              </span>
              <span className={s.reportDelta}>{data.hasPrevious ? <Delta value={d} invert={neg} /> : null}</span>
            </div>
          );
        })}
      </div>
      <p className={s.footnote}>
        {int.format(cur.orders)} pedidos · {int.format(cur.units)} unidades · envíos cobrados aparte: {eur2.format(cur.shipping)} (con IVA). Las
        devoluciones cuentan el día del reembolso, como en Shopify.
      </p>
    </Card>
  );
}

// ----------------------------- Evolución 12 meses -----------------------------

function Trend({ data }: { data: Data }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const months = [...new Set(data.trend.map((t) => t.month))].sort();
  const by = (m: string, p: string) => data.trend.find((t) => t.month === m && t.platform === p)?.net ?? 0;
  const visible = PLATFORMS.filter((p) => data.channel === 'all' || data.channel === p);
  const totals = months.map((m) => visible.reduce((a, p) => a + by(m, p), 0));
  const h = 160;
  const left = 48;
  const max = niceMax(Math.max(...totals, 1));
  const step = months.length ? (width - left) / months.length : 0;
  const bw = Math.min(38, step * 0.6);
  const y = (v: number) => h - (v / max) * (h - 10);
  const best = totals.indexOf(Math.max(...totals));
  return (
    <Card title="Evolución de los últimos 12 meses" aside={<span className={s.muted}>Ventas netas por mes y canal</span>}>
      <div ref={ref} className={s.chartWrap}>
        {width > 0 ? (
          <svg width={width} height={h + 26} role="img" aria-label="Ventas netas mensuales de los últimos 12 meses" onMouseLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={left} x2={width} y1={y(max * t)} y2={y(max * t)} className={t === 0 ? s.baseline : s.grid} />
                <text x={left - 10} y={y(max * t) + 4} textAnchor="end" className={s.axis}>
                  {compact(max * t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              let acc = 0;
              const x = left + i * step + (step - bw) / 2;
              const segs = visible.filter((p) => by(m, p) > 0);
              return (
                <g key={m} onMouseEnter={() => setHover(i)}>
                  <rect x={left + i * step} y={0} width={step} height={h} fill="transparent" />
                  {segs.map((p, j) => {
                    const y0 = y(acc);
                    acc += by(m, p);
                    const y1 = y(acc);
                    return (
                      <path
                        key={p}
                        d={roundedTop(x, y1, bw, Math.max(0, y0 - y1 - (j ? 2 : 0)), j === segs.length - 1 ? 5 : 0)}
                        fill={COLOR[p]}
                        opacity={hover !== null && hover !== i ? 0.45 : 1}
                        className={s.bar}
                      />
                    );
                  })}
                  {i === best ? (
                    <text x={x + bw / 2} y={y(totals[i]) - 8} textAnchor="middle" className={s.barLabel}>
                      {compact(totals[i])}
                    </text>
                  ) : null}
                  <text x={left + i * step + step / 2} y={h + 18} textAnchor="middle" className={s.axis}>
                    {step < 52
                      ? cap(new Date(`${m}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', ''))
                      : cap(monthName(m))}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : null}
        {hover !== null && months[hover] ? (
          <div className={s.tip} style={{ left: Math.min(Math.max(left + hover * step + step / 2, 110), width - 110) }}>
            <b>{cap(monthName(months[hover], true))}</b>
            {visible.map((p) => (
              <span key={p} className={s.tipRow}>
                <i style={{ background: COLOR[p] }} /> {LABEL[p]} <em>{money(by(months[hover], p))}</em>
              </span>
            ))}
            <span className={s.tipTotal}>
              Total <em>{money(totals[hover])}</em>
            </span>
            {hover > 0 ? (
              <span className={s.tipPrev}>
                vs mes anterior <em><Delta value={change(totals[hover], totals[hover - 1])} /></em>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ----------------------------- Productos, países y clientes -----------------------------

function Products({ data }: { data: Data }) {
  const [all, setAll] = useState(false);
  if (data.channel === 'amazon') {
    return (
      <Card title="Productos más vendidos">
        <p className={s.muted}>El detalle por producto solo está disponible para Shopify.</p>
      </Card>
    );
  }
  const rows = all ? data.products : data.products.slice(0, 6);
  const max = Math.max(...data.products.map((p) => p.netSales), 1);
  const total = data.products.reduce((a, p) => a + p.netSales, 0) || 1;
  return (
    <Card title="Productos más vendidos" aside={<span className={s.muted}>Shopify · sin IVA</span>}>
      <ol className={s.products}>
        {rows.map((p, i) => (
          <li key={p.product}>
            <span className={s.rank}>{i + 1}</span>
            <div className={s.productBody}>
              <div className={s.productTop}>
                <span className={s.productName} title={p.product}>
                  {p.product.replace(/^V-Gummies \| /, '')}
                </span>
                <span className={s.productValue}>{money(p.netSales)}</span>
              </div>
              <div className={s.productBottom}>
                <span className={s.productBar}>
                  <i style={{ width: `${(p.netSales / max) * 100}%` }} />
                </span>
                <span className={s.productMeta}>
                  {pct((p.netSales / total) * 100, 0)} · {int.format(p.units)} uds
                  {data.hasPrevious ? (
                    <>
                      {' · '}
                      {p.previousNetSales ? <Delta value={change(p.netSales, p.previousNetSales)} /> : <span className={s.deltaNone}>nuevo</span>}
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {data.products.length > 6 ? (
        <button type="button" className={s.linkBtn} onClick={() => setAll((v) => !v)}>
          {all ? 'Ver solo los 6 primeros' : `Ver los ${data.products.length} productos`}
        </button>
      ) : null}
    </Card>
  );
}

function Countries({ data }: { data: Data }) {
  const total = data.countries.reduce((a, c) => a + c.orders, 0) || 1;
  const max = Math.max(...data.countries.map((c) => c.orders), 1);
  return (
    <Card title="Pedidos por país">
      <ul className={s.countries}>
        {data.countries.slice(0, 7).map((c) => (
          <li key={c.country}>
            <span className={s.countryName}>{COUNTRY[c.country] ?? c.country}</span>
            <span className={s.countryBar}>
              <i style={{ width: `${(c.orders / max) * 100}%` }} />
            </span>
            <span className={s.countryValue}>{int.format(c.orders)}</span>
            <span className={s.countryPct}>{(c.orders / total) * 100 < 0.1 ? '<0,1 %' : pct((c.orders / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Customers({ data }: { data: Data }) {
  const c = data.customers.find((x) => x.platform === 'shopify');
  if (!c || !c.customers) {
    return (
      <Card title="Clientes">
        <p className={s.muted}>Amazon no comparte la identidad del comprador; los clientes se miden solo en Shopify.</p>
      </Card>
    );
  }
  const ret = (c.returningCustomers / c.customers) * 100;
  return (
    <Card title="Clientes de Shopify">
      <p className={s.bigNumber}>{int.format(c.customers)}</p>
      <p className={s.muted}>clientes distintos en el periodo</p>
      <div className={s.split} aria-hidden>
        <span style={{ width: `${100 - ret}%` }} className={s.splitNew} />
        <span style={{ width: `${ret}%` }} className={s.splitRet} />
      </div>
      <dl className={s.facts}>
        <div>
          <dt><i className={s.dotNew} /> Nuevos</dt>
          <dd>{int.format(c.customers - c.returningCustomers)} · {pct(100 - ret, 0)}</dd>
        </div>
        <div>
          <dt><i className={s.dotRet} /> Recurrentes</dt>
          <dd>{int.format(c.returningCustomers)} · {pct(ret, 0)}</dd>
        </div>
      </dl>
      <p className={s.footnote}>Recurrente: ya había comprado antes del periodo. Sin datos personales.</p>
    </Card>
  );
}

// ----------------------------- Página -----------------------------

export function PanelClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preset = params.get('preset') || (params.get('start') ? 'custom' : 'mtd');
  const compare = params.get('compare') === 'year' ? 'year' : 'previous';
  const channel = params.get('channel') || 'all';
  const [custom, setCustom] = useState({ start: params.get('start') || '', end: params.get('end') || '' });
  const [showCustom, setShowCustom] = useState(preset === 'custom');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const query = useMemo(() => {
    const q = new URLSearchParams({ compare, channel });
    if (preset === 'custom') {
      if (params.get('start')) q.set('start', params.get('start')!);
      if (params.get('end')) q.set('end', params.get('end')!);
    } else q.set('preset', preset);
    return q.toString();
  }, [preset, compare, channel, params]);

  useEffect(() => {
    if (preset === 'custom' && !params.get('start')) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      for (let attempt = 0; attempt < 25 && !cancelled; attempt++) {
        const res = await fetch(`/api/panel/v2?${query}`, { cache: 'no-store' }).catch(() => null);
        if (res && (res.status === 401 || res.status === 403)) {
          window.location.href = '/login';
          return;
        }
        const json = res && res.status !== 202 ? await res.json().catch(() => null) : null;
        if (json?.ok) {
          if (!cancelled) {
            setData(json);
            setSlow(false);
          }
          return;
        }
        if (json && !json.pending) throw new Error(json.error || 'No se pudieron cargar los datos.');
        if (!cancelled) setSlow(true);
        await new Promise((r) => setTimeout(r, 2500));
      }
      throw new Error('Los datos están tardando más de lo normal. Vuelve a intentarlo en un momento.');
    })()
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, preset, params]);

  const alerts = data?.alerts.filter((a) => a.level !== 'info') ?? [];
  const fresh = data?.freshness.filter((f) => PLATFORMS.includes(f.platform)) ?? [];
  const range = data
    ? `${day(data.range.current.start, { day: 'numeric', month: 'long' })} – ${day(data.range.current.end, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Día', ...PLATFORMS.flatMap((p) => [`${LABEL[p]} ventas netas`, `${LABEL[p]} pedidos`]), 'Total ventas netas', 'Total pedidos'],
      ...data.daily.map((p) => [p.key, ...PLATFORMS.flatMap((pl) => [p.values[pl] ?? 0, p.orders[pl] ?? 0]), Math.round(sum(p.values) * 100) / 100, sum(p.orders)])
    ];
    const text = rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c).replace('.', ',') : `"${c}"`)).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas-${data.range.current.start}_${data.range.current.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={s.page}>
      <div className={s.root}>
        <header className={s.header}>
          <div className={s.brand}>
            <span className={s.logo} aria-hidden>V</span>
            <div>
              <p className={s.eyebrow}>V-Gummies</p>
              <h1 className={s.title}>Panel de negocio</h1>
            </div>
          </div>
          <PanelTabs active="ventas" />
          <nav className={s.links}>
            <a href="/ventas">Detalle de ventas</a>
            <a href="/">Inbox</a>
          </nav>
        </header>

        <div className={s.toolbar} role="toolbar" aria-label="Filtros">
          <div className={s.chips}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={preset === p.id ? s.chipActive : s.chip}
                aria-pressed={preset === p.id}
                onClick={() => {
                  setShowCustom(false);
                  setParam({ preset: p.id, start: null, end: null });
                }}
              >
                {p.label}
              </button>
            ))}
            <button type="button" className={preset === 'custom' || showCustom ? s.chipActive : s.chip} aria-expanded={showCustom} onClick={() => setShowCustom((v) => !v)}>
              Fechas…
            </button>
          </div>
          <div className={s.toolbarRight}>
            <label className={s.select}>
              <span>Comparar con</span>
              <select value={compare} onChange={(e) => setParam({ compare: e.target.value === 'year' ? 'year' : null })}>
                <option value="previous">
                  {data
                    ? `${data.range.preset === 'ytd' ? 'Año anterior' : cap(data.range.compareLabel.replace(/^vs /, ''))} · ${fmtRange(data.range.previous, data.range.today)}`
                    : 'Periodo anterior'}
                </option>
                <option value="year">
                  {data
                    ? `Mismas fechas del año anterior · ${fmtRange({ start: shiftYearDay(data.range.current.start), end: shiftYearDay(data.range.current.end) }, data.range.today)}`
                    : 'Mismas fechas del año anterior'}
                </option>
              </select>
            </label>
            <Segmented
              label="Canal"
              value={channel}
              onChange={(v) => setParam({ channel: v === 'all' ? null : v })}
              options={[
                { id: 'all', label: 'Todos' },
                ...PLATFORMS.map((p) => ({ id: p, label: <><i className={s.dot} style={{ background: COLOR[p] }} /> {LABEL[p]}</> }))
              ]}
            />
            <button type="button" className={s.ghostBtn} onClick={exportCsv} disabled={!data}>
              Descargar CSV
            </button>
          </div>
          {showCustom ? (
            <form
              className={s.custom}
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.start && custom.end) setParam({ preset: null, start: custom.start, end: custom.end });
              }}
            >
              <label>
                Desde <input type="date" value={custom.start} max={custom.end || undefined} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} required />
              </label>
              <label>
                Hasta <input type="date" value={custom.end} min={custom.start || undefined} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} required />
              </label>
              <button type="submit" className={s.primaryBtn}>Aplicar</button>
            </form>
          ) : null}
        </div>

        <div className={s.context}>
          {data ? (
            <p>
              <strong>{range}</strong>
              <span className={s.muted}>
                {data.hasPrevious
                  ? ` · comparando con ${fmtRange(data.compare.window, data.range.today)} (${data.compare.mode === 'year' ? 'mismas fechas del año anterior' : data.compare.label.replace(/^vs /, '')})`
                  : ` · sin datos para comparar con ${fmtRange(data.compare.window, data.range.today)}${data.compare.mode === 'year' ? ' (aún no hay datos del año anterior)' : ''}`}
              </span>
            </p>
          ) : (
            <p />
          )}
          <p className={s.freshness}>
            {loading ? (
              <span className={s.loadingDot}>Actualizando…</span>
            ) : (
              fresh.map((f) => (
                <span key={f.platform}>
                  <i style={{ background: COLOR[f.platform] }} /> {LABEL[f.platform]} {ago(f.lastSyncRunAt)}
                </span>
              ))
            )}
          </p>
        </div>

        {error ? (
          <div className={s.error} role="alert">
            <strong>No se han podido cargar los datos.</strong> {error}
          </div>
        ) : null}
        {!data && !error ? (
          <div className={s.skeleton} aria-busy="true">
            {slow ? <p className={s.skeletonText}>Calculando las cifras con todos los pedidos… la primera vez tarda unos segundos.</p> : null}
          </div>
        ) : null}

        {data ? (
          <div className={loading ? s.dimmed : undefined} aria-busy={loading}>
            {alerts.length ? (
              <div className={s.alerts}>
                {alerts.map((a) => (
                  <p key={a.title} className={a.level === 'critical' ? s.alertCritical : s.alertWarning}>
                    <strong>{a.title}.</strong> {a.detail}
                  </p>
                ))}
              </div>
            ) : null}

            <Kpis data={data} />
            <Insights items={data.insights} />

            <div className={s.gridMain}>
              <SalesChart data={data} />
              <Forecast data={data} />
            </div>

            <div className={s.gridThree}>
              <Channels data={data} />
              <Customers data={data} />
            </div>

            <div className={s.gridMain}>
              <Trend data={data} />
              <Countries data={data} />
            </div>

            <div className={s.gridTwo}>
              <ShopifyReport data={data} />
              <Products data={data} />
            </div>

            <footer className={s.pageFoot}>
              <p>
                <strong>Fuentes.</strong> Shopify con el mismo criterio que su informe «Ventas por variante de producto» (sin IVA ni envíos, devoluciones el día del
                reembolso). Amazon desde su API de pedidos: importe de los pedidos cobrados; los pendientes de cobro se suman cuando Amazon los confirma.
                Fechas en hora de Madrid.
              </p>
              <a href="/panel/anterior">Ver versión anterior del panel</a>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}
