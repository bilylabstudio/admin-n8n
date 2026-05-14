import { requireUser } from '@/lib/auth';
import { InboxClient } from './inbox-client';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const user = await requireUser();
  return <InboxClient userEmail={user.email} />;
}
