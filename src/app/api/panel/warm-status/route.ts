import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Estado del precalentado del panel (diagnóstico interno).
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const status = (globalThis as { __panelWarmStatus?: unknown }).__panelWarmStatus ?? null;
  const store = (globalThis as { __panelV2Store?: Map<string, { at: number; ready: boolean }> }).__panelV2Store;
  return Response.json({
    ok: true,
    status,
    cache: store ? [...store.entries()].map(([k, v]) => ({ key: k, ageS: Math.round((Date.now() - v.at) / 1000), ready: v.ready })) : null
  });
}
