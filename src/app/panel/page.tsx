import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { PanelClient } from './panel-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Panel de negocio · V-Gummies' };

// De momento /panel solo exige el login normal del inbox (sin la contraseña del area de ventas).
// Para volver a exigirla: usar requireSalesAccess() de '@/lib/sales-auth'.
export default async function PanelPage() {
  await requireUser();
  return (
    <Suspense>
      <PanelClient />
    </Suspense>
  );
}
