import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { canReview } from '@/lib/status';

export const dynamic = 'force-dynamic';

export default async function TicketDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requireUser();
  const ticket = await db.ticket.findUnique({
    where: { id: params.id },
    include: {
      auditEvents: {
        orderBy: { createdAt: 'desc' },
        include: { user: true }
      }
    }
  });

  if (!ticket) notFound();
  const reviewable = canReview(ticket.status);

  return (
    <main className="shell">
      <header className="topbar">
        <h1>Ticket</h1>
        <div>{user.email} - <Link href="/">Inbox</Link> - <a href="/logout">Salir</a></div>
      </header>
      <section className="container">
        {searchParams.error ? <p style={{ color: 'var(--danger)' }}>Error: {searchParams.error}</p> : null}
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <h2>{ticket.subject}</h2>
          <p>{ticket.customerEmail} - <span className="badge">{ticket.status}</span></p>
          <p>Categoria: {ticket.category || '-'} - Intencion: {ticket.intent || '-'} - Riesgo: {ticket.riskFlags || '-'}</p>
          {ticket.sendError ? <p style={{ color: 'var(--danger)' }}>Ultimo error de envio: {ticket.sendError}</p> : null}
        </div>
        <div className="grid-2">
          <section className="panel" style={{ padding: 16 }}>
            <h3>Email original</h3>
            <div className="pre">{ticket.originalText}</div>
          </section>
          <section className="panel" style={{ padding: 16 }}>
            <h3>Respuesta IA</h3>
            <div className="pre">{ticket.aiReply}</div>
          </section>
        </div>
        <section className="panel" style={{ padding: 16, marginTop: 16 }}>
          <h3>Respuesta final</h3>
          <form action={`/api/tickets/${ticket.id}/send-edited`} method="post">
            <textarea className="textarea" name="final_reply" defaultValue={ticket.finalReply || ticket.aiReply} disabled={!reviewable} />
            <div className="actions">
              <button className="button success" type="submit" disabled={!reviewable}>Editar y enviar</button>
            </div>
          </form>
          <div className="actions">
            <form action={`/api/tickets/${ticket.id}/approve`} method="post">
              <button className="button" type="submit" disabled={!reviewable}>Aprobar y enviar</button>
            </form>
            <form action={`/api/tickets/${ticket.id}/manual`} method="post">
              <button className="button secondary" type="submit" disabled={!reviewable}>Responder manualmente</button>
            </form>
            <form action={`/api/tickets/${ticket.id}/discard`} method="post">
              <button className="button danger" type="submit" disabled={!reviewable}>Descartar</button>
            </form>
          </div>
        </section>
        <section className="panel" style={{ padding: 16, marginTop: 16 }}>
          <h3>Auditoria</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Evento</th>
                <th>Usuario</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ticket.auditEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.createdAt.toLocaleString('es-ES')}</td>
                  <td>{event.eventType}</td>
                  <td>{event.user?.email || '-'}</td>
                  <td>{event.beforeStatus || '-'} -&gt; {event.afterStatus || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
