import type { TicketStatus } from '@prisma/client';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const statusOptions: TicketStatus[] = [
  'pending_review',
  'send_failed',
  'new',
  'ai_generated',
  'approved_sent',
  'edited_sent',
  'discarded',
  'manual'
];

export default async function InboxPage({
  searchParams
}: {
  searchParams: { status?: TicketStatus; q?: string };
}) {
  const user = await requireUser();
  const status = statusOptions.includes(searchParams.status as TicketStatus)
    ? (searchParams.status as TicketStatus)
    : 'pending_review';
  const q = String(searchParams.q || '').trim();

  const tickets = await db.ticket.findMany({
    where: {
      status,
      ...(q
        ? {
            OR: [
              { customerEmail: { contains: q, mode: 'insensitive' } },
              { subject: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: { receivedAt: 'desc' },
    take: 100
  });

  return (
    <main className="shell">
      <header className="topbar">
        <h1>Review Admin</h1>
        <div>{user.email} - <a href="/logout">Salir</a></div>
      </header>
      <section className="container panel">
        <form className="toolbar" action="/" method="get">
          <select className="select" name="status" defaultValue={status}>
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input className="input" name="q" placeholder="Buscar email o asunto" defaultValue={q} />
          <button className="button" type="submit">Filtrar</button>
        </form>
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Asunto</th>
              <th>Estado</th>
              <th>Riesgo</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td><Link href={`/tickets/${ticket.id}`}>{ticket.customerEmail}</Link></td>
                <td>{ticket.subject}</td>
                <td><span className="badge">{ticket.status}</span></td>
                <td>{ticket.escalationRecommended ? 'Revision' : ticket.riskFlags || '-'}</td>
                <td>{ticket.receivedAt.toLocaleString('es-ES')}</td>
              </tr>
            ))}
            {!tickets.length ? (
              <tr>
                <td colSpan={5}>No hay tickets en este estado.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
