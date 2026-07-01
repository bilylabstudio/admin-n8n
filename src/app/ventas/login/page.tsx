import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { hasSalesSessionForUser, salesAreaPasswordConfigured } from '@/lib/sales-auth';

export const dynamic = 'force-dynamic';

export default async function SalesLoginPage({
  searchParams
}: {
  searchParams: { error?: string };
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (hasSalesSessionForUser(user.id)) redirect('/ventas');

  const configured = salesAreaPasswordConfigured();

  return (
    <main className="shell">
      <form className="panel form" action="/api/ventas/login" method="post">
        <h1>Area de ventas</h1>
        <p>Acceso interno para ventas y contabilidad.</p>
        {!configured ? (
          <p style={{ color: 'var(--danger)' }}>El acceso de ventas no esta configurado.</p>
        ) : searchParams.error ? (
          <p style={{ color: 'var(--danger)' }}>Contrasena de ventas incorrecta.</p>
        ) : null}
        <label>
          Contrasena de ventas
          <input
            autoComplete="current-password"
            className="input"
            disabled={!configured}
            name="password"
            required
            type="password"
          />
        </label>
        <button className="button" disabled={!configured} type="submit">
          Entrar a ventas
        </button>
        <a href="/">Volver al inbox</a>
      </form>
    </main>
  );
}
