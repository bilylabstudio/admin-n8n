import { requireUser } from '@/lib/auth';
import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireUser();
  return <DashboardClient />;
}
