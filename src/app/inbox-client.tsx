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

type CustomerEntry = {
  email: string;
  name: string | null;
  pendingCount: number;
  lastAt: string;
  lastText: string;
};

type LoadReason = 'initial' | 'poll' | 'manual' | 'action';
type ViewMode = 'tickets' | 'conversations';
type SubmitAction = 'send-edited' | 'approve' | 'manual' | 'discard';

const POLL_MS = 7000;
const REVIEWABLE: TicketStatus[] = ['new', 'ai_generated', 'pending_review', 'send_failed'];

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

  const [viewMode, setViewMode] = useState<ViewMode>('tickets');
  const [selectedCustomerEmail, setSelectedCustomerEmail] = useState<string | null>(null);
  const [conversationTickets, setConversationTickets] = useState<Ticket[]>([]);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
  const [conversationLoading, setConversationLoading] = useState(false);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedId) || tickets[0] || null,
    [selectedId, tickets]
  );

  const customers = useMemo<CustomerEntry[]>(() => {
    const map = new Map<string, CustomerEntry>();
    for (const t of tickets) {
      const isPending = REVIEWABLE.includes(t.status);
      const existing = map.get(t.customerEmail);
      if (!existing) {
        map.set(t.customerEmail, {
          email: t.customerEmail,
          name: t.customerName,
          pendingCount: isPending ? 1 : 0,
          lastAt: t.receivedAt,
          lastText: t.originalText
        });
      } else {
        if (isPending) existing.pendingCount++;
        if (t.receivedAt > existing.lastAt) {
          existing.lastAt = t.receivedAt;
          existing.lastText = t.originalText;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [tickets]);

  const loadTickets = useCallback(
    async (reason: LoadReason = 'manual') => {
      const params = new URLSearchParams({ status: activeGroup, limit: '100' });
      if (query.trim()) params.set('q', query.trim());

      try {
        if (reason === 'initial') setLoading(true);
        setError('');

        const response = await fetch(`/api/tickets?${params.toString()}`, { cache: 'no-store' });
        const data = (await response.json()) as InboxResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'No se pudo actualizar la bandeja.');
        }

        const previousIds = knownIds.current;
        const incomingIds = new Set(data.tickets.map((t) => t.id));
        const hasNewTickets =
          previousIds.size > 0 && data.tickets.some((t) => !previousIds.has(t.id));

        knownIds.current = incomingIds;
        setTickets(data.tickets.map(fixTicket));
        setCounts(data.counts || {});
        setUpdatedAt(new Date(data.serverTime));

        setSelectedId((current) => {
          if (current && incomingIds.has(current)) return current;
          return data.selectedTicketId;
        });

        if (hasNewTickets && reason === 'poll') setNotice('Nuevo correo recibido');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar la bandeja.');
      } finally {
        setLoading(false);
      }
    },
    [activeGroup, query]
  );

  const loadConversation = useCallback(async (email: string) => {
    setSelectedCustomerEmail(email);
    setConversationLoading(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(email)}/tickets`, {
        cache: 'no-store'
      });
      const data = (await res.json()) as { ok: boolean; tickets: Ticket[] };
      if (data.ok) {
        const fixedTickets = data.tickets.map(fixTicket);
        setConversationTickets(fixedTickets);
        const firstPending = fixedTickets.find((t) => REVIEWABLE.includes(t.status));
        if (firstPending) {
          setSelectedId(firstPending.id);
          setDraft(firstPending.finalReply || firstPending.aiReply || '');
          setDirty(false);
        }
        setMobilePanel('detail');
      }
    } catch {
      // silently ignore
    } finally {
      setConversationLoading(false);
    }
  }, []);

  useEffect(() => {
    knownIds.current = new Set();
    setSelectedId(null);
    setNotice('');
    void loadTickets('initial');
  }, [loadTickets]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadTickets('poll'), POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicket || dirty || viewMode === 'conversations') return;
    setDraft(selectedTicket.finalReply || selectedTicket.aiReply || '');
  }, [dirty, selectedTicket, viewMode]);

  const selectTicket = (ticket: Ticket) => {
    setSelectedId(ticket.id);
    setDraft(ticket.finalReply || ticket.aiReply || '');
    setDirty(false);
    setNotice('');
    setMobilePanel('detail');
  };

  const switchViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedCustomerEmail(null);
    setConversationTickets([]);
    setNotice('');
    setMobilePanel('list');
  };

  const submitAction = async (action: SubmitAction, ticketId?: string) => {
    const id = ticketId ?? selectedTicket?.id;
    if (!id) return;
    setSubmitting(action);
    setError('');

    try {
      const init: RequestInit = { method: 'POST' };
      if (action === 'send-edited') {
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        init.body = new URLSearchParams({ final_reply: draft });
      }

      const response = await fetch(`/api/tickets/${id}/${action}`, init);
      if (!response.ok) throw new Error('No se pudo completar la accion.');

      setDirty(false);
      setNotice(action === 'send-edited' ? 'Respuesta enviada' : 'Ticket actualizado');

      if (viewMode === 'conversations' && selectedCustomerEmail) {
        await Promise.all([loadConversation(selectedCustomerEmail), loadTickets('action')]);
      } else {
        await loadTickets('action');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la accion.');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand-lockup">
          <img
            src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
            alt="V-gummies"
          />
          <div>
            <p className="eyebrow">Area administrativa</p>
            <h1>Soporte V-Gummies</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span>{updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Sin actualizar'}</span>
          <span>{userEmail}</span>
          <a href="/blocklist">Lista negra</a>
          <a href="/logout">Salir</a>
        </div>
      </header>

      <section
        className={`inbox-layout ${mobilePanel === 'detail' ? 'mobile-detail' : 'mobile-list'}`}
        aria-label="Bandeja de tickets"
      >
        <aside className="status-rail" aria-label="Estados">
          <div className="rail-heading">
            <span>Cola de bienestar</span>
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
              <span>Buscar cliente</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Email, cliente o asunto"
              />
            </label>
            <div className="view-toggle">
              <button
                className={viewMode === 'tickets' ? 'view-toggle-btn active' : 'view-toggle-btn'}
                type="button"
                onClick={() => switchViewMode('tickets')}
                title="Lista de tickets"
              >
                ☰
              </button>
              <button
                className={viewMode === 'conversations' ? 'view-toggle-btn active' : 'view-toggle-btn'}
                type="button"
                onClick={() => switchViewMode('conversations')}
                title="Ver conversaciones"
              >
                💬
              </button>
            </div>
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

            {viewMode === 'tickets' ? (
              <>
                {!loading && !tickets.length ? (
                  <div className="empty-state">No hay correos en este estado.</div>
                ) : null}
                {tickets.map((ticket) => (
                  <button
                    className={
                      ticket.id === selectedTicket?.id ? 'ticket-row selected' : 'ticket-row'
                    }
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
                      {ticket.escalationRecommended ? <b className="tag-escalate">⚡ Escalar</b> : null}
                      {ticket.riskFlags && !ticket.escalationRecommended ? <b>Revisar riesgo</b> : null}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <>
                {!loading && !customers.length ? (
                  <div className="empty-state">No hay clientes en este estado.</div>
                ) : null}
                {customers.map((customer) => (
                  <button
                    className={
                      customer.email === selectedCustomerEmail
                        ? 'ticket-row selected'
                        : 'ticket-row'
                    }
                    key={customer.email}
                    type="button"
                    onClick={() => loadConversation(customer.email)}
                  >
                    <span className="row-main">
                      <strong>{customer.name || customer.email}</strong>
                      {customer.pendingCount > 0 ? (
                        <span className="pending-badge">{customer.pendingCount}</span>
                      ) : null}
                    </span>
                    <span className="row-meta">
                      <time>{formatDate(customer.lastAt)}</time>
                    </span>
                    <span className="row-preview">{preview(customer.lastText)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </section>

        <div className="detail-panel-wrapper">
          {viewMode === 'conversations' ? (
            <ConversationPane
              customerEmail={selectedCustomerEmail}
              tickets={conversationTickets}
              loading={conversationLoading}
              draft={draft}
              dirty={dirty}
              selectedId={selectedId}
              onBack={() => setMobilePanel('list')}
              onDraftChange={(value) => {
                setDraft(value);
                setDirty(true);
              }}
              onSelectTicket={(id, defaultDraft) => {
                setSelectedId(id);
                setDraft(defaultDraft);
                setDirty(false);
              }}
              onSubmit={submitAction}
              submitting={submitting}
            />
          ) : (
            <ReviewPane
              draft={draft}
              dirty={dirty}
              onBack={() => setMobilePanel('list')}
              onDraftChange={(value) => {
                setDraft(value);
                setDirty(true);
              }}
              onSubmit={submitAction}
              submitting={submitting}
              ticket={selectedTicket}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function ConversationPane({
  customerEmail,
  tickets,
  loading,
  draft,
  dirty,
  selectedId,
  onBack,
  onDraftChange,
  onSelectTicket,
  onSubmit,
  submitting
}: {
  customerEmail: string | null;
  tickets: Ticket[];
  loading: boolean;
  draft: string;
  dirty: boolean;
  selectedId: string | null;
  onBack: () => void;
  onDraftChange: (value: string) => void;
  onSelectTicket: (id: string, defaultDraft: string) => void;
  onSubmit: (action: SubmitAction, ticketId?: string) => void;
  submitting: string | null;
}) {
  if (!customerEmail) {
    return (
      <section className="review-pane">
        <div className="empty-state">Selecciona un cliente para ver la conversación.</div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="review-pane">
        <div className="empty-state">Cargando conversación...</div>
      </section>
    );
  }

  if (!tickets.length) {
    return (
      <section className="review-pane">
        <div className="empty-state">Sin mensajes para este cliente.</div>
      </section>
    );
  }

  const customerName = tickets[0]?.customerName || customerEmail;

  return (
    <section className="review-pane conv-pane">
      <button className="mobile-back-btn" type="button" onClick={onBack}>
        ← Volver
      </button>
      <div className="review-header">
        <div>
          <p className="eyebrow">Conversación completa</p>
          <h2>{customerName}</h2>
          <p className="conv-email">{customerEmail}</p>
        </div>
      </div>

      <div className="conv-thread">
        {tickets.map((ticket) => {
          const isPending = REVIEWABLE.includes(ticket.status);
          const isSent = ['approved_sent', 'edited_sent'].includes(ticket.status);
          const isDiscarded = ticket.status === 'discarded';
          const isManual = ticket.status === 'manual';
          const isSelectedForEdit = ticket.id === selectedId;

          const adminText = isSent
            ? (ticket.finalReply || ticket.aiReply || '')
            : (ticket.aiReply || '');

          return (
            <div className="thread-turn" key={ticket.id}>
              {/* Client message */}
              <div className="thread-bubble bubble-client">
                <div className="bubble-header">
                  <span className="bubble-who">👤 {formatDate(ticket.receivedAt)}</span>
                  <CopyButton text={ticket.originalText} />
                </div>
                {ticket.subject && ticket.subject !== '(sin asunto)' ? (
                  <p className="bubble-subject">{ticket.subject}</p>
                ) : null}
                <p className="bubble-text">{ticket.originalText}</p>
                {ticket.category || ticket.intent ? (
                  <div className="bubble-tags">
                    {ticket.category ? <em>{ticket.category}</em> : null}
                    {ticket.intent ? <em>{ticket.intent}</em> : null}
                  </div>
                ) : null}
              </div>

              {/* Admin response */}
              {isDiscarded || isManual ? (
                <div className="thread-bubble bubble-discarded">
                  <span>{isDiscarded ? 'Ticket descartado' : 'Gestionado manualmente'}</span>
                </div>
              ) : isPending ? (
                <div
                  className={`thread-bubble bubble-admin ${isSelectedForEdit ? 'editing' : 'pending'}`}
                >
                  {ticket.escalationRecommended ? (
                    <div className="escalation-banner" style={{ marginBottom: 8 }}>
                      <span>⚡</span>
                      <div><strong>Requiere atención humana</strong></div>
                    </div>
                  ) : null}
                  <div className="bubble-header">
                    <span className="bubble-who">
                      🤖 Susana · <StatusBadge status={ticket.status} />
                    </span>
                    {ticket.aiReply ? <CopyButton text={ticket.aiReply} /> : null}
                  </div>
                  {isSelectedForEdit ? (
                    <div className="conv-editor">
                      <textarea
                        value={draft}
                        onChange={(e) => onDraftChange(e.target.value)}
                        placeholder="Editar respuesta antes de enviar"
                      />
                      <div className="action-bar">
                        <button
                          className="primary-action"
                          type="button"
                          disabled={!draft.trim() || submitting !== null}
                          onClick={() => onSubmit('send-edited', ticket.id)}
                        >
                          {submitting === 'send-edited' ? 'Enviando...' : 'Editar y enviar'}
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={submitting !== null}
                          onClick={() => onSubmit('approve', ticket.id)}
                        >
                          Aprobar sin cambios
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={submitting !== null}
                          onClick={() => onSubmit('manual', ticket.id)}
                        >
                          Manual
                        </button>
                        <button
                          className="danger-action"
                          type="button"
                          disabled={submitting !== null}
                          onClick={() => onSubmit('discard', ticket.id)}
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {ticket.aiReply ? (
                        <p className="bubble-text">{ticket.aiReply}</p>
                      ) : (
                        <p className="bubble-text muted">Sin respuesta IA generada</p>
                      )}
                      <button
                        className="ghost-button"
                        style={{ marginTop: 8 }}
                        type="button"
                        onClick={() =>
                          onSelectTicket(
                            ticket.id,
                            ticket.finalReply || ticket.aiReply || ''
                          )
                        }
                      >
                        Revisar este ticket
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="thread-bubble bubble-admin sent">
                  <div className="bubble-header">
                    <span className="bubble-who">
                      ✅ Susana · {labelForStatus(ticket.status)}
                    </span>
                    {adminText ? <CopyButton text={adminText} /> : null}
                  </div>
                  <p className="bubble-text">{adminText || 'Sin texto registrado'}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReviewPane({
  draft,
  dirty,
  onBack,
  onDraftChange,
  onSubmit,
  submitting,
  ticket
}: {
  draft: string;
  dirty: boolean;
  onBack: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (action: SubmitAction, ticketId?: string) => void;
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

  const reviewable = ['new', 'ai_generated', 'pending_review', 'send_failed'].includes(
    ticket.status
  );

  return (
    <section className="review-pane">
      <button className="mobile-back-btn" type="button" onClick={onBack}>
        ← Volver
      </button>
      <div className="review-header">
        <div>
          <p className="eyebrow">Cuidar desde adentro - {ticket.customerEmail}</p>
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

      {ticket.escalationRecommended ? (
        <div className="escalation-banner">
          <span>⚡</span>
          <div>
            <strong>Este ticket requiere atención humana</strong>
            <p>Responde al cliente e informa al equipo de soporte.</p>
          </div>
        </div>
      ) : null}

      {ticket.sendError ? (
        <div className="send-error">
          <strong>Ultimo error de envio</strong>
          <span>{ticket.sendError}</span>
        </div>
      ) : null}

      <div className="review-grid">
        <article className="message-block">
          <div className="message-block-header">
            <h3>Correo original</h3>
            <CopyButton text={ticket.originalText} />
          </div>
          <div>{ticket.originalText}</div>
        </article>
        <article className="message-block ai-block">
          <div className="message-block-header">
            <h3>Respuesta IA</h3>
            {ticket.aiReply ? <CopyButton text={ticket.aiReply} /> : null}
          </div>
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
          onChange={(e) => onDraftChange(e.target.value)}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="copy-btn" type="button" onClick={copy} title="Copiar al portapapeles">
      {copied ? '✓ Copiado' : 'Copiar'}
    </button>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`status-badge tone-${statusTone[status]}`}>{labelForStatus(status)}</span>
  );
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

function fixMojibake(str: string | null): string | null {
  if (!str) return str;
  try {
    const td = new TextDecoder('utf-8', { fatal: true });
    return td.decode(new Uint8Array(str.split('').map(c => c.charCodeAt(0))));
  } catch {
    return str;
  }
}

function fixTicket(t: Ticket): Ticket {
  return {
    ...t,
    customerName: fixMojibake(t.customerName),
    subject: fixMojibake(t.subject) || '',
    originalText: fixMojibake(t.originalText) || '',
    aiReply: fixMojibake(t.aiReply) || '',
    finalReply: fixMojibake(t.finalReply) || '',
    category: fixMojibake(t.category),
    intent: fixMojibake(t.intent)
  };
}
