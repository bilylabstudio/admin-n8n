import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { PanelV2Client } from './panel-v2-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Panel de negocio · V-Gummies' };

// Nueva version del panel financiero. /panel (v1) sigue intacto.
export default async function PanelV2Page() {
  await requireUser();
  return (
    <Suspense>
      <PanelV2Client />
    </Suspense>
  );
}
