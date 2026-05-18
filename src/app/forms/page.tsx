import { requireUser } from '@/lib/auth';
import { FormsClient } from './forms-client';

export const dynamic = 'force-dynamic';

export default async function FormsAdminPage() {
  const user = await requireUser();
  return <FormsClient userEmail={user.email} />;
}
