import Link from 'next/link';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ConfirmationPage({ params }: { params: { id: string } }) {
  const form = await db.formSubmission.findUnique({ where: { id: params.id } });

  if (!form) {
    return (
      <main className="public-form-shell">
        <div className="public-form-card">
          <header className="public-form-header">
            <h1>Solicitud no encontrada</h1>
          </header>
          <p>El identificador no corresponde a ninguna solicitud.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="public-form-shell">
      <div className="public-form-card">
        <header className="public-form-header">
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
          />
          <h1>Solicitud enviada</h1>
          <p>El caso quedo registrado para revision del equipo.</p>
        </header>

        <section className="public-form-summary">
          <p>
            <strong>ID de solicitud:</strong> {form.id}
          </p>
          <p>
            <strong>Email de compra:</strong> {form.purchaseEmail || form.customerEmail}
          </p>
          <p>
            <strong>Numero de pedido:</strong> {form.orderNumber || '-'}
          </p>
        </section>

        <p>
          <Link className="public-form-link" href="/forms/devolucion">
            Enviar otra solicitud
          </Link>
        </p>
      </div>
    </main>
  );
}
