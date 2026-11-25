// Precalentado del panel de negocio: mantiene en caché las vistas más usadas para que
// /panel y /panel/pyg carguen al instante (el cálculo en frío tarda 15–30 s).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const g = globalThis as { __panelWarmup?: boolean };
  if (g.__panelWarmup) return;
  g.__panelWarmup = true;

  const views = [
    'compare=previous&channel=all&preset=mtd',
    'compare=previous&channel=all&preset=last_month'
  ];
  let running = false;
  const status = ((globalThis as { __panelWarmStatus?: Record<string, unknown> }).__panelWarmStatus = {
    registeredAt: new Date().toISOString(),
    runs: 0
  } as Record<string, unknown>);
  const warm = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    status.lastStart = new Date().toISOString();
    try {
      const { refreshPanelV2 } = await import('@/lib/panel-v2-build');
      const { yearMetrics } = await import('@/lib/pnl-metrics');
      const { todayInMadrid } = await import('@/lib/panel');
      const errors: string[] = [];
      for (const q of views) await refreshPanelV2(q).catch((e) => errors.push(String(e)));
      const today = todayInMadrid();
      await yearMetrics(Number(today.slice(0, 4)), today).catch((e) => errors.push(String(e)));
      status.lastErrors = errors;
      status.runs = Number(status.runs) + 1;
    } catch (e) {
      status.lastErrors = [String(e)];
    } finally {
      status.lastEnd = new Date().toISOString();
      status.lastMs = Date.now() - t0;
      running = false;
    }
  };
  setTimeout(() => void warm(), 20_000);
  setInterval(() => void warm(), 210_000);
}
