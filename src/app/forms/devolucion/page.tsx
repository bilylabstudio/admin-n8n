import { FormClient } from './form-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function PublicFormPage() {
  return (
    <main className="public-form-shell">
      <div className="public-form-card">
        <header className="public-form-header">
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
          />
          <h1>Solicitud de devolucion</h1>
          <p>
            Completa los datos del pedido y adjunta evidencia para que nuestro equipo revise
            tu caso. Te responderemos por email en un plazo de 24 a 48 horas.
          </p>
        </header>
        <FormClient />
      </div>
    </main>
  );
}
