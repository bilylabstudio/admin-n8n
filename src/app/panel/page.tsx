import { requireSalesAccess } from '@/lib/sales-auth';
import { PanelClient } from './panel-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Panel de negocio · V-Gummies' };

export default async function PanelPage() {
  await requireSalesAccess();
  return <PanelClient />;
}
