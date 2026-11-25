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
  const warm = async () => {
    if (running) return;
    running = true;
    try {
      const { refreshPanelV2 } = await import('@/lib/panel-v2-build');
      const { yearMetrics } = await import('@/lib/pnl-metrics');
      const { todayInMadrid } = await import('@/lib/panel');
      for (const q of views) await refreshPanelV2(q).catch(() => undefined);
      const today = todayInMadrid();
      await yearMetrics(Number(today.slice(0, 4)), today).catch(() => undefined);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void warm(), 20_000);
  setInterval(() => void warm(), 210_000);
}
