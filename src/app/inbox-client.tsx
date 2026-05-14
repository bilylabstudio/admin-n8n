'use client';

import type { TicketStatus } from '@prisma/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type InboxGroup,
  inboxGroups,
  labelForStatus,
  statusTone
} from '@/lib/status';

type TicketEvent = {
  id: string;
  eventType: string;
  beforeStatus: TicketStatus | null;
  afterStatus: TicketStatus | null;
  createdAt: string;
  userEmail: string | null;
};

type Ticket = {
  id: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  receivedAt: string;
  originalText: string;
  aiReply: string;
  finalReply: string | null;
  category: string | null;
  intent: string | null;
  riskFlags: string | null;
  escalationRecommended: boolean;
  status: TicketStatus;
  sendError: string | null;
  updatedAt: string;
  auditEvents: TicketEvent[];
};

type InboxResponse = {
  ok: boolean;
  tickets: Ticket[];
  counts: Record<InboxGroup, number>;
  selectedTicketId: string | null;
  serverTime: string;
  error?: string;
};

type LoadReason = 'initial' | 'poll' | 'manual' | 'action';

const POLL_MS = 7000;

export function InboxClient({ userEmail }: { userEmail: string }) {
  const [activeGroup, setActiveGroup] = useState<InboxGroup>('pending_review');
  const [query, setQuery] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const knownIds = useRef<Set<string>>(new Set());

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) || tickets[0] || null,
    [selectedId, tickets]
  );

  const loadTickets = useCallback(
    async (reason: LoadReason = 'manual') => {
      const params = new URLSearchParams({ status: activeGroup, limit: '100' });
      if (query.trim()) params.set('q', query.trim());

      try {
        if (reason === 'initial') setLoading(true);
        setError('');

        const response = await fetch(`/api/tickets?${params.toString()}`, {
          cache: 'no-store'
        });
        const data = (await response.json()) as InboxResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'No se pudo actualizar la bandeja.');
        }

        const previousIds = knownIds.current;
        const incomingIds = new Set(data.tickets.map((ticket) => ticket.id));
        const hasNewTickets =
          previousIds.size > 0 && data.tickets.some((ticket) => !previousIds.has(ticket.id));

        knownIds.current = incomingIds;
        setTickets(data.tickets);
        setCounts(data.counts || {});
        setUpdatedAt(new Date(data.serverTime));

        setSelectedId((current) => {
          if (current && incomingIds.has(current)) return current;
          return data.selectedTicketId;
        });

        if (hasNewTickets && reason === 'poll') {
          setNotice('Nuevo correo recibido');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar la bandeja.');
      } finally {
        setLoading(false);
      }
    },
    [activeGroup, query]
  );

  useEffect(() => {
    knownIds.current = new Set();
    setSelectedId(null);
    setNotice('');
    void loadTickets('initial');
  }, [loadTickets]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTickets('poll');
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicket || dirty) return;
    setDraft(selectedTicket.finalReply || selectedTicket.aiReply || '');
  }, [dirty, selectedTicket]);

  const selectTicket = (ticket: Ticket) => {
    setSelectedId(ticket.id);
    setDraft(ticket.finalReply || ticket.aiReply || '');
    setDirty(false);
    setNotice('');
  };

  const updateQuery = (value: string) => {
    setQuery(value);
  };

  const submitAction = async (action: 'send-edited' | 'approve' | 'manual' | 'discard') => {
    if (!selectedTicket) return;
    setSubmitting(action);
    setError('');

    try {
      const init: RequestInit = { method: 'POST' };
      if (action === 'send-edited') {
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        init.body = new URLSearchParams({ final_reply: draft });
      }

      const response = await fetch(`/api/tickets/${selectedTicket.id}/${action}`, init);
      if (!response.ok) {
        throw new Error('No se pudo completar la accion.');
      }

      setDirty(false);
      setNotice(action === 'send-edited' ? 'Respuesta enviada' : 'Ticket actualizado');
      await loadTickets('action');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la accion.');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">V-Gummies soporte</p>
          <h1>Bandeja de revision</h1>
        </div>
        <div className="topbar-meta">
          <span>{updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Sin actualizar'}</span>
          <span>{userEmail}</span>
          <a href="/logout">Salir</a>
        </div>
      </header>

      <section className="inbox-layout" aria-label="Bandeja de tickets">
        <aside className="status-rail" aria-label="Estados">
          <div className="rail-heading">
            <span>Estados</span>
            <button className="ghost-button" type="button" onClick={() => loadTickets('manual')}>
              Actualizar
            </button>
          </div>
          <nav className="status-nav">
            {inboxGroups.map((group) => (
              <button
                className={group.id === activeGroup ? 'status-link active' : 'status-link'}
                key={group.id}
                type="button"
                onClick={() => setActiveGroup(group.id)}
              >
                <span>{group.label}</span>
                <strong>{counts[group.id] || 0}</strong>
              </button>
            ))}
          </nav>
        </aside>

        <section className="ticket-list-panel">
          <div className="list-toolbar">
            <label className="search-field">
              <span>Buscar</span>
              <input
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder="Email, cliente o asunto"
              />
            </label>
            {notice ? <p className="live-notice">{notice}</p> : null}
          </div>

          {error ? (
            <div className="inline-error">
              <span>{error}</span>
              <button type="button" onClick={() => loadTickets('manual')}>
                Reintentar
              </button>
            </div>
          ) : null}

          <div className="ticket-list" aria-live="polite">
            {loading ? <div className="empty-state">Cargando correos...</div> : null}
            {!loading && !tickets.length ? (
              <div className="empty-state">No hay correos en este estado.</div>
            ) : null}
            {tickets.map((ticket) => (
              <button
                className={ticket.id === selectedTicket?.id ? 'ticket-row selected' : 'ticket-row'}
                key={ticket.id}
                type="button"
                onClick={() => selectTicket(ticket)}
              >
                <span className="row-main">
                  <strong>{ticket.customerName || ticket.customerEmail}</strong>
                  <small>{ticket.subject}</small>
                </span>
                <span className="row-meta">
                  <StatusBadge status={ticket.status} />
                  <time>{formatDate(ticket.receivedAt)}</time>
                </span>
                <span className="row-preview">{preview(ticket.originalText)}</span>
                <span className="row-tags">
                  {ticket.category ? <em>{ticket.category}</em> : null}
                  {ticket.intent ? <em>{ticket.intent}</em> : null}
                  {ticket.escalationRecommended || ticket.riskFlags ? <b>Revisar riesgo</b> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <ReviewPane
          draft={draft}
          dirty={dirty}
          onDraftChange={(value) => {
            setDraft(value);
            setDirty(true);
          }}
          onSubmit={submitAction}
          submitting={submitting}
          ticket={selectedTicket}
        />
      </section>
    </main>
  );
}

function ReviewPane({
  draft,
  dirty,
  onDraftChange,
  onSubmit,
  submitting,
  ticket
}: {
  draft: string;
  dirty: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (action: 'send-edited' | 'approve' | 'manual' | 'discard') => void;
  submitting: string | null;
  ticket: Ticket | null;
}) {
  if (!ticket) {
    return (
      <section className="review-pane">
        <div className="empty-state">Selecciona un correo para revisarlo.</div>
      </section>
    );
  }

  const reviewable = ['new', 'ai_generated', 'pending_review', 'send_failed'].includes(ticket.status);

  return (
    <section className="review-pane">
      <div className="review-header">
        <div>
          <p className="eyebrow">{ticket.customerEmail}</p>
          <h2>{ticket.subject}</h2>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="detail-strip">
        <span>{formatDate(ticket.receivedAt)}</span>
        {ticket.category ? <span>{ticket.category}</span> : null}
        {ticket.intent ? <span>{ticket.intent}</span> : null}
        {ticket.escalationRecommended ? <strong>Escalar</strong> : null}
      </div>

      {ticket.sendError ? (
        <div className="send-error">
          <strong>Ultimo error de envio</strong>
          <span>{ticket.sendError}</span>
        </div>
      ) : null}

      <div className="review-grid">
        <article className="message-block">
          <h3>Correo original</h3>
          <div>{ticket.originalText}</div>
        </article>
        <article className="message-block ai-block">
          <h3>Respuesta IA</h3>
          <div>{ticket.aiReply || 'Este correo no tiene respuesta generada por IA.'}</div>
        </article>
      </div>

      <section className="editor-panel">
        <div className="editor-heading">
          <h3>Respuesta final</h3>
          {dirty ? <span>Cambios sin enviar</span> : <span>Lista para revisar</span>}
        </div>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          disabled={!reviewable}
          placeholder="Escribe la respuesta final para el cliente"
        />
        <div className="action-bar">
          <button
            className="primary-action"
            type="button"
            disabled={!reviewable || !draft.trim() || submitting !== null}
            onClick={() => onSubmit('send-edited')}
          >
            {submitting === 'send-edited' ? 'Enviando...' : 'Editar y enviar'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!reviewable || submitting !== null}
            onClick={() => onSubmit('approve')}
          >
            Aprobar sin cambios
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!reviewable || submitting !== null}
            onClick={() => onSubmit('manual')}
          >
            Manual
          </button>
          <button
            className="danger-action"
            type="button"
            disabled={!reviewable || submitting !== null}
            onClick={() => onSubmit('discard')}
          >
            Descartar
          </button>
        </div>
      </section>

      <details className="audit-panel">
        <summary>Auditoria</summary>
        {ticket.auditEvents.length ? (
          ticket.auditEvents.map((event) => (
            <div className="audit-row" key={event.id}>
              <span>{formatDate(event.createdAt)}</span>
              <strong>{event.eventType}</strong>
              <small>{event.userEmail || '-'}</small>
            </div>
          ))
        ) : (
          <p>No hay eventos registrados.</p>
        )}
      </details>
    </section>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`status-badge tone-${statusTone[status]}`}>{labelForStatus(status)}</span>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatRelative(value: Date) {
  const seconds = Math.max(0, Math.round((Date.now() - value.getTime()) / 1000));
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.round(seconds / 60)} min`;
}

function preview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 130 ? `${normalized.slice(0, 130)}...` : normalized;
}
