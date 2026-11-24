'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import s from './panel-v2.module.css';

// ----------------------------- Tipos -----------------------------

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
type Point = { key: string; values: Record<string, number>; orders: Record<string, number> };
type Channel = {
  platform: string;
  selected: boolean;
  kpis: Kpis;
  previous: Kpis;
  share: number;
  delta: number | null;
  contribution: {
    fees: number;
    feesSource: 'api' | 'estimated' | 'missing';
    productCost: number;
    ads: number;
    adsSource: 'api' | 'missing';
    contribution: number;
    contributionRate: number | null;
  };
};
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
  range: { preset: string; current: { start: string; end: string }; today: string };
  channel: string;
  compare: { mode: 'previous' | 'year'; window: { start: string; end: string }; label: string };
  hasPrevious: boolean;
  kpis: Kpis & { customers: number; newCustomers: number };
  previous: Kpis;
  deltas: Record<'netSales' | 'totalSales' | 'orders' | 'aov' | 'units' | 'contribution' | 'refundRate', number | null>;
  channels: Channel[];
  shopifyReport: { current: Report; previous: Report };
  waterfall: { label: string; value: number; kind: 'start' | 'minus' | 'subtotal' | 'end'; note?: string }[];
  forecast: { netToDate: number; projectedNet: number; previousMonthNet: number; vsPreviousMonth: number | null; daysElapsed: number; daysInMonth: number } | null;
  pulse: { month: string; daysInMonth: number; today: number; current: number[]; previous: number[] };
  insights: { tone: 'up' | 'down' | 'neutral'; text: string }[];
  series: { granularity: 'day' | 'week' | 'month'; points: Point[]; previous: Point[] };
  daily: Point[];
  weekdays: { weekday: string; days: number; avgNet: number; avgOrders: number; byPlatform: Record<string, number> }[];
  products: { product: string; netSales: number; units: number; orders: number; previousNetSales: number; previousUnits: number }[];
  trend: { month: string; platform: string; orders: number; net: number }[];
  customers: { platform: string; customers: number; returningCustomers: number; multiOrderCustomers: number; netSales: number }[];
  countries: { country: string; orders: number; netSales: number }[];
  freshness: { platform: string; lastOrderAt: string | null; lastSyncRunAt: string | null; lastSyncStatus: string | null; lastSyncError: string | null }[];
  alerts: Alert[];
};

// ----------------------------- Constantes y formato -----------------------------

// TikTok Shop oculto de momento (ver HIDDEN_PANEL_PLATFORMS en src/lib/panel.ts).
const PLATFORMS = ['shopify', 'amazon'];
const LABEL: Record<string, string> = { shopify: 'Shopify', amazon: 'Amazon', tiktok_shop: 'TikTok Shop' };
const COLOR: Record<string, string> = { shopify: '#334fb4', amazon: '#e08a2c', tiktok_shop: '#a891f6' };

const PRESETS = [
  { id: 'mtd', label: 'Este mes' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'ytd', label: 'Este año' },
  { id: 'custom', label: 'Fechas…' }
];
const SECTIONS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'rentabilidad', label: 'Rentabilidad' },
  { id: 'productos', label: 'Productos' },
  { id: 'clientes', label: 'Clientes y mercados' },
  { id: 'datos', label: 'Datos' }
];
const COUNTRY: Record<string, string> = {
  ES: 'España', PT: 'Portugal', FR: 'Francia', IT: 'Italia', DE: 'Alemania', GB: 'Reino Unido', NL: 'Países Bajos',
  BE: 'Bélgica', IE: 'Irlanda', AT: 'Austria', CH: 'Suiza', US: 'Estados Unidos', MX: 'México', AD: 'Andorra',
  PL: 'Polonia', SE: 'Suecia', SK: 'Eslovaquia', LU: 'Luxemburgo', DK: 'Dinamarca', FI: 'Finlandia', CZ: 'Chequia',
  GR: 'Grecia', '??': 'Sin país'
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
const month = (m: string, long = false) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
const bucket = (k: string, g: 'day' | 'week' | 'month', long = false) =>
  g === 'month' ? month(k, long) : g === 'week' ? `${long ? 'Semana del ' : ''}${day(k)}` : long ? day(k, { weekday: 'long', day: 'numeric', month: 'long' }) : day(k);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const ago = (iso: string | null) => {
  if (!iso) return 'nunca';
  const m = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (m < 60) return `hace ${Math.max(1, Math.round(m))} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const change = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows
    .map((r) => r.map((c) => (typeof c === 'number' ? String(c).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`)).join(';'))
    .join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

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

// ----------------------------- Piezas pequeñas -----------------------------

function Delta({ value, unit = '%', invert = false, label }: { value: number | null; unit?: '%' | 'pp'; invert?: boolean; label?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={s.deltaNone}>sin comparación</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  const cls = flat ? s.deltaFlat : good ? s.deltaUp : s.deltaDown;
  const arrow = flat ? '→' : value > 0 ? '↑' : '↓';
  const n = Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (
    <span className={cls} title={label}>
      <span aria-hidden>{arrow}</span> {n} {unit === 'pp' ? 'pp' : '%'}
      {label ? <span className={s.srOnly}> {label}</span> : null}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`);
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <header className={s.sectionHead}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children ? <div className={s.sectionTools}>{children}</div> : null}
    </header>
  );
}

// ----------------------------- Pulso del mes -----------------------------

function Pulse({ data }: { data: Data }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { pulse, forecast } = data;
  const h = 150;
  const days = pulse.daysInMonth;
  const projected = forecast?.projectedNet ?? pulse.current.at(-1) ?? 0;
  const max = Math.max(projected, ...pulse.previous, ...pulse.current, 1) * 1.08;
  const x = (d: number) => ((d - 1) / Math.max(1, Math.max(days, pulse.previous.length) - 1)) * width;
  const y = (v: number) => h - (v / max) * h;
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pulse.current.at(-1) ?? 0;
  const monthName = cap(month(pulse.month, true));
  const sameDayPrev = pulse.previous[Math.min(pulse.today, pulse.previous.length) - 1] ?? 0;
  const vsSameDay = change(last, sameDayPrev);

  return (
    <section className={s.pulse} aria-labelledby="pulse-title">
      <div className={s.pulseCopy}>
        <h2 id="pulse-title" className={s.pulseTitle}>
          {monthName}, día {pulse.today} de {days}
        </h2>
        <p className={s.pulseBig}>{money(last)}</p>
        <p className={s.pulseSub}>
          vendidos (netos, sin IVA){data.channel !== 'all' ? ` en ${LABEL[data.channel]}` : ''}.{' '}
          {vsSameDay !== null ? (
            <>
              A estas alturas del mes pasado llevabais {money(sameDayPrev)} (<Delta value={vsSameDay} />).
            </>
          ) : null}
        </p>
        {forecast ? (
          <dl className={s.pulseFacts}>
            <div>
              <dt>Previsión de cierre</dt>
              <dd>{money(forecast.projectedNet)}</dd>
            </div>
            <div>
              <dt>Mes anterior completo</dt>
              <dd>{money(forecast.previousMonthNet)}</dd>
            </div>
            <div>
              <dt>Ritmo diario necesario para igualarlo</dt>
              <dd>
                {forecast.daysInMonth > forecast.daysElapsed
                  ? money(Math.max(0, forecast.previousMonthNet - last) / (forecast.daysInMonth - forecast.daysElapsed))
                  : '—'}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
      <div className={s.pulseChart} ref={ref}>
        {width > 0 ? (
          <svg
            width={width}
            height={h + 22}
            role="img"
            aria-label={`Ventas acumuladas de ${monthName} frente al mes anterior`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const d = Math.round(((e.clientX - r.left) / width) * (Math.max(days, pulse.previous.length) - 1)) + 1;
              setHover(Math.max(1, Math.min(Math.max(days, pulse.previous.length), d)));
            }}
          >
            <path d={line(pulse.previous)} className={s.pulsePrev} />
            {forecast && pulse.today < days ? (
              <path d={`M${x(pulse.today)},${y(last)} L${x(days)},${y(projected)}`} className={s.pulseProj} />
            ) : null}
            <path d={line(pulse.current)} className={s.pulseCur} />
            <circle cx={x(pulse.today)} cy={y(last)} r={4} className={s.pulseDot} />
            {hover ? <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} className={s.pulseCross} /> : null}
            <text x={0} y={h + 18} className={s.pulseAxis}>1</text>
            <text x={x(days)} y={h + 18} textAnchor="end" className={s.pulseAxis}>{days}</text>
          </svg>
        ) : null}
        <ul className={s.pulseLegend}>
          <li><i className={s.legCur} /> Este mes</li>
          <li><i className={s.legProj} /> Previsión al ritmo actual</li>
          <li><i className={s.legPrev} /> Mes anterior</li>
        </ul>
        {hover ? (
          <div className={s.pulseTip} style={{ left: Math.min(Math.max(x(hover), 70), width - 70) }}>
            <b>Día {hover}</b>
            {pulse.current[hover - 1] !== undefined ? <span>Este mes: {money(pulse.current[hover - 1])}</span> : null}
            {pulse.previous[hover - 1] !== undefined ? <span>Mes anterior: {money(pulse.previous[hover - 1])}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------- KPIs -----------------------------

function KpiStrip({ data }: { data: Data }) {
  const dailyNet = data.daily.map((p) => sum(p.values));
  const dailyOrders = data.daily.map((p) => sum(p.orders));
  const dailyAov = data.daily.map((p) => (sum(p.orders) ? sum(p.values) / sum(p.orders) : 0));
  const cmp = data.compare.label;
  const items = [
    { label: 'Ventas netas', value: money(data.kpis.netSales), delta: <Delta value={data.deltas.netSales} label={cmp} />, spark: dailyNet, hint: 'Sin IVA, después de descuentos y devoluciones' },
    { label: 'Pedidos', value: int.format(data.kpis.orders), delta: <Delta value={data.deltas.orders} label={cmp} />, spark: dailyOrders },
    { label: 'Ticket medio', value: eur2.format(data.kpis.aov), delta: <Delta value={data.deltas.aov} label={cmp} />, spark: dailyAov, hint: 'Ventas netas por pedido' },
    { label: 'Unidades', value: int.format(data.kpis.units), delta: <Delta value={data.deltas.units} label={cmp} /> },
    {
      label: 'Margen de contribución',
      value: money(data.kpis.contribution),
      delta: <Delta value={data.deltas.contribution} label={cmp} />,
      hint: `${pct(data.kpis.contributionRate)} de las ventas netas · comisiones y coste estimados`
    },
    {
      label: 'Pedidos devueltos',
      value: pct(data.kpis.refundRate),
      delta: <Delta value={data.deltas.refundRate} unit="pp" invert label={cmp} />,
      hint: 'Porcentaje de pedidos con reembolso'
    }
  ];
  return (
    <div className={s.kpis}>
      {items.map((k) => (
        <div key={k.label} className={s.kpi}>
          <p className={s.kpiLabel}>{k.label}</p>
          <p className={s.kpiValue}>{k.value}</p>
          <p className={s.kpiDelta}>{data.hasPrevious ? k.delta : <span className={s.deltaNone}>sin comparación</span>}</p>
          {k.spark ? <Sparkline values={k.spark} /> : <p className={s.kpiHint}>{k.hint}</p>}
          {k.spark && k.hint ? <p className={s.kpiHint}>{k.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

function Insights({ items }: { items: Data['insights'] }) {
  if (!items.length) return null;
  return (
    <ul className={s.insights} aria-label="Lo más destacado">
      {items.map((i) => (
        <li key={i.text} className={i.tone === 'up' ? s.insUp : i.tone === 'down' ? s.insDown : s.insNeutral}>
          <span aria-hidden className={s.insMark}>{i.tone === 'up' ? '↑' : i.tone === 'down' ? '↓' : '•'}</span>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------- Gráfico de ventas -----------------------------

function SalesChart({ data, metric }: { data: Data; metric: 'net' | 'orders' }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { points, previous, granularity } = data.series;
  const visible = PLATFORMS.filter((p) => data.channel === 'all' || data.channel === p);
  const val = (p: Point, pl: string) => (metric === 'net' ? p.values[pl] ?? 0 : p.orders[pl] ?? 0);
  const tot = (p: Point | undefined) => (p ? visible.reduce((a, pl) => a + val(p, pl), 0) : 0);
  const h = 260;
  const left = 56;
  const bottom = 26;
  const plotW = Math.max(0, width - left);
  const max = Math.max(...points.map(tot), ...(data.hasPrevious ? previous.map(tot) : []), 1) * 1.1;
  const step = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(36, step - 2));
  const y = (v: number) => (h - bottom) - (v / max) * (h - bottom - 8);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor(plotW / 64)));
  const fmt = metric === 'net' ? compact : (v: number) => int.format(v);
  const prevPath = data.hasPrevious
    ? previous
        .slice(0, points.length)
        .map((p, i) => `${i ? 'L' : 'M'}${(left + i * step + step / 2).toFixed(1)},${y(tot(p)).toFixed(1)}`)
        .join(' ')
    : '';

  return (
    <div className={s.chartWrap} ref={ref}>
      {width > 0 ? (
        <svg width={width} height={h} role="img" aria-label="Ventas por periodo y canal" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} className={s.grid} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className={s.axis}>{fmt(t)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            let acc = 0;
            const cx = left + i * step + (step - barW) / 2;
            return (
              <g key={p.key} onMouseEnter={() => setHover(i)}>
                <rect x={left + i * step} y={0} width={step} height={h - bottom} fill="transparent" />
                {visible.map((pl, j) => {
                  const v = val(p, pl);
                  if (v <= 0) return null;
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const top = j === visible.length - 1 || visible.slice(j + 1).every((q) => val(p, q) <= 0);
                  return (
                    <rect
                      key={pl}
                      x={cx}
                      y={y1 + (top ? 0 : 1)}
                      width={barW}
                      height={Math.max(0, y0 - y1 - (top ? 0 : 1) - (j ? 1 : 0))}
                      rx={top ? Math.min(4, barW / 3) : 0}
                      fill={COLOR[pl]}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  );
                })}
                {i % labelEvery === 0 ? (
                  <text x={left + i * step + step / 2} y={h - 8} textAnchor="middle" className={s.axis}>{bucket(p.key, granularity)}</text>
                ) : null}
              </g>
            );
          })}
          {prevPath ? <path d={prevPath} className={s.prevLine} /> : null}
        </svg>
      ) : null}
      {hover !== null && points[hover] ? (
        <div className={s.tip} style={{ left: Math.min(Math.max(left + hover * step + step / 2, 90), width - 90) }}>
          <b>{cap(bucket(points[hover].key, granularity, true))}</b>
          {visible.map((pl) => (
            <span key={pl}>
              <i style={{ background: COLOR[pl] }} /> {LABEL[pl]}: {fmt(val(points[hover], pl))}
            </span>
          ))}
          <span className={s.tipTotal}>Total: {metric === 'net' ? money(tot(points[hover])) : int.format(tot(points[hover]))}</span>
          {data.hasPrevious && previous[hover] ? (
            <span className={s.tipPrev}>
              Comparación: {metric === 'net' ? money(tot(previous[hover])) : int.format(tot(previous[hover]))}
            </span>
          ) : null}
        </div>
      ) : null}
      <ul className={s.legend}>
        {visible.map((pl) => (
          <li key={pl}><i style={{ background: COLOR[pl] }} /> {LABEL[pl]}</li>
        ))}
        {data.hasPrevious ? <li><i className={s.legDash} /> {cap(data.compare.label.replace(/^vs /, ''))}</li> : null}
      </ul>
    </div>
  );
}

function Weekdays({ data }: { data: Data }) {
  const max = Math.max(...data.weekdays.map((w) => w.avgNet), 1);
  const best = data.weekdays.reduce((a, b) => (b.avgNet > a.avgNet ? b : a), data.weekdays[0]);
  return (
    <div className={s.weekdays}>
      <h3 className={s.h3}>Venta media por día de la semana</h3>
      <ul>
        {data.weekdays.map((w) => (
          <li key={w.weekday} title={`${w.days} ${w.days === 1 ? 'día' : 'días'} en el periodo · ${int.format(w.avgOrders)} pedidos de media`}>
            <span className={s.wdName}>{w.weekday.slice(0, 3)}</span>
            <span className={s.wdBar}>
              {PLATFORMS.filter((p) => w.byPlatform[p]).map((p) => (
                <i key={p} style={{ width: `${((w.byPlatform[p] ?? 0) / max) * 100}%`, background: COLOR[p] }} />
              ))}
            </span>
            <span className={w === best ? s.wdBest : s.wdVal}>{compact(w.avgNet)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Channels({ data }: { data: Data }) {
  return (
    <div className={s.channels}>
      {data.channels.map((c) => (
        <article key={c.platform} className={c.selected ? s.channel : `${s.channel} ${s.channelDim}`} style={{ borderTopColor: COLOR[c.platform] }}>
          <header>
            <h3>{LABEL[c.platform]}</h3>
            <span className={s.share}>{pct(c.share, 0)} del total</span>
          </header>
          <p className={s.channelBig}>{money(c.kpis.netSales)}</p>
          <p>{data.hasPrevious ? <Delta value={c.delta} label={data.compare.label} /> : null}</p>
          <dl className={s.channelFacts}>
            <div><dt>Pedidos</dt><dd>{int.format(c.kpis.orders)}</dd></div>
            <div><dt>Ticket medio</dt><dd>{eur2.format(c.kpis.aov)}</dd></div>
            <div><dt>Margen</dt><dd>{money(c.contribution.contribution)}</dd></div>
            <div><dt>Margen %</dt><dd>{pct(c.contribution.contributionRate)}</dd></div>
          </dl>
          <p className={s.source}>
            {c.platform === 'shopify'
              ? 'Mismo criterio que el informe de Shopify «Ventas por variante de producto».'
              : 'API de Amazon (SP-API): importe del pedido, solo pedidos cobrados.'}
          </p>
        </article>
      ))}
    </div>
  );
}

// ----------------------------- Rentabilidad -----------------------------

function Waterfall({ steps }: { steps: Data['waterfall'] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rowH = 34;
  const labelW = Math.min(190, width * 0.42);
  const valueW = 92;
  const plotW = Math.max(0, width - labelW - valueW);
  const max = Math.max(...steps.map((s2) => Math.abs(s2.value)), 1);
  let running = 0;
  const bars = steps.map((st) => {
    let from = 0;
    let to = st.value;
    if (st.kind === 'minus') {
      from = running;
      to = running + st.value;
      running = to;
    } else {
      running = st.value;
    }
    return { ...st, from: Math.min(from, to), to: Math.max(from, to) };
  });
  const xs = (v: number) => labelW + (v / max) * plotW;
  return (
    <div ref={ref} className={s.waterfall}>
      {width > 0 ? (
        <svg width={width} height={steps.length * rowH} role="img" aria-label="Cascada de ventas a margen de contribución">
          {bars.map((b, i) => {
            const yy = i * rowH;
            const strong = b.kind !== 'minus';
            const neg = b.kind === 'minus' && b.value < 0;
            return (
              <g key={b.label}>
                <text x={0} y={yy + rowH / 2 + 4} className={strong ? s.wfLabelStrong : s.wfLabel}>
                  {b.label}
                  {b.note ? <tspan className={s.wfNote}> ({b.note})</tspan> : null}
                </text>
                <rect
                  x={xs(Math.max(0, b.from))}
                  y={yy + 8}
                  width={Math.max(1, xs(Math.max(0, b.to)) - xs(Math.max(0, b.from)))}
                  height={rowH - 16}
                  rx={3}
                  className={b.kind === 'end' ? s.wfEnd : strong ? s.wfTotal : neg ? s.wfMinus : s.wfPlus}
                />
                <text x={width} y={yy + rowH / 2 + 4} textAnchor="end" className={strong ? s.wfValueStrong : s.wfValue}>
                  {b.kind === 'minus' && b.value > 0 ? '+' : ''}
                  {money(b.value)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}

function ShopifyReportTable({ data }: { data: Data }) {
  const cur = data.shopifyReport.current;
  const prev = data.shopifyReport.previous;
  const rows: [string, keyof Report, boolean?][] = [
    ['Ventas brutas', 'grossSales'],
    ['Descuentos', 'discounts', true],
    ['Devoluciones', 'returns', true],
    ['Ventas netas', 'netSales'],
    ['Impuestos', 'taxes'],
    ['Ventas totales', 'totalSales']
  ];
  return (
    <div>
      <h3 className={s.h3}>Informe Shopify del periodo</h3>
      <p className={s.muted}>Las mismas cifras que veis en Shopify, en «Copia de ventas por variante de producto».</p>
      <table className={s.table}>
        <thead>
          <tr><th>Concepto</th><th className={s.num}>Periodo</th>{data.hasPrevious ? <th className={s.num}>Comparación</th> : null}</tr>
        </thead>
        <tbody>
          {rows.map(([label, key, negative]) => (
            <tr key={key} className={key === 'netSales' || key === 'totalSales' ? s.rowStrong : undefined}>
              <td>{label}</td>
              <td className={s.num}>{negative && cur[key] ? '−' : ''}{eur2.format(cur[key])}</td>
              {data.hasPrevious ? <td className={s.num}>{negative && prev[key] ? '−' : ''}{eur2.format(prev[key])}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------- Productos -----------------------------

function Products({ data }: { data: Data }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'net' | 'units' | 'delta'>('net');
  const total = data.products.reduce((a, p) => a + p.netSales, 0) || 1;
  const rows = data.products
    .filter((p) => p.product.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'units' ? b.units - a.units : sort === 'delta' ? b.netSales - b.previousNetSales - (a.netSales - a.previousNetSales) : b.netSales - a.netSales
    );
  if (data.channel === 'amazon') {
    return <p className={s.empty}>El detalle por producto solo está disponible para Shopify. Cambia el canal a «Todos» o «Shopify».</p>;
  }
  return (
    <>
      <div className={s.tableTools}>
        <input className={s.search} type="search" placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar producto" />
        <div className={s.segmented} role="group" aria-label="Ordenar productos">
          {([['net', 'Ventas'], ['units', 'Unidades'], ['delta', 'Variación']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)}>{label}</button>
          ))}
        </div>
        <button
          type="button"
          className={s.ghostBtn}
          onClick={() =>
            downloadCsv(`productos-shopify-${data.range.current.start}_${data.range.current.end}.csv`, [
              ['Producto', 'Ventas netas', 'Unidades', 'Pedidos', 'Ventas netas comparación', 'Unidades comparación'],
              ...data.products.map((p) => [p.product, p.netSales, p.units, p.orders, p.previousNetSales, p.previousUnits])
            ])
          }
        >
          Descargar CSV
        </button>
      </div>
      <div className={s.tableScroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Producto</th>
              <th className={s.num}>Ventas netas</th>
              <th className={s.shareCol}>Peso</th>
              <th className={s.num}>Unidades</th>
              {data.hasPrevious ? <th className={s.num}>Variación</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.product}>
                <td className={s.prodName}>{p.product}</td>
                <td className={s.num}>{money(p.netSales)}</td>
                <td className={s.shareCol}>
                  <span className={s.shareBar}><i style={{ width: `${Math.max(1, (p.netSales / total) * 100)}%` }} /></span>
                  <span className={s.shareTxt}>{pct((p.netSales / total) * 100, 0)}</span>
                </td>
                <td className={s.num}>{int.format(p.units)}</td>
                {data.hasPrevious ? (
                  <td className={s.num}>
                    {p.previousNetSales ? <Delta value={change(p.netSales, p.previousNetSales)} /> : <span className={s.deltaNone}>nuevo</span>}
                  </td>
                ) : null}
              </tr>
            ))}
            {!rows.length ? (
              <tr><td colSpan={5} className={s.empty}>Ningún producto coincide con «{q}».</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className={s.muted}>Solo Shopify: Amazon no envía el detalle de productos en la API de pedidos. Importes sin IVA y con descuentos aplicados.</p>
    </>
  );
}

// ----------------------------- Clientes y mercados -----------------------------

function Trend({ data }: { data: Data }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const months = [...new Set(data.trend.map((t) => t.month))].sort();
  const by = (m: string, p: string) => data.trend.find((t) => t.month === m && t.platform === p)?.net ?? 0;
  const visible = PLATFORMS.filter((p) => data.channel === 'all' || data.channel === p);
  const totals = months.map((m) => visible.reduce((a, p) => a + by(m, p), 0));
  const h = 170;
  const max = Math.max(...totals, 1) * 1.1;
  const step = months.length ? width / months.length : 0;
  const bw = Math.min(34, step - 8);
  return (
    <div ref={ref} className={s.chartWrap}>
      <h3 className={s.h3}>Últimos 12 meses</h3>
      {width > 0 ? (
        <svg width={width} height={h + 22} role="img" aria-label="Ventas netas mensuales de los últimos 12 meses" onMouseLeave={() => setHover(null)}>
          {months.map((m, i) => {
            let acc = 0;
            return (
              <g key={m} onMouseEnter={() => setHover(i)}>
                <rect x={i * step} y={0} width={step} height={h} fill="transparent" />
                {visible.map((p, j) => {
                  const v = by(m, p);
                  if (v <= 0) return null;
                  const y0 = h - (acc / max) * h;
                  acc += v;
                  const y1 = h - (acc / max) * h;
                  return (
                    <rect key={p} x={i * step + (step - bw) / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - (j ? 1 : 0))} fill={COLOR[p]} rx={j === visible.length - 1 ? 3 : 0} opacity={hover === null || hover === i ? 1 : 0.55} />
                  );
                })}
                <text x={i * step + step / 2} y={h + 16} textAnchor="middle" className={s.axis}>{month(m)}</text>
              </g>
            );
          })}
        </svg>
      ) : null}
      {hover !== null && months[hover] ? (
        <div className={s.tip} style={{ left: Math.min(Math.max(hover * step + step / 2, 90), width - 90) }}>
          <b>{cap(month(months[hover], true))}</b>
          {visible.map((p) => (
            <span key={p}><i style={{ background: COLOR[p] }} /> {LABEL[p]}: {money(by(months[hover], p))}</span>
          ))}
          <span className={s.tipTotal}>Total: {money(totals[hover])}</span>
        </div>
      ) : null}
    </div>
  );
}

function Customers({ data }: { data: Data }) {
  return (
    <div>
      <h3 className={s.h3}>Clientes del periodo</h3>
      <table className={s.table}>
        <thead>
          <tr><th>Canal</th><th className={s.num}>Clientes</th><th className={s.num}>Recurrentes</th><th className={s.num}>% recurrentes</th></tr>
        </thead>
        <tbody>
          {data.customers.map((c) => (
            <tr key={c.platform}>
              <td><i className={s.dot} style={{ background: COLOR[c.platform] }} /> {LABEL[c.platform] ?? c.platform}</td>
              <td className={s.num}>{int.format(c.customers)}</td>
              <td className={s.num}>{int.format(c.returningCustomers)}</td>
              <td className={s.num}>{pct(c.customers ? (c.returningCustomers / c.customers) * 100 : null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.muted}>Recurrente: ya había comprado antes del periodo. Cuenta clientes distintos, sin datos personales. Amazon no comparte la identidad del comprador, por eso solo aparece Shopify.</p>
    </div>
  );
}

function Countries({ data }: { data: Data }) {
  const total = data.countries.reduce((a, c) => a + c.orders, 0) || 1;
  const max = Math.max(...data.countries.map((c) => c.orders), 1);
  return (
    <div>
      <h3 className={s.h3}>Pedidos por país</h3>
      <ul className={s.countries}>
        {data.countries.map((c) => (
          <li key={c.country}>
            <span>{COUNTRY[c.country] ?? c.country}</span>
            <span className={s.shareBar}><i style={{ width: `${(c.orders / max) * 100}%` }} /></span>
            <span className={s.num}>{int.format(c.orders)} <span className={s.shareTxt}>{pct((c.orders / total) * 100, c.orders / total < 0.01 ? 2 : 1)}</span></span>
          </li>
        ))}
      </ul>
      <p className={s.muted}>Diez países con más pedidos cobrados en el periodo.</p>
    </div>
  );
}

// ----------------------------- Datos -----------------------------

function DataHealth({ data }: { data: Data }) {
  const visibleAlerts = data.alerts.filter((a) => a.level !== 'info');
  return (
    <div className={s.dataGrid}>
      <div>
        <h3 className={s.h3}>Sincronización</h3>
        <table className={s.table}>
          <thead><tr><th>Fuente</th><th>Último pedido</th><th>Última sincronización</th></tr></thead>
          <tbody>
            {data.freshness.filter((f) => PLATFORMS.includes(f.platform)).map((f) => (
              <tr key={f.platform}>
                <td><i className={s.dot} style={{ background: COLOR[f.platform] }} /> {LABEL[f.platform]}</td>
                <td>{ago(f.lastOrderAt)}</td>
                <td>{ago(f.lastSyncRunAt)}{f.lastSyncStatus && f.lastSyncStatus !== 'success' ? ` · ${f.lastSyncStatus}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={s.muted}>
          Shopify se sincroniza cada 10 minutos y Amazon cada pocos minutos. Las fechas van en hora de Madrid, por fecha de pedido.
        </p>
      </div>
      <div>
        <h3 className={s.h3}>Avisos</h3>
        {visibleAlerts.length ? (
          <ul className={s.alerts}>
            {visibleAlerts.map((a) => (
              <li key={a.title} className={a.level === 'critical' ? s.alertCritical : s.alertWarning}>
                <b>{a.level === 'critical' ? 'Revisar' : 'Aviso'}: {a.title}</b>
                <span>{a.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.ok}>Sin avisos: los datos de ambos canales están completos.</p>
        )}
        <h3 className={s.h3}>Cómo se calcula</h3>
        <ul className={s.notes}>
          <li>Ventas netas: sin IVA, después de descuentos y devoluciones. Envío gratuito, no suma.</li>
          <li>Shopify cuenta todos los pedidos (también cancelados), y las devoluciones el día en que se hacen, como su informe.</li>
          <li>Amazon cuenta los pedidos cobrados. Los pendientes de cobro no tienen importe hasta que Amazon los confirma.</li>
          <li>Margen de contribución: ventas netas menos comisiones, coste de producto y publicidad. Comisiones y coste son estimados.</li>
        </ul>
      </div>
    </div>
  );
}

// ----------------------------- Página -----------------------------

export function PanelV2Client() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preset = params.get('preset') || (params.get('start') ? 'custom' : 'mtd');
  const compare = params.get('compare') === 'year' ? 'year' : 'previous';
  const channel = params.get('channel') || 'all';
  const [customStart, setCustomStart] = useState(params.get('start') || '');
  const [customEnd, setCustomEnd] = useState(params.get('end') || '');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'net' | 'orders'>('net');
  const [active, setActive] = useState('resumen');

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
    fetch(`/api/panel/v2?${query}`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/login';
          return;
        }
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudieron cargar los datos.');
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, preset, params]);

  useEffect(() => {
    if (!data) return;
    const onScroll = () => {
      let current = SECTIONS[0].id;
      for (const x of SECTIONS) {
        const el = document.getElementById(x.id);
        if (el && el.getBoundingClientRect().top <= 160) current = x.id;
      }
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [data]);

  const alertCount = data?.alerts.filter((a) => a.level !== 'info').length ?? 0;
  const stale = data?.freshness
    .filter((f) => PLATFORMS.includes(f.platform))
    .some((f) => !f.lastSyncRunAt || Date.now() - new Date(f.lastSyncRunAt).getTime() > 90 * 60_000);
  const rangeText = data
    ? `${day(data.range.current.start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${day(data.range.current.end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';

  const exportDaily = () => {
    if (!data) return;
    downloadCsv(`ventas-diarias-${data.range.current.start}_${data.range.current.end}.csv`, [
      ['Día', ...PLATFORMS.flatMap((p) => [`${LABEL[p]} ventas netas`, `${LABEL[p]} pedidos`]), 'Total ventas netas', 'Total pedidos'],
      ...data.daily.map((p) => [p.key, ...PLATFORMS.flatMap((pl) => [p.values[pl] ?? 0, p.orders[pl] ?? 0]), Math.round(sum(p.values) * 100) / 100, sum(p.orders)])
    ]);
  };

  return (
    <div className={s.shell}>
      <aside className={s.side}>
        <div className={s.brand}>
          <span className={s.brandMark} aria-hidden>V</span>
          <div>
            <p className={s.brandName}>V-Gummies</p>
            <p className={s.brandSub}>Panel de negocio</p>
          </div>
        </div>
        <nav aria-label="Secciones del panel">
          <ul className={s.nav}>
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <a href={`#${x.id}`} aria-current={active === x.id ? 'true' : undefined}>
                  {x.label}
                  {x.id === 'datos' && alertCount ? <span className={s.badge}>{alertCount}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {data ? (
          <a href="#datos" className={s.status}>
            <i className={stale || alertCount ? s.statusWarn : s.statusOk} aria-hidden />
            {stale ? 'Sincronización retrasada' : alertCount ? `${alertCount} ${alertCount === 1 ? 'aviso' : 'avisos'} en los datos` : 'Datos al día'}
          </a>
        ) : null}
      </aside>

      <main className={s.main}>
        <div className={s.filters} role="region" aria-label="Filtros">
          <div className={s.filterGroup}>
            <span className={s.filterLabel}>Periodo</span>
            <div className={s.segmented} role="group" aria-label="Periodo">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => (p.id === 'custom' ? setParam({ preset: 'custom' }) : setParam({ preset: p.id, start: null, end: null }))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {preset === 'custom' ? (
            <form
              className={s.custom}
              onSubmit={(e) => {
                e.preventDefault();
                if (customStart && customEnd) setParam({ preset: null, start: customStart, end: customEnd });
              }}
            >
              <label>Desde <input type="date" value={customStart} max={customEnd || undefined} onChange={(e) => setCustomStart(e.target.value)} required /></label>
              <label>Hasta <input type="date" value={customEnd} min={customStart || undefined} onChange={(e) => setCustomEnd(e.target.value)} required /></label>
              <button type="submit" className={s.primaryBtn}>Aplicar fechas</button>
            </form>
          ) : null}
          <div className={s.filterGroup}>
            <span className={s.filterLabel}>Comparar con</span>
            <div className={s.segmented} role="group" aria-label="Comparar con">
              <button type="button" aria-pressed={compare === 'previous'} onClick={() => setParam({ compare: null })}>Periodo anterior</button>
              <button type="button" aria-pressed={compare === 'year'} onClick={() => setParam({ compare: 'year' })}>Año anterior</button>
            </div>
          </div>
          <div className={s.filterGroup}>
            <span className={s.filterLabel}>Canal</span>
            <div className={s.segmented} role="group" aria-label="Canal">
              {['all', ...PLATFORMS].map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setParam({ channel: c === 'all' ? null : c })}>
                  {c !== 'all' ? <i className={s.dot} style={{ background: COLOR[c] }} /> : null}
                  {c === 'all' ? 'Todos' : LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <div className={s.filterEnd}>
            {loading ? <span className={s.loading} role="status">Actualizando…</span> : <span className={s.rangeText}>{rangeText}</span>}
            <button type="button" className={s.ghostBtn} onClick={exportDaily} disabled={!data}>Descargar CSV</button>
          </div>
        </div>

        {error ? (
          <div className={s.error} role="alert">
            <b>No se han podido cargar los datos.</b> {error}{' '}
            <button type="button" className={s.ghostBtn} onClick={() => router.refresh()}>Reintentar</button>
          </div>
        ) : null}

        {!data && !error ? <div className={s.skeleton} aria-busy="true">Cargando el panel…</div> : null}

        {data ? (
          <div className={loading ? `${s.content} ${s.contentLoading}` : s.content}>
            <section id="resumen" className={s.section} aria-labelledby="resumen-title">
              <h2 id="resumen-title" className={s.srOnly}>Resumen</h2>
              <Pulse data={data} />
              <div className={s.periodLine}>
                <p>
                  <b>{rangeText}</b>
                  {data.hasPrevious ? <span className={s.muted}> · comparado {data.compare.label.replace(/^vs /, 'con ')} ({day(data.compare.window.start)} – {day(data.compare.window.end, { day: 'numeric', month: 'short', year: 'numeric' })})</span> : <span className={s.muted}> · sin datos para comparar</span>}
                </p>
              </div>
              <KpiStrip data={data} />
              <Insights items={data.insights} />
            </section>

            <section id="ventas" className={s.section} aria-labelledby="ventas-title">
              <SectionHead id="ventas" title="Ventas">
                <div className={s.segmented} role="group" aria-label="Métrica del gráfico">
                  <button type="button" aria-pressed={metric === 'net'} onClick={() => setMetric('net')}>Ventas netas</button>
                  <button type="button" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>Pedidos</button>
                </div>
              </SectionHead>
              <SalesChart data={data} metric={metric} />
              <div className={s.split}>
                <Channels data={data} />
                <Weekdays data={data} />
              </div>
            </section>

            <section id="rentabilidad" className={s.section} aria-labelledby="rentabilidad-title">
              <SectionHead id="rentabilidad" title="Rentabilidad" />
              <div className={s.split}>
                <div>
                  <h3 className={s.h3}>De las ventas al margen</h3>
                  <Waterfall steps={data.waterfall} />
                  <p className={s.muted}>
                    Comisiones: {data.channels.filter((c) => c.selected).map((c) => `${LABEL[c.platform]} ${c.contribution.feesSource === 'api' ? 'reales' : 'estimadas'}`).join(', ')}.
                    {data.channels.some((c) => c.selected && c.contribution.adsSource === 'missing') ? ' La publicidad aún no está conectada.' : ''}
                  </p>
                </div>
                {data.channel !== 'amazon' ? <ShopifyReportTable data={data} /> : <p className={s.empty}>El informe de Shopify se muestra con el canal «Todos» o «Shopify».</p>}
              </div>
            </section>

            <section id="productos" className={s.section} aria-labelledby="productos-title">
              <SectionHead id="productos" title="Productos" />
              <Products data={data} />
            </section>

            <section id="clientes" className={s.section} aria-labelledby="clientes-title">
              <SectionHead id="clientes" title="Clientes y mercados" />
              <Trend data={data} />
              <div className={s.split}>
                <Customers data={data} />
                <Countries data={data} />
              </div>
            </section>

            <section id="datos" className={s.section} aria-labelledby="datos-title">
              <SectionHead id="datos" title="Datos" />
              <DataHealth data={data} />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
