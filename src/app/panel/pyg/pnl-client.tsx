'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from '../panel.module.css';
import p from './pnl.module.css';
import { PanelTabs } from '../panel-client';
import {
  PNL_GROUP_LABELS,
  PNL_GROUP_ORDER,
  computePnl,
  sumPnl,
  type PnlResult,
  type PnlRule
} from '@/lib/pnl';

type Metrics = { month: string; platform: string; revenue: number; units: number; orders: number; monthFraction: number };
type Actual = { platform: string; month: string; key: string; amount: number };
type Response = { ok: true; year: number; today: string; platforms: string[]; metrics: Metrics[]; rules: PnlRule[]; actuals: Actual[] };

const LABEL: Record<string, string> = { shopify: 'Web (Shopify)', amazon: 'Amazon' };
const SHORT: Record<string, string> = { shopify: 'Web', amazon: 'Amazon' };
const COLOR: Record<string, string> = { shopify: '#334fb4', amazon: '#e08a2c' };

const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const money = (v: number) => eur0.format(v);
const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d })} %`);
const monthName = (m: string, long = false) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: long ? 'long' : 'short', timeZone: 'UTC' });
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const compact = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€`
    : `${(v / 1_000).toLocaleString('es-ES', { maximumFractionDigits: 0 })} k€`;

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

export function PnlClient() {
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (y: number | null, attempt = 0): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/panel/pnl${y ? `?year=${y}` : ''}`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login';
        return;
      }
      const json = res.status === 202 ? { ok: false, pending: true } : await res.json().catch(() => ({ ok: false, pending: true }));
      if (json.pending && attempt < 20) {
        setPending(true);
        await new Promise((r) => setTimeout(r, 3000));
        return load(y, attempt + 1);
      }
      if (!json.ok) throw new Error(json.error || 'No se pudo cargar el P&L. Vuelve a intentarlo en un momento.');
      setPending(false);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el P&L.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  const months = useMemo(() => (data ? [...new Set(data.metrics.map((m) => m.month))].sort() : []), [data]);

  // P&L por canal y mes.
  const byMonth = useMemo(() => {
    if (!data) return new Map<string, Record<string, PnlResult>>();
    const out = new Map<string, Record<string, PnlResult>>();
    for (const m of months) {
      const row: Record<string, PnlResult> = {};
      for (const platform of data.platforms) {
        const metrics = data.metrics.find((x) => x.month === m && x.platform === platform);
        const actuals = Object.fromEntries(
          data.actuals.filter((a) => a.month === m && a.platform === platform).map((a) => [a.key, a.amount])
        );
        row[platform] = computePnl(
          data.rules.filter((r) => r.platform === platform),
          metrics ?? { revenue: 0, units: 0, orders: 0, monthFraction: 0 },
          actuals
        );
      }
      out.set(m, row);
    }
    return out;
  }, [data, months]);

  const selectedMonths = month ? [month] : months;
  const perPlatform = useMemo(() => {
    const out: Record<string, PnlResult> = {};
    for (const platform of data?.platforms ?? []) {
      out[platform] = sumPnl(selectedMonths.map((m) => byMonth.get(m)?.[platform]).filter(Boolean) as PnlResult[]);
    }
    return out;
  }, [byMonth, selectedMonths, data]);
  const total = useMemo(() => sumPnl(Object.values(perPlatform)), [perPlatform]);

  const save = async (body: Record<string, unknown>, id: string) => {
    setSaving(id);
    try {
      const res = await fetch('/api/panel/pnl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'No se pudo guardar.');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setSaving(null);
    }
  };

  const saveRule = async (rule: PnlRule, patch: Partial<Pick<PnlRule, 'value' | 'active'>>) => {
    if (!data) return;
    const next = { ...rule, ...patch };
    if (await save({ type: 'rule', platform: rule.platform, key: rule.key, value: next.value, active: next.active }, `${rule.platform}:${rule.key}`)) {
      setData({ ...data, rules: data.rules.map((r) => (r.platform === rule.platform && r.key === rule.key ? next : r)) });
    }
  };

  const saveActual = async (platform: string, key: string, raw: string) => {
    if (!data || !month) return;
    const clean = raw.trim().replace(/\./g, '').replace(',', '.');
    const amount = clean === '' ? null : Number(clean);
    if (amount !== null && !Number.isFinite(amount)) {
      setError('Escribe el importe solo con números, por ejemplo 12500 o 12.500,50.');
      return;
    }
    const current = data.actuals.find((a) => a.platform === platform && a.month === month && a.key === key);
    if ((current?.amount ?? null) === amount) return;
    if (await save({ type: 'actual', platform, month, key, amount }, `${platform}:${key}:${month}`)) {
      const rest = data.actuals.filter((a) => !(a.platform === platform && a.month === month && a.key === key));
      setData({ ...data, actuals: amount === null ? rest : [...rest, { platform, month, key, amount }] });
    }
  };

  const periodText = data
    ? month
      ? `${cap(monthName(month, true))} de ${data.year}${month === data.today.slice(0, 7) ? ` (hasta el día ${Number(data.today.slice(8, 10))})` : ''}`
      : `Año ${data.year}${String(data.year) === data.today.slice(0, 4) ? ' hasta hoy' : ''}`
    : '';
  const currentYear = data ? Number(data.today.slice(0, 4)) : null;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>V-Gummies</p>
          <h1 className={styles.title}>Panel de negocio</h1>
          <PanelTabs active="pyg" />
          {data && <p className={styles.subtitle}>P&amp;L · {periodText}</p>}
        </div>
        <nav className={styles.links}>
          <a href="/ventas">Detalle de ventas</a>
          <a href="/">Inbox</a>
        </nav>
      </header>

      <div className={styles.filters} role="toolbar" aria-label="Periodo del P&L">
        <div className={styles.chips}>
          {currentYear &&
            [currentYear - 1, currentYear].map((y) => (
              <button
                key={y}
                type="button"
                className={`${styles.chip} ${data?.year === y ? styles.chipActive : ''}`}
                aria-pressed={data?.year === y}
                onClick={() => {
                  setMonth(null);
                  setYear(y);
                }}
              >
                {y}
              </button>
            ))}
          <span className={p.sep} aria-hidden />
          <button
            type="button"
            className={`${styles.chip} ${month === null ? styles.chipActive : ''}`}
            aria-pressed={month === null}
            onClick={() => setMonth(null)}
          >
            Todo el año
          </button>
          {months.map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.chip} ${month === m ? styles.chipActive : ''}`}
              aria-pressed={month === m}
              onClick={() => setMonth(m)}
            >
              {cap(monthName(m))}
            </button>
          ))}
        </div>
        <button type="button" className={`${styles.chip} ${editing ? styles.chipActive : ''}`} aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Terminar de editar' : 'Editar supuestos'}
        </button>
      </div>

      {error && (
        <div className={`${styles.alert} ${styles.alertCritical}`} role="alert">
          {error}{' '}
          <button type="button" className={p.linkBtn} onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      )}
      {!data && loading && (
        <div className={styles.loading}>
          {pending ? 'Calculando el año completo con todos los pedidos. La primera vez tarda unos segundos…' : 'Cargando el P&L…'}
        </div>
      )}

      {data && (
        <div className={loading ? styles.dimmed : undefined} aria-busy={loading}>
          {!months.length ? (
            <section className={styles.card}>
              <p className={styles.muted}>No hay ventas registradas en {data.year}.</p>
            </section>
          ) : (
            <>
              <section className={styles.kpis} aria-label="Resumen del P&L">
                <Kpi label="Facturación" value={money(total.revenue)} hint={`${SHORT.shopify} ${money(perPlatform.shopify?.revenue ?? 0)} · Amazon ${money(perPlatform.amazon?.revenue ?? 0)}`} />
                <Kpi label="Unidades" value={int.format(total.units)} hint={total.units ? `${eur2.format(total.revenue / total.units)} por unidad` : ''} />
                <Kpi label="Pedidos" value={int.format(total.orders)} hint={total.orders ? `${eur2.format(total.revenue / total.orders)} por pedido` : ''} />
                <Kpi label="Costes estimados" value={money(total.estimatedCosts)} hint={`${pct(total.revenue ? (total.estimatedCosts / total.revenue) * 100 : null)} de la facturación`} />
                <Kpi label="Margen operativo estimado" value={money(total.estimatedMargin)} sub={`${pct(total.estimatedMarginRate)} de la facturación`} hint="Con vuestros porcentajes" strong />
                <Kpi
                  label="Margen con datos reales"
                  value={total.actualLines ? money(total.blendedMargin) : '—'}
                  sub={total.actualLines ? `${pct(total.blendedMarginRate)} de la facturación` : undefined}
                  hint={total.actualLines ? 'Real donde lo hay, estimado en el resto' : month ? 'Mete el gasto real en la tabla' : 'Elige un mes para meter el gasto real'}
                />
              </section>

              {editing && (
                <div className={`${styles.alert} ${styles.alertWarning}`}>
                  <span className={styles.alertIcon} aria-hidden>i</span>
                  <div>
                    <strong>Editando supuestos.</strong>
                    <span className={styles.alertDetail}>
                      Los cambios se guardan al salir de cada casilla y se aplican a todos los meses. Desmarca un concepto para no contarlo.
                    </span>
                  </div>
                </div>
              )}

              <div className={p.channels}>
                {data.platforms.map((platform) => (
                  <ChannelPnl
                    key={platform}
                    platform={platform}
                    result={perPlatform[platform]}
                    rules={data.rules.filter((r) => r.platform === platform)}
                    month={month}
                    editing={editing}
                    saving={saving}
                    onRule={saveRule}
                    onActual={saveActual}
                  />
                ))}
              </div>

              <MonthlyCard months={months} byMonth={byMonth} selected={month} onSelect={setMonth} />

              <section className={styles.card}>
                <h2>Cómo se calcula</h2>
                <ul className={p.notes}>
                  <li>
                    <strong>Facturación:</strong> web con el criterio del informe de Shopify (ventas netas sin IVA, tras descuentos y
                    devoluciones). Amazon con el importe de los pedidos cobrados de su API.
                  </li>
                  <li>
                    <strong>Estimado:</strong> cada gasto se calcula con su supuesto: % de la facturación, € por unidad, € por pedido o
                    importe fijo al mes (prorrateado si el mes no ha terminado). La gestión de anuncios es un % de la publicidad del canal.
                  </li>
                  <li>
                    <strong>Real:</strong> al elegir un mes podéis escribir el gasto real de cada concepto. El margen con datos reales usa el
                    real donde lo hay y el estimado en el resto.
                  </li>
                  <li>
                    <strong>Diferencia:</strong> real menos estimado. En rojo si el gasto real supera al estimado.
                  </li>
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, hint, strong }: { label: string; value: string; sub?: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`${styles.kpi} ${strong ? p.kpiStrong : ''}`}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </div>
  );
}

function ChannelPnl({
  platform,
  result,
  rules,
  month,
  editing,
  saving,
  onRule,
  onActual
}: {
  platform: string;
  result: PnlResult | undefined;
  rules: PnlRule[];
  month: string | null;
  editing: boolean;
  saving: string | null;
  onRule: (rule: PnlRule, patch: Partial<Pick<PnlRule, 'value' | 'active'>>) => void;
  onActual: (platform: string, key: string, raw: string) => void;
}) {
  if (!result) return null;
  const rev = result.revenue;
  const share = (v: number) => (rev ? pct((v / rev) * 100) : '—');
  const lineByKey = new Map(result.lines.map((l) => [l.key, l]));
  const factorRule = rules.find((r) => r.kind === 'units_factor');
  const showRules = (editing ? rules : rules.filter((r) => r.active)).filter((r) => r.kind !== 'units_factor');

  return (
    <section className={styles.card} style={{ borderTop: `3px solid ${COLOR[platform]}` }}>
      <div className={styles.cardHead}>
        <h2>{LABEL[platform] ?? platform}</h2>
        <span className={styles.muted}>
          {int.format(result.units)} uds · {int.format(result.orders)} pedidos · {result.units ? eur2.format(rev / result.units) : '—'} por unidad
        </span>
      </div>
      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${p.pnl}`}>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Supuesto</th>
              <th className={styles.num}>Estimado</th>
              <th className={styles.num}>%</th>
              <th className={styles.num}>Real</th>
              <th className={styles.num}>Dif.</th>
            </tr>
          </thead>
          <tbody>
            {factorRule && (
              <tr className={factorRule.active ? undefined : p.inactive}>
                <td title={factorRule.note}>
                  {editing && (
                    <input type="checkbox" className={p.check} checked={factorRule.active} aria-label={`Usar ${factorRule.label}`} onChange={(e) => onRule(factorRule, { active: e.target.checked })} />
                  )}
                  {factorRule.label}
                  {factorRule.note && <span className={p.noteMark} aria-label={factorRule.note}> ⓘ</span>}
                </td>
                <td className={p.rule}>
                  {editing ? (
                    <RuleInput rule={factorRule} busy={saving === `${platform}:${factorRule.key}`} onSave={(v) => onRule(factorRule, { value: v })} />
                  ) : (
                    `${int.format(result.units)} artículos × ${factorRule.value.toLocaleString('es-ES')}`
                  )}
                </td>
                <td className={styles.num}>{int.format(result.costUnits)} botes</td>
                <td colSpan={3} className={p.rule}>Base de los costes por unidad</td>
              </tr>
            )}
            <tr className={p.revenueRow}>
              <td>Facturación</td>
              <td />
              <td className={styles.num}>{money(rev)}</td>
              <td className={styles.num}>100 %</td>
              <td />
              <td />
            </tr>
            {PNL_GROUP_ORDER.map((group) => {
              const groupRules = showRules.filter((r) => r.group === group);
              if (!groupRules.length) return null;
              return [
                <tr key={`g-${group}`} className={p.groupRow}>
                  <td colSpan={6}>{PNL_GROUP_LABELS[group]}</td>
                </tr>,
                ...groupRules.map((rule) => {
                  const line = lineByKey.get(rule.key);
                  const id = `${platform}:${rule.key}`;
                  const diff = line && line.actual !== null ? line.actual - line.estimated : null;
                  return (
                    <tr key={rule.key} className={rule.active ? undefined : p.inactive}>
                      <td title={rule.note}>
                        {editing && (
                          <input
                            type="checkbox"
                            className={p.check}
                            checked={rule.active}
                            aria-label={`Contar ${rule.label}`}
                            onChange={(e) => onRule(rule, { active: e.target.checked })}
                          />
                        )}
                        {rule.label}
                        {rule.note && <span className={p.noteMark} aria-label={rule.note}> ⓘ</span>}
                      </td>
                      <td className={p.rule}>
                        {editing ? (
                          <RuleInput rule={rule} busy={saving === id} onSave={(v) => onRule(rule, { value: v })} />
                        ) : (
                          line?.rule
                        )}
                      </td>
                      <td className={styles.num}>{line ? money(line.estimated) : '—'}</td>
                      <td className={`${styles.num} ${p.share}`}>{line ? share(line.estimated) : ''}</td>
                      <td className={styles.num}>
                        {month && rule.active ? (
                          <ActualInput
                            key={`${month}-${line?.actual ?? ''}`}
                            value={line?.actual ?? null}
                            label={`Gasto real de ${rule.label}`}
                            busy={saving === `${id}:${month}`}
                            onSave={(raw) => onActual(platform, rule.key, raw)}
                          />
                        ) : line?.actual !== null && line?.actual !== undefined ? (
                          money(line.actual)
                        ) : (
                          <span className={p.empty}>—</span>
                        )}
                      </td>
                      <td className={`${styles.num} ${diff === null ? '' : diff > 0 ? p.worse : p.better}`}>
                        {diff === null ? '' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}
                      </td>
                    </tr>
                  );
                })
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Costes totales</td>
              <td className={styles.num}>{money(result.estimatedCosts)}</td>
              <td className={styles.num}>{share(result.estimatedCosts)}</td>
              <td className={styles.num}>{result.actualLines ? money(result.blendedCosts) : ''}</td>
              <td />
            </tr>
            <tr className={p.marginRow}>
              <td colSpan={2}>Margen operativo</td>
              <td className={styles.num}>{money(result.estimatedMargin)}</td>
              <td className={styles.num}>{pct(result.estimatedMarginRate)}</td>
              <td className={styles.num}>{result.actualLines ? money(result.blendedMargin) : ''}</td>
              <td className={styles.num}>{result.actualLines ? pct(result.blendedMarginRate) : ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!month && <p className={styles.footnote}>Elige un mes arriba para escribir el gasto real de cada concepto.</p>}
    </section>
  );
}

function RuleInput({ rule, busy, onSave }: { rule: PnlRule; busy: boolean; onSave: (v: number) => void }) {
  const [value, setValue] = useState(String(rule.value).replace('.', ','));
  const unit = rule.kind === 'pct_revenue' ? '% fact.' : rule.kind === 'pct_ads' ? '% publi.' : rule.kind === 'per_unit' ? '€/ud' : rule.kind === 'per_order' ? '€/pedido' : rule.kind === 'units_factor' ? 'botes' : '€/mes';
  return (
    <span className={p.inputWrap}>
      <input
        className={p.input}
        inputMode="decimal"
        value={value}
        disabled={busy}
        aria-label={`Supuesto de ${rule.label}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const n = Number(value.replace(/\./g, '').replace(',', '.'));
          if (Number.isFinite(n) && n >= 0 && n !== rule.value) onSave(n);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className={p.unit}>{unit}</span>
    </span>
  );
}

function ActualInput({ value, label, busy, onSave }: { value: number | null; label: string; busy: boolean; onSave: (raw: string) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  return (
    <input
      className={`${p.input} ${p.actual}`}
      inputMode="decimal"
      placeholder="Real €"
      value={text}
      disabled={busy}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function MonthlyCard({
  months,
  byMonth,
  selected,
  onSelect
}: {
  months: string[];
  byMonth: Map<string, Record<string, PnlResult>>;
  selected: string | null;
  onSelect: (m: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const rows = months.map((m) => ({ month: m, ...sumPnl(Object.values(byMonth.get(m) ?? {})) }));
  const h = 220;
  const left = 52;
  const max = Math.max(...rows.map((r) => r.revenue), 1) * 1.08;
  const step = rows.length ? (width - left) / rows.length : 0;
  const bw = Math.min(40, step * 0.6);
  const y = (v: number) => h - (Math.max(0, v) / max) * h;
  const ticks = [0, 0.5, 1].map((t) => max * t);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Evolución mensual</h2>
        <ul className={styles.legend}>
          <li><span className={styles.swatch} style={{ background: '#63b2b7' }} /> Margen estimado</li>
          <li><span className={styles.swatch} style={{ background: '#d9d6e0' }} /> Costes estimados</li>
          <li><span className={p.realSwatch} /> Margen con datos reales</li>
        </ul>
      </div>
      <div ref={ref} className={styles.chartWrap}>
        {width > 0 && (
          <svg width={width} height={h + 24} role="img" aria-label="Facturación, costes y margen estimados por mes" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={width} y1={y(t)} y2={y(t)} className={p.grid} />
                <text x={left - 8} y={y(t) + 4} textAnchor="end" className={styles.axis}>{compact(t)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = left + i * step + (step - bw) / 2;
              const margin = Math.max(0, r.estimatedMargin);
              return (
                <g key={r.month} onMouseEnter={() => setHover(i)} onClick={() => onSelect(r.month)} style={{ cursor: 'pointer' }}>
                  <rect x={left + i * step} y={0} width={step} height={h} fill="transparent" />
                  <rect x={x} y={y(r.revenue)} width={bw} height={Math.max(0, y(margin) - y(r.revenue) - 1)} rx={3} fill="#d9d6e0" opacity={selected && selected !== r.month ? 0.5 : 1} />
                  <rect x={x} y={y(margin)} width={bw} height={h - y(margin)} fill="#63b2b7" opacity={selected && selected !== r.month ? 0.5 : 1} />
                  {r.actualLines > 0 && <line x1={x - 4} x2={x + bw + 4} y1={y(r.blendedMargin)} y2={y(r.blendedMargin)} className={p.realLine} />}
                  <text x={left + i * step + step / 2} y={h + 16} textAnchor="middle" className={styles.axis}>{cap(monthName(r.month))}</text>
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && rows[hover] && (
          <div className={styles.tooltip} style={{ left: Math.min(Math.max(left + hover * step + step / 2, 100), width - 100), top: 0 }}>
            <strong>{cap(monthName(rows[hover].month, true))}</strong>
            <span>Facturación: {money(rows[hover].revenue)}</span>
            <span>Costes estimados: {money(rows[hover].estimatedCosts)}</span>
            <span>Margen estimado: {money(rows[hover].estimatedMargin)} ({pct(rows[hover].estimatedMarginRate)})</span>
            {rows[hover].actualLines > 0 && <span>Margen con datos reales: {money(rows[hover].blendedMargin)}</span>}
          </div>
        )}
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Mes</th>
              <th className={styles.num}>Facturación</th>
              <th className={styles.num}>Unidades</th>
              <th className={styles.num}>Pedidos</th>
              <th className={styles.num}>Costes estimados</th>
              <th className={styles.num}>Margen estimado</th>
              <th className={styles.num}>%</th>
              <th className={styles.num}>Margen con reales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className={selected === r.month ? p.selectedRow : p.clickRow} onClick={() => onSelect(r.month)}>
                <td>
                  <button type="button" className={p.linkBtn} onClick={() => onSelect(r.month)}>
                    {cap(monthName(r.month, true))}
                  </button>
                </td>
                <td className={styles.num}>{money(r.revenue)}</td>
                <td className={styles.num}>{int.format(r.units)}</td>
                <td className={styles.num}>{int.format(r.orders)}</td>
                <td className={styles.num}>{money(r.estimatedCosts)}</td>
                <td className={styles.num}><strong>{money(r.estimatedMargin)}</strong></td>
                <td className={styles.num}>{pct(r.estimatedMarginRate)}</td>
                <td className={styles.num}>{r.actualLines ? money(r.blendedMargin) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
