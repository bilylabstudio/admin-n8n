import { requireUser } from '@/lib/auth';
import { PnlClient } from './pnl-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'P&L · Panel de negocio · V-Gummies' };

export default async function PnlPage() {
  await requireUser();
  return <PnlClient />;
}
