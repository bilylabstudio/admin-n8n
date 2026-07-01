import { requireSalesAccess } from '@/lib/sales-auth';
import { SalesClient } from './sales-client';

export const dynamic = 'force-dynamic';

export default async function VentasPage() {
  await requireSalesAccess();
  return <SalesClient />;
}
