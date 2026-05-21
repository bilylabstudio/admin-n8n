import { requireUser } from '@/lib/auth';
import { SalesClient } from './sales-client';

export const dynamic = 'force-dynamic';

export default async function VentasPage() {
  await requireUser();
  return <SalesClient />;
}
