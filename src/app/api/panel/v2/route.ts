import { currentUser } from '@/lib/auth';
import { getPanelV2 } from '@/lib/panel-v2-build';

export const dynamic = 'force-dynamic';

// El calculo en frio puede tardar mas de lo que aguanta el proxy: si tarda, respondemos "pendiente" (202)
// y la pagina reintenta. Las vistas principales se mantienen calientes desde src/instrumentation.ts.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  const result = await Promise.race([getPanelV2(new URL(request.url)), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
  if (!result) return Response.json({ ok: false, pending: true }, { status: 202 });
  return Response.json(result.body, { status: result.status });
}
