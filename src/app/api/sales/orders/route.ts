import { db } from '@/lib/db';
import { requireSalesApiAccess } from '@/lib/sales-auth';
import { resolveSalesDateRange } from '@/lib/sales';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const accessError = await requireSalesApiAccess();
  if (accessError) return accessError;

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'all';
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(
    100,
    parsePositiveInt(url.searchParams.get('pageSize') || url.searchParams.get('limit'), 50)
  );
  const query = (url.searchParams.get('q') || '').trim();
  const financialStatus = (url.searchParams.get('financialStatus') || '').trim();
  const channel = (url.searchParams.get('channel') || '').trim();
  const country = (url.searchParams.get('country') || '').trim().toUpperCase();
  const range = resolveSalesDateRange({
    periodParam: url.searchParams.get('period'),
    startParam: url.searchParams.get('start'),
    endParam: url.searchParams.get('end')
  });

  if (!range.ok) {
    return Response.json({ ok: false, error: range.error }, { status: 400 });
  }

  const where: Prisma.PlatformOrderWhereInput = {
    processedAt: { gte: range.since, lte: range.until },
    cancelledAt: null,
    isTest: false,
    ...(platform !== 'all' ? { platform } : {}),
    ...(financialStatus ? { financialStatus } : {}),
    ...(channel ? { channel: { contains: channel, mode: 'insensitive' } } : {}),
    ...(country ? { countryCode: { equals: country, mode: 'insensitive' } } : {}),
    ...(query
      ? {
          OR: [
            { externalOrderId: { contains: query, mode: 'insensitive' } },
            { orderNumber: { contains: query, mode: 'insensitive' } },
            { customerEmail: { contains: query, mode: 'insensitive' } }
          ]
        }
      : {})
  };

  const total = await db.platformOrder.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const orders = await db.platformOrder.findMany({
    where,
    orderBy: { processedAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
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
    limit: pageSize,
    total,
    page,
    pageSize,
    totalPages,
    period: range.period,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    startDate: range.startDate,
    endDate: range.endDate,
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

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
