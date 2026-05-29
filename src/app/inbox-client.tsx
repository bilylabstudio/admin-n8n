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

type TicketTag = {
  id: 'escalate' | 'refund' | 'shipping' | 'product';
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
};

type ActiveTagFilter = 'all' | TicketTag['id'];

type Ticket = {
  id: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  receivedAt: string;
  sentAt: string | null;
  originalText: string;
  aiReply: string;
  finalReply: string | null;
  category: string | null;
  intent: string | null;
  riskFlags: string | null;
  tags: TicketTag[];
  escalationRecommended: boolean;
  status: TicketStatus;
  sendError: string | null;
  imapUid: string | null;
  imapMailbox: string | null;
  seenSyncedAt: string | null;
  answeredSyncedAt: string | null;
  sentFolderSyncedAt: string | null;
  webmailSyncError: string | null;
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

type ThreadMessage = {
  id: string;
  ticketId: string | null;
  direction: 'inbound' | 'outbound';
  source: 'admin' | 'webmail';
  subject: string;
  text: string;
  at: string;
  status: TicketStatus | null;
  customerName: string | null;
  tags: TicketTag[];
};

type ThreadResponse = {
  ok: boolean;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  anchorTicketId: string | null;
  pendingTicketId: string | null;
  composerMode: 'review_ticket' | 'follow_up';
  draft: string;
  messages: ThreadMessage[];
  error?: string;
};

type LoadReason = 'initial' | 'poll' | 'manual' | 'action';
type ViewMode = 'tickets' | 'conversations';
type SubmitAction = 'send' | 'discard';

const POLL_MS = 7000;
const REVIEWABLE: TicketStatus[] = ['new', 'ai_generated', 'pending_review', 'send_failed'];
const tagFilterOptions: { id: ActiveTagFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'escalate', label: 'Escalar' },
  { id: 'refund', label: 'Devolucion' },
  { id: 'shipping', label: 'Problema envio' },
  { id: 'product', label: 'Problema producto' }
];

export function InboxClient({ userEmail }: { userEmail: string }) {
  const [activeGroup, setActiveGroup] = useState<InboxGroup>('pending_review');
  const [query, setQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<ActiveTagFilter>('all');
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
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [threadCustomerName, setThreadCustomerName] = useState<string | null>(null);
  const [threadSubject, setThreadSubject] = useState('(sin asunto)');
  const [threadComposerMode, setThreadComposerMode] =
    useState<ThreadResponse['composerMode']>('follow_up');
  const [threadPendingTicketId, setThreadPendingTicketId] = useState<string | null>(null);
  const [threadAnchorTicketId, setThreadAnchorTicketId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
  const [conversationLoading, setConversationLoading] = useState(false);
  const [statusRailCollapsed, setStatusRailCollapsed] = useState(false);
  const [ticketListCollapsed, setTicketListCollapsed] = useState(false);
  const [exportSelection, setExportSelection] = useState<Set<string>>(() => new Set());

  const visibleTickets = useMemo(() => {
    if (activeTagFilter === 'all') return tickets;
    return tickets.filter((ticket) => ticket.tags.some((tag) => tag.id === activeTagFilter));
  }, [activeTagFilter, tickets]);

  const selectedTicket = useMemo(
    () => visibleTickets.find((t) => t.id === selectedId) || visibleTickets[0] || null,
    [selectedId, visibleTickets]
  );

  const isSentGroup = activeGroup === 'sent';

  const selectedExportTickets = useMemo(
    () => visibleTickets.filter((ticket) => exportSelection.has(ticket.id)),
    [exportSelection, visibleTickets]
  );

  const customers = useMemo<CustomerEntry[]>(() => {
    const map = new Map<string, CustomerEntry>();
    for (const t of visibleTickets) {
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
  }, [visibleTickets]);

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

  const markTicketSeen = useCallback(async (ticket: Ticket) => {
    if (!ticket.imapUid || ticket.seenSyncedAt) return;
    try {
      await fetch(`/api/tickets/${ticket.id}/webmail-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seen' })
      });
    } catch {
      // El ticket sigue siendo usable aunque falle la marca de lectura en webmail.
    }
  }, []);

  const loadConversation = useCallback(async (email: string, ticketId?: string | null) => {
    setSelectedCustomerEmail(email);
    setConversationLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (ticketId) params.set('ticketId', ticketId);
      const res = await fetch(`/api/customers/${encodeURIComponent(email)}/thread?${params}`, {
        cache: 'no-store'
      });
      const data = (await res.json()) as ThreadResponse;
      if (data.ok) {
        setThreadMessages(data.messages.map(fixThreadMessage));
        setThreadCustomerName(fixMojibake(data.customerName));
        setThreadSubject(fixMojibake(data.subject) || '(sin asunto)');
        setThreadComposerMode(data.composerMode);
        setThreadPendingTicketId(data.pendingTicketId);
        setThreadAnchorTicketId(data.anchorTicketId);
        setDraft(data.draft || '');
        setDirty(false);
        const nextSelectedId = ticketId || data.pendingTicketId || data.anchorTicketId;
        if (nextSelectedId) setSelectedId(nextSelectedId);
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
    if (!selectedTicket || dirty || viewMode === 'conversations' || threadComposerMode !== 'review_ticket') return;
    setDraft(selectedTicket.finalReply || selectedTicket.aiReply || '');
  }, [dirty, selectedTicket, threadComposerMode, viewMode]);

  useEffect(() => {
    if (selectedId && visibleTickets.some((ticket) => ticket.id === selectedId)) return;
    setSelectedId(visibleTickets[0]?.id || null);
  }, [selectedId, visibleTickets]);

  useEffect(() => {
    if (viewMode !== 'tickets' || !selectedTicket) return;
    void loadConversation(selectedTicket.customerEmail, selectedTicket.id);
  }, [loadConversation, selectedTicket?.id, selectedTicket?.customerEmail, viewMode]);

  useEffect(() => {
    if (!isSentGroup) {
      setExportSelection(new Set());
    }
  }, [isSentGroup]);

  useEffect(() => {
    setExportSelection((current) => {
      if (!current.size) return current;
      const visibleIds = new Set(visibleTickets.map((ticket) => ticket.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleTickets]);

  const selectTicket = (ticket: Ticket) => {
    setSelectedId(ticket.id);
    setDraft('');
    setDirty(false);
    setNotice('');
    void markTicketSeen(ticket);
    setMobilePanel('detail');
  };

  const switchViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedCustomerEmail(null);
    setThreadMessages([]);
    setThreadCustomerName(null);
    setThreadSubject('(sin asunto)');
    setThreadComposerMode('follow_up');
    setThreadPendingTicketId(null);
    setThreadAnchorTicketId(null);
    setNotice('');
    setMobilePanel('list');
  };

  const toggleExportSelection = (ticketId: string, checked: boolean) => {
    setExportSelection((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(ticketId);
      } else {
        next.delete(ticketId);
      }
      return next;
    });
  };

  const selectAllVisibleForExport = () => {
    if (!isSentGroup) return;
    setExportSelection(new Set(visibleTickets.map((ticket) => ticket.id)));
  };

  const clearExportSelection = () => {
    setExportSelection(new Set());
  };

  const downloadSelectedJson = () => {
    if (!selectedExportTickets.length) return;

    const payload = {
      exportedAt: new Date().toISOString(),
      count: selectedExportTickets.length,
      messages: selectedExportTickets.map((ticket) => ({
        id: ticket.id,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        subject: ticket.subject,
        receivedAt: ticket.receivedAt,
        sentAt: ticket.sentAt,
        status: ticket.status,
        wasEditedAndSent: ticket.status === 'edited_sent',
        originalMessage: ticket.originalText,
        aiMessage: ticket.aiReply,
        sentMessage: ticket.finalReply || ticket.aiReply || ''
      }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vgummies-enviados-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(`Descargados ${selectedExportTickets.length} mensajes`);
  };

  const submitAction = async (action: SubmitAction, ticketId?: string) => {
    const id = ticketId ?? selectedTicket?.id;
    if (!id) return;
    const reloadEmail = selectedCustomerEmail || selectedTicket?.customerEmail || null;
    setSubmitting(action);
    setError('');

    try {
      const init: RequestInit = { method: 'POST' };
      if (action === 'send') {
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        init.body = new URLSearchParams({ final_reply: draft });
      }

      const response = await fetch(`/api/tickets/${id}/${action}`, init);
      if (!response.ok) throw new Error('No se pudo completar la accion.');

      setDirty(false);
      setNotice(action === 'send' ? 'Respuesta enviada' : 'Ticket actualizado');

      if (reloadEmail) {
        await Promise.all([loadConversation(reloadEmail, id), loadTickets('action')]);
      } else {
        await loadTickets('action');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la accion.');
    } finally {
      setSubmitting(null);
    }
  };

  const submitThreadFollowUp = async () => {
    const email = selectedCustomerEmail || selectedTicket?.customerEmail;
    const ticketId = threadAnchorTicketId || selectedTicket?.id;
    if (!email || !ticketId || !draft.trim()) return;
    setSubmitting('follow_up');
    setError('');

    try {
      const response = await fetch(`/api/customers/${encodeURIComponent(email)}/thread/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_reply: draft, ticket_id: ticketId })
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; message?: string; error?: string }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'No se pudo enviar el seguimiento.');
      }

      setDirty(false);
      setNotice('Mensaje enviado');
      await Promise.all([loadConversation(email, ticketId), loadTickets('action')]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el seguimiento.');
    } finally {
      setSubmitting(null);
    }
  };

  const activeThreadEmail = selectedCustomerEmail || selectedTicket?.customerEmail || null;
  const activeThreadSubject = threadSubject || selectedTicket?.subject || '';
  const activeThreadName = threadCustomerName || selectedTicket?.customerName || activeThreadEmail;

  const goHome = () => {
    window.location.assign('/');
  };

  return (
    <main className="admin-shell">
      <header className={activeThreadEmail ? 'admin-topbar thread-topbar' : 'admin-topbar'}>
        <div className="brand-lockup">
          <button
            className="brand-home-button"
            type="button"
            onClick={goHome}
            title="Volver al inicio"
          >
            <img
              src="https://v-gummies.com/cdn/shop/files/logo_negro.png?v=1737016595&width=220"
              alt="V-gummies"
            />
          </button>
          <div className="brand-copy">
            {activeThreadEmail ? (
              <>
                <p className="eyebrow">Hilo del cliente - {activeThreadEmail}</p>
                <h1>{activeThreadSubject || 'Conversacion del cliente'}</h1>
                <p className="topbar-subtitle">{activeThreadName}</p>
              </>
            ) : (
              <>
                <p className="eyebrow">Area administrativa</p>
                <h1>Soporte V-Gummies</h1>
              </>
            )}
          </div>
        </div>
        <div className="topbar-meta">
          <span>{updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Sin actualizar'}</span>
          <span>{userEmail}</span>
          <a href="/dashboard">Dashboard</a>
          <a href="/ventas">Ventas</a>
          <a href="/forms">Formularios</a>
          <a href="/blocklist">Lista negra</a>
          <a href="/logout">Salir</a>
        </div>
      </header>

      <section
        className={[
          'inbox-layout',
          mobilePanel === 'detail' ? 'mobile-detail' : 'mobile-list',
          statusRailCollapsed ? 'status-rail-collapsed' : '',
          ticketListCollapsed ? 'ticket-list-collapsed' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Bandeja de tickets"
      >
        <aside className="status-rail" aria-label="Estados">
          <button
            className="rail-expand-button"
            type="button"
            aria-label="Abrir estados"
            title="Abrir estados"
            onClick={() => setStatusRailCollapsed(false)}
          >
            Estados
          </button>
          <div className="rail-content">
            <div className="rail-heading">
              <span>Cola de bienestar</span>
              <div className="rail-actions">
                <button className="ghost-button" type="button" onClick={() => loadTickets('manual')}>
                  Actualizar
                </button>
                <button
                  className="collapse-toggle"
                  type="button"
                  aria-label="Ocultar estados"
                  title="Ocultar estados"
                  onClick={() => setStatusRailCollapsed(true)}
                >
                  &lt;&lt;
                </button>
              </div>
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
          </div>
        </aside>

        <section className="ticket-list-panel">
          <button
            className="list-expand-button"
            type="button"
            aria-label="Abrir mensajes"
            title="Abrir mensajes"
            onClick={() => setTicketListCollapsed(false)}
          >
            Mensajes
          </button>
          <div className="ticket-list-content">
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
                  L
                </button>
                <button
                  className={viewMode === 'conversations' ? 'view-toggle-btn active' : 'view-toggle-btn'}
                  type="button"
                  onClick={() => switchViewMode('conversations')}
                  title="Ver conversaciones"
                >
                  H
                </button>
                <button
                  className="collapse-toggle"
                  type="button"
                  aria-label="Ocultar mensajes"
                  title="Ocultar mensajes"
                  onClick={() => setTicketListCollapsed(true)}
                >
                  &lt;&lt;
                </button>
              </div>
              <div className="tag-filter" aria-label="Filtrar por etiqueta">
                {tagFilterOptions.map((tag) => (
                  <button
                    className={activeTagFilter === tag.id ? 'tag-filter-btn active' : 'tag-filter-btn'}
                    key={tag.id}
                    type="button"
                    onClick={() => setActiveTagFilter(tag.id)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
              {isSentGroup && viewMode === 'tickets' ? (
                <div className="export-toolbar" aria-label="Exportar mensajes enviados">
                  <span>{selectedExportTickets.length} seleccionados</span>
                  <button
                    type="button"
                    onClick={selectAllVisibleForExport}
                    disabled={!visibleTickets.length}
                  >
                    Seleccionar todos
                  </button>
                  <button
                    type="button"
                    onClick={clearExportSelection}
                    disabled={!selectedExportTickets.length}
                  >
                    Limpiar
                  </button>
                  <button
                    className="export-download-btn"
                    type="button"
                    onClick={downloadSelectedJson}
                    disabled={!selectedExportTickets.length}
                  >
                    Descargar JSON
                  </button>
                </div>
              ) : null}
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
                  {!loading && !visibleTickets.length ? (
                    <div className="empty-state">No hay correos en este estado.</div>
                  ) : null}
                  {visibleTickets.map((ticket) => (
                    <div
                      className={isSentGroup ? 'ticket-export-row' : 'ticket-export-row plain'}
                      key={ticket.id}
                    >
                      {isSentGroup ? (
                        <label className="ticket-export-check" title="Seleccionar para descargar">
                          <input
                            type="checkbox"
                            checked={exportSelection.has(ticket.id)}
                            onChange={(event) =>
                              toggleExportSelection(ticket.id, event.target.checked)
                            }
                          />
                        </label>
                      ) : null}
                      <button
                        className={
                          ticket.id === selectedTicket?.id ? 'ticket-row selected' : 'ticket-row'
                        }
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
                          <TagBadges tags={ticket.tags} />
                          {ticket.category ? <em>{ticket.category}</em> : null}
                          {ticket.intent ? <em>{ticket.intent}</em> : null}
                          {ticket.riskFlags && !ticket.escalationRecommended ? <b>Revisar riesgo</b> : null}
                        </span>
                      </button>
                    </div>
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
          </div>
        </section>

        <div className="detail-panel-wrapper">
          <ThreadPane
            anchorTicketId={threadAnchorTicketId || selectedTicket?.id || null}
            composerMode={threadComposerMode}
            customerEmail={selectedCustomerEmail || selectedTicket?.customerEmail || null}
            customerName={threadCustomerName || selectedTicket?.customerName || null}
            dirty={dirty}
            draft={draft}
            loading={conversationLoading}
            messages={threadMessages}
            onBack={() => setMobilePanel('list')}
            onDraftChange={(value) => {
              setDraft(value);
              setDirty(true);
            }}
            onSubmitFollowUp={submitThreadFollowUp}
            onSubmitReview={submitAction}
            pendingTicketId={threadPendingTicketId}
            selectedTicket={selectedTicket}
            submitting={submitting}
          />
        </div>
      </section>
    </main>
  );
}

function ThreadPane({
  anchorTicketId,
  composerMode,
  customerEmail,
  customerName,
  dirty,
  draft,
  loading,
  messages,
  onBack,
  onDraftChange,
  onSubmitFollowUp,
  onSubmitReview,
  pendingTicketId,
  selectedTicket,
  submitting
}: {
  anchorTicketId: string | null;
  composerMode: ThreadResponse['composerMode'];
  customerEmail: string | null;
  customerName: string | null;
  dirty: boolean;
  draft: string;
  loading: boolean;
  messages: ThreadMessage[];
  onBack: () => void;
  onDraftChange: (value: string) => void;
  onSubmitFollowUp: () => void;
  onSubmitReview: (action: SubmitAction, ticketId?: string) => void;
  pendingTicketId: string | null;
  selectedTicket: Ticket | null;
  submitting: string | null;
}) {
  if (!customerEmail) {
    return (
      <section className="review-pane">
        <div className="empty-state">Selecciona un correo para ver la conversacion.</div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="review-pane">
        <div className="empty-state">Cargando conversacion...</div>
      </section>
    );
  }

  if (!messages.length) {
    return (
      <section className="review-pane">
        <div className="empty-state">Sin mensajes para este cliente.</div>
      </section>
    );
  }

  const canReview = composerMode === 'review_ticket' && pendingTicketId !== null;
  const canFollowUp = composerMode === 'follow_up' && anchorTicketId !== null;

  return (
    <section className="review-pane conv-pane">
      <button className="mobile-back-btn" type="button" onClick={onBack}>
        &larr; Volver
      </button>

      {selectedTicket?.sendError ? (
        <div className="send-error">
          <strong>Ultimo error de envio</strong>
          <span>{selectedTicket.sendError}</span>
        </div>
      ) : null}

      <div className="conv-thread">
        {messages.map((message) => {
          const isInbound = message.direction === 'inbound';
          return (
            <div
              className={`thread-turn ${isInbound ? 'from-client' : 'from-admin'}`}
              key={message.id}
            >
              <div className={`thread-bubble ${isInbound ? 'bubble-client' : 'bubble-admin sent'}`}>
                <div className="bubble-header">
                  <span className="bubble-who">
                    {isInbound ? customerName || 'Cliente' : 'Susana'} - {formatDate(message.at)}
                    {message.status ? <> - <StatusBadge status={message.status} /></> : null}
                    {!isInbound && message.source === 'webmail' ? <> - Webmail</> : null}
                  </span>
                  <CopyButton text={message.text} />
                </div>
                {message.subject && message.subject !== '(sin asunto)' ? (
                  <p className="bubble-subject">{message.subject}</p>
                ) : null}
                <p className="bubble-text">{message.text}</p>
                {message.tags.length ? (
                  <div className="bubble-tags">
                    <TagBadges tags={message.tags} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <section className="thread-composer">
        <div className="composer-input-wrap">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={!canReview && !canFollowUp}
            placeholder={
              canReview
                ? 'Editar respuesta antes de enviar'
                : 'Escribe un nuevo mensaje para este cliente'
            }
          />
          <button
            className="composer-send-button"
            type="button"
            disabled={
              canReview
                ? !draft.trim() || submitting !== null
                : !canFollowUp || !draft.trim() || submitting !== null
            }
            aria-label={canReview ? 'Enviar respuesta' : 'Enviar mensaje'}
            title={canReview ? 'Enviar respuesta' : 'Enviar mensaje'}
            onClick={() =>
              canReview ? onSubmitReview('send', pendingTicketId || undefined) : onSubmitFollowUp()
            }
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </section>
    </section>
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
                {ticket.tags.length || ticket.category || ticket.intent ? (
                  <div className="bubble-tags">
                    <TagBadges tags={ticket.tags} />
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
                          onClick={() => onSubmit('send', ticket.id)}
                        >
                          {submitting === 'send' ? 'Enviando...' : 'Enviar'}
                        </button>
                        <button
                          className="danger-action"
                          type="button"
                          disabled={submitting !== null}
                          onClick={() => onSubmit('discard', ticket.id)}
                        >
                          Rechazar
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
                  <div className="bubble-tags">
                    {ticket.answeredSyncedAt ? <em>Respondido en webmail</em> : null}
                    {ticket.sentFolderSyncedAt ? <em>En enviados</em> : null}
                    {ticket.webmailSyncError ? <b>Sync webmail pendiente</b> : null}
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

      <div className="detail-strip compact-detail-strip">
        <span>{formatDate(ticket.receivedAt)}</span>
        {ticket.category ? <span>{ticket.category}</span> : null}
        {ticket.intent ? <span>{ticket.intent}</span> : null}
        <TagBadges tags={ticket.tags} />
        {ticket.seenSyncedAt ? (
          <span>Leido en webmail</span>
        ) : ticket.imapUid ? (
          <span>Lectura webmail pendiente</span>
        ) : null}
        {ticket.answeredSyncedAt ? <span>Respondido en webmail</span> : null}
        {ticket.sentFolderSyncedAt ? <span>Copia en enviados</span> : null}
        {ticket.webmailSyncError ? <strong>Sync webmail pendiente</strong> : null}
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
          <div className="message-block-body">{ticket.originalText}</div>
        </article>
        <article className="message-block ai-block">
          <div className="message-block-header">
            <h3>Respuesta IA</h3>
            {ticket.aiReply ? <CopyButton text={ticket.aiReply} /> : null}
          </div>
          <div className="message-block-body">
            {ticket.aiReply || 'Este correo no tiene respuesta generada por IA.'}
          </div>
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
            onClick={() => onSubmit('send')}
          >
            {submitting === 'send' ? 'Enviando...' : 'Enviar'}
          </button>
          <button
            className="danger-action"
            type="button"
            disabled={!reviewable || submitting !== null}
            onClick={() => onSubmit('discard')}
          >
            Rechazar
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

function TagBadges({ tags }: { tags: TicketTag[] }) {
  if (!tags.length) return null;
  return (
    <>
      {tags.map((tag) => (
        <em className={`ticket-tag tag-${tag.tone}`} key={tag.id}>
          {tag.label}
        </em>
      ))}
    </>
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
    intent: fixMojibake(t.intent),
    tags: t.tags || []
  };
}

function fixThreadMessage(message: ThreadMessage): ThreadMessage {
  return {
    ...message,
    customerName: fixMojibake(message.customerName),
    subject: fixMojibake(message.subject) || '',
    text: fixMojibake(message.text) || '',
    tags: message.tags || []
  };
}
