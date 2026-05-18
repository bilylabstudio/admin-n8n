import Link from 'next/link';
import { db } from '@/lib/db';
import { isFormTokenValid } from '@/lib/forms';
import { FormClient } from './form-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PublicFormPage({ params }: { params: { token: string } }) {
  const form = await db.formSubmission.findUnique({ where: { token: params.token } });

  if (!form) {
    return (
      <main className="public-form-shell">
        <div className="public-form-card">
          <header className="public-form-header">
            <img
              src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
              alt="V-gummies"
            />
            <h1>Enlace no válido</h1>
          </header>
          <p>El enlace que abriste no corresponde a ninguna solicitud activa. Comprueba que copiaste la URL completa o contacta a soporte.</p>
        </div>
      </main>
    );
  }

  const validity = isFormTokenValid(form);
  if (!validity.ok && validity.reason === 'expired') {
    return (
      <main className="public-form-shell">
        <div className="public-form-card">
          <header className="public-form-header">
            <img
              src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
              alt="V-gummies"
            />
            <h1>Enlace expirado</h1>
          </header>
          <p>
            Este enlace caducó. Si todavía quieres tramitar tu devolución, responde al
            último email de soporte y te enviaremos uno nuevo.
          </p>
        </div>
      </main>
    );
  }

  if (!validity.ok && validity.reason === 'already_submitted') {
    return (
      <main className="public-form-shell">
        <div className="public-form-card">
          <header className="public-form-header">
            <img
              src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
              alt="V-gummies"
            />
            <h1>Ya recibimos tu solicitud</h1>
          </header>
          <p>
            Nuestro equipo está revisando los datos que enviaste. Recibirás respuesta por
            email en un plazo de 24 a 48 horas.
          </p>
          <p>
            <Link className="public-form-link" href={`/forms/devolucion/${params.token}/confirmacion`}>
              Ver el resumen de mi solicitud →
            </Link>
          </p>
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
          <h1>Solicitud de devolución</h1>
          <p>
            Completa los datos para que nuestro equipo revise tu caso. Te responderemos
            por email en un plazo de 24 a 48 horas.
          </p>
        </header>
        <FormClient token={params.token} customerEmail={form.customerEmail} />
      </div>
    </main>
  );
}
