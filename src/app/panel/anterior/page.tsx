import { requireUser } from '@/lib/auth';
import { PanelClient } from '../panel-client-v1';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Panel de negocio (anterior) · V-Gummies' };

// Version anterior del panel de ventas, conservada para comparar o volver atras.
export default async function PanelAnteriorPage() {
  await requireUser();
  return <PanelClient />;
}
