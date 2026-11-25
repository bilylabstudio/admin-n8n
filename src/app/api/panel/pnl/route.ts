import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { PANEL_PLATFORMS, todayInMadrid } from '@/lib/panel';
import { yearMetricsShared } from '@/lib/pnl-metrics';
import { DEFAULT_PNL_RULES, MONTH_RE, mergeRules } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const today = todayInMadrid();
  const year = Number(new URL(request.url).searchParams.get('year') || today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return Response.json({ ok: false, error: 'Año no válido' }, { status: 400 });

  // Si el calculo tarda (primera vez tras desplegar), respondemos "pendiente" y la pagina reintenta.
  const metrics = await Promise.race([
    yearMetricsShared(year, today),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
  ]);
  if (!metrics) return Response.json({ ok: false, pending: true }, { status: 202 });
  const [overrides, actuals] = await Promise.all([
    db.pnlRule.findMany(),
    db.pnlActual.findMany({ where: { month: { startsWith: `${year}-` } } })
  ]);
  return Response.json({
    ok: true,
    year,
    today,
    platforms: PANEL_PLATFORMS,
    metrics,
    rules: mergeRules(overrides.map((o) => ({ platform: o.platform, key: o.key, value: Number(o.value), active: o.active }))),
    actuals: actuals.map((a) => ({ platform: a.platform, month: a.month, key: a.key, amount: Number(a.amount) }))
  });
}

/** Guarda un supuesto ({type:'rule', platform, key, value, active}) o un gasto real ({type:'actual', platform, month, key, amount|null}). */
export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: 'Petición vacía' }, { status: 400 });
  const platform = String(body.platform ?? '');
  const key = String(body.key ?? '');
  if (!DEFAULT_PNL_RULES.some((r) => r.platform === platform && r.key === key)) {
    return Response.json({ ok: false, error: 'Concepto desconocido' }, { status: 400 });
  }

  if (body.type === 'rule') {
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return Response.json({ ok: false, error: 'Valor no válido' }, { status: 400 });
    const active = body.active !== false;
    await db.pnlRule.upsert({
      where: { platform_key: { platform, key } },
      create: { platform, key, value, active, updatedBy: user.email },
      update: { value, active, updatedBy: user.email }
    });
    return Response.json({ ok: true });
  }

  if (body.type === 'actual') {
    const month = String(body.month ?? '');
    if (!MONTH_RE.test(month)) return Response.json({ ok: false, error: 'Mes no válido' }, { status: 400 });
    if (body.amount === null || body.amount === '') {
      await db.pnlActual.deleteMany({ where: { platform, month, key } });
      return Response.json({ ok: true });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) > 100_000_000) return Response.json({ ok: false, error: 'Importe no válido' }, { status: 400 });
    await db.pnlActual.upsert({
      where: { platform_month_key: { platform, month, key } },
      create: { platform, month, key, amount, updatedBy: user.email },
      update: { amount, updatedBy: user.email }
    });
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: 'Tipo no válido' }, { status: 400 });
}
