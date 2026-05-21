import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await requireUser();

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'all';
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 500)));

  const where = platform !== 'all' ? { platform } : {};

  const orders = await db.platformOrder.findMany({
    where,
    orderBy: { processedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      platform: true,
      externalOrderId: true,
      orderNumber: true,
      currency: true,
      processedAt: true,
      financialStatus: true,
      fulfillmentStatus: true,
      cancelledAt: true,
      isTest: true,
      totalPrice: true,
      totalRefunded: true,
      totalUnits: true,
      customerEmail: true,
      countryCode: true,
      channel: true,
      externalUpdatedAt: true
    }
  });

  return Response.json({
    ok: true,
    platform,
    limit,
    count: orders.length,
    orders: orders.map((o) => ({
      ...o,
      processedAt: o.processedAt.toISOString(),
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      externalUpdatedAt: o.externalUpdatedAt.toISOString(),
      totalPrice: Number(o.totalPrice),
      totalRefunded: Number(o.totalRefunded)
    }))
  });
}
