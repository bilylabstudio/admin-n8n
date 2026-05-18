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
          <h1>¡Solicitud recibida! 💚</h1>
          <p>
            Nuestro equipo revisará tu caso y te responderá por email en un plazo de 24 a
            48 horas. También te enviamos una copia a {form.customerEmail}.
          </p>
        </header>

        <section className="public-form-summary">
          <p><strong>ID de solicitud:</strong> {form.id}</p>
          <p><strong>Email:</strong> {form.customerEmail}</p>
          <p><strong>Número de pedido:</strong> {form.orderNumber || '-'}</p>
          {form.purchaseEmail ? (
            <p><strong>Email de compra:</strong> {form.purchaseEmail}</p>
          ) : null}
          <p><strong>Motivo:</strong></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{form.reason || '-'}</p>
        </section>

        <p>
          <Link className="public-form-link" href="https://v-gummies.com/">
            ← Volver a v-gummies.com
          </Link>
        </p>
      </div>
    </main>
  );
}
