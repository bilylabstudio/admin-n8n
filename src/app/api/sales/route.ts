import { requireUser } from '@/lib/auth';
import {
  aggregate,
  isPeriod,
  sinceForPeriod,
  viewSyncState,
  type Period,
  type RawOrder,
  type RawSyncState
} from '@/lib/sales';

export const dynamic = 'force-dynamic';

type N8nPayload = {
  ok?: boolean;
  since?: string;
  until?: string;
  orders?: RawOrder[];
  syncState?: RawSyncState[];
  error?: string;
};

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const periodParam = url.searchParams.get('period');
  const period: Period = isPeriod(periodParam) ? periodParam : 'ytd';
  const platform = url.searchParams.get('platform') || 'all';

  const webhookUrl = process.env.N8N_SALES_WEBHOOK_URL;
  const secret = process.env.N8N_SALES_SECRET;
  if (!webhookUrl || !secret) {
    return Response.json({ ok: false, error: 'sales_webhook_not_configured' }, { status: 500 });
  }

  const fetchUrl = `${webhookUrl}?period=${encodeURIComponent(period)}&platform=${encodeURIComponent(platform)}`;
  let raw: N8nPayload;
  try {
    const res = await fetch(fetchUrl, {
      headers: { 'X-Webhook-Secret': secret },
      cache: 'no-store'
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: 'n8n_unreachable', status: res.status }, { status: 502 });
    }
    raw = (await res.json()) as N8nPayload;
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'fetch_failed' },
      { status: 502 }
    );
  }

  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  const syncState = Array.isArray(raw.syncState) ? raw.syncState : [];
  const { kpis, byDay, byPlatform } = aggregate(orders);

  const since = raw.since || sinceForPeriod(period).toISOString();
  const until = raw.until || new Date().toISOString();

  return Response.json({
    ok: true,
    period,
    platform,
    since,
    until,
    syncState: viewSyncState(syncState),
    kpis,
    byDay,
    byPlatform
  });
}
