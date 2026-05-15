import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function addEmail(data: FormData) {
  'use server';
  const email = String(data.get('email') || '').trim().toLowerCase();
  const reason = String(data.get('reason') || '').trim();
  if (!email || !email.includes('@')) {
    redirect('/blocklist?error=Email+inv%C3%A1lido');
  }
  await db.blockedEmail.upsert({
    where: { email },
    create: { email, reason },
    update: { reason }
  });
  redirect('/blocklist?success=Correo+bloqueado+correctamente');
}

async function deleteEmail(data: FormData) {
  'use server';
  const id = String(data.get('id') || '');
  if (!id) redirect('/blocklist');
  await db.blockedEmail.delete({ where: { id } });
  redirect('/blocklist?success=Correo+desbloqueado');
}

export default async function BlocklistPage({
  searchParams
}: {
  searchParams: { error?: string; success?: string };
}) {
  await requireUser();

  const blocked = await db.blockedEmail.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <main className="shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
            style={{ width: 90, height: 'auto' }}
          />
          <h1>Lista negra de correos</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#5f596d' }}>
          <Link href="/">← Volver al inbox</Link>
          <a href="/logout">Salir</a>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 680 }}>
        {searchParams.error ? (
          <p style={{ color: 'var(--error-red)', marginBottom: 12 }}>
            Error: {decodeURIComponent(searchParams.error)}
          </p>
        ) : null}
        {searchParams.success ? (
          <p style={{ color: '#347d83', marginBottom: 12 }}>
            {decodeURIComponent(searchParams.success)}
          </p>
        ) : null}

        <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 15 }}>Añadir correo bloqueado</h2>
          <form action={addEmail} style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label
                style={{
                  display: 'grid',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#8f889f',
                  textTransform: 'uppercase'
                }}
              >
                Email *
                <input
                  className="input"
                  name="email"
                  type="email"
                  required
                  placeholder="no-responder@dominio.com"
                />
              </label>
              <label
                style={{
                  display: 'grid',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#8f889f',
                  textTransform: 'uppercase'
                }}
              >
                Motivo (opcional)
                <input
                  className="input"
                  name="reason"
                  type="text"
                  placeholder="Spam, bot, competencia..."
                />
              </label>
            </div>
            <div>
              <button className="button" type="submit">
                Bloquear correo
              </button>
            </div>
          </form>
        </section>

        <section className="panel" style={{ padding: 20 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 15 }}>
            Correos bloqueados
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#8f889f' }}>
              ({blocked.length})
            </span>
          </h2>

          {!blocked.length ? (
            <div className="empty-state">No hay correos en la lista negra.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Motivo</th>
                  <th>Fecha</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {blocked.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontWeight: 600 }}>{entry.email}</td>
                    <td style={{ color: '#5f596d' }}>{entry.reason || '—'}</td>
                    <td style={{ color: '#8f889f', whiteSpace: 'nowrap' }}>
                      {new Intl.DateTimeFormat('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit'
                      }).format(new Date(entry.createdAt))}
                    </td>
                    <td>
                      <form action={deleteEmail}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button
                          className="button danger"
                          type="submit"
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Eliminar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
