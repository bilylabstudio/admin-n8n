import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ConfirmationPage({ params }: { params: { token: string } }) {
  const form = await db.formSubmission.findUnique({
    where: { token: params.token },
    include: { images: { select: { id: true, filename: true, mimeType: true } } }
  });

  if (!form) {
    return (
      <main className="public-form-shell">
        <div className="public-form-card">
          <header className="public-form-header">
            <h1>Enlace no válido</h1>
          </header>
        </div>
      </main>
    );
  }

  if (form.status === 'pending') {
    redirect(`/forms/devolucion/${params.token}`);
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

          {form.images.length > 0 ? (
            <div className="public-form-thumbs">
              {form.images.map((img) => (
                <a
                  key={img.id}
                  href={`/api/forms/${form.id}/images/${img.id}?t=${encodeURIComponent(form.token)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/api/forms/${form.id}/images/${img.id}?t=${encodeURIComponent(form.token)}`}
                    alt={img.filename}
                  />
                </a>
              ))}
            </div>
          ) : null}
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
