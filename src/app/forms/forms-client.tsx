'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formInboxGroups, type FormInboxGroup, labelForFormStatus } from '@/lib/forms';
import type { FormStatus } from '@prisma/client';

type FormImage = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type FormSummary = {
  id: string;
  type: string;
  status: FormStatus;
  customerEmail: string;
  orderNumber: string | null;
  purchaseEmail: string | null;
  reason: string | null;
  reviewNotes: string | null;
  finalReply: string | null;
  submittedAt: string | null;
  sentAt: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedBy: string | null;
  ticket: { id: string; subject: string } | null;
  images: FormImage[];
};

type AuditRow = {
  id: string;
  eventType: string;
  createdAt: string;
  userEmail: string | null;
  metadataJson: unknown;
};

type FormDetail = FormSummary & { auditEvents: AuditRow[] };

type ListResponse = {
  ok: boolean;
  forms: FormSummary[];
  counts: Record<FormInboxGroup, number>;
  selectedFormId: string | null;
  serverTime: string;
  error?: string;
};

const POLL_MS = 7000;

type TemplateKey = 'form_devolucion_aprobada' | 'form_devolucion_rechazada';

export function FormsClient({ userEmail }: { userEmail: string }) {
  const [activeGroup, setActiveGroup] = useState<FormInboxGroup>('submitted');
  const [query, setQuery] = useState('');
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<TemplateKey>('form_devolucion_aprobada');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [previewImage, setPreviewImage] = useState<FormImage | null>(null);
  const knownIds = useRef<Set<string>>(new Set());

  const selectedForm = useMemo(
    () => forms.find((f) => f.id === selectedId) || forms[0] || null,
    [forms, selectedId]
  );

  const loadList = useCallback(
    async (reason: 'initial' | 'poll' | 'manual' | 'action' = 'manual') => {
      const params = new URLSearchParams({ status: activeGroup, limit: '100' });
      if (query.trim()) params.set('q', query.trim());

      try {
        if (reason === 'initial') setLoading(true);
        setError('');

        const response = await fetch(`/api/forms?${params.toString()}`, { cache: 'no-store' });
        const data = (await response.json()) as ListResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'No se pudo cargar la lista.');
        }

        const previous = knownIds.current;
        const incoming = new Set(data.forms.map((f) => f.id));
        const hasNew = previous.size > 0 && data.forms.some((f) => !previous.has(f.id));
        knownIds.current = incoming;

        setForms(data.forms);
        setCounts(data.counts);
        setUpdatedAt(new Date(data.serverTime));
        setSelectedId((current) => {
          if (current && incoming.has(current)) return current;
          return data.selectedFormId;
        });

        if (hasNew && reason === 'poll') setNotice('Nuevo formulario recibido');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setLoading(false);
      }
    },
    [activeGroup, query]
  );

  const loadDetail = useCallback(
    async (id: string, templateKey: TemplateKey) => {
      try {
        const url = `/api/forms/${id}?renderTemplate=${templateKey}`;
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json();
        if (data.ok) {
          setDetail(data.form);
          setReviewNotes(data.form.reviewNotes ?? '');
          if (!dirty) setDraft(data.form.finalReply || data.renderedTemplate || '');
        }
      } catch (err) {
        console.error('loadDetail', err);
      }
    },
    [dirty]
  );

  useEffect(() => {
    knownIds.current = new Set();
    setSelectedId(null);
    setNotice('');
    void loadList('initial');
  }, [loadList]);

  useEffect(() => {
    const id = window.setInterval(() => void loadList('poll'), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadList]);

  useEffect(() => {
    if (!selectedForm) {
      setDetail(null);
      setDraft('');
      setReviewNotes('');
      setDirty(false);
      return;
    }
    void loadDetail(selectedForm.id, activeTemplate);
  }, [selectedForm, activeTemplate, loadDetail]);

  const selectForm = (form: FormSummary) => {
    setSelectedId(form.id);
    setNotice('');
    setDirty(false);
    setActiveTemplate('form_devolucion_aprobada');
  };

  const performAction = async (action: 'approve' | 'reject' | 'manual' | 'discard') => {
    if (!selectedForm) return;
    setSubmitting(action);
    setError('');
    try {
      const body = new FormData();
      if (action === 'approve' || action === 'reject') {
        body.set('final_reply', draft);
      }
      if (reviewNotes.trim()) body.set('review_notes', reviewNotes.trim());

      const response = await fetch(`/api/forms/${selectedForm.id}/${action}`, {
        method: 'POST',
        body
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || 'No se pudo completar la acción');
      }
      setNotice(messageForAction(action));
      setDirty(false);
      await loadList('action');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(null);
    }
  };

  const closePreview = () => setPreviewImage(null);

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
            <h1>Formularios</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span>{updatedAt ? `Actualizado ${formatRelative(updatedAt)}` : 'Sin actualizar'}</span>
          <span>{userEmail}</span>
          <a href="/">Inbox</a>
          <a href="/dashboard">Dashboard</a>
          <a href="/blocklist">Lista negra</a>
          <a href="/logout">Salir</a>
        </div>
      </header>

      <section className="inbox-layout" aria-label="Bandeja de formularios">
        <aside className="status-rail" aria-label="Estados">
          <div className="rail-heading">
            <span>Formularios</span>
            <button className="ghost-button" type="button" onClick={() => loadList('manual')}>
              Actualizar
            </button>
          </div>
          <nav className="status-nav">
            {formInboxGroups.map((group) => (
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Email, pedido o motivo"
              />
            </label>
            {notice ? <p className="live-notice">{notice}</p> : null}
          </div>

          {error ? (
            <div className="inline-error">
              <span>{error}</span>
              <button type="button" onClick={() => loadList('manual')}>
                Reintentar
              </button>
            </div>
          ) : null}

          <div className="ticket-list" aria-live="polite">
            {loading ? <div className="empty-state">Cargando…</div> : null}
            {!loading && !forms.length ? (
              <div className="empty-state">No hay formularios en este estado.</div>
            ) : null}
            {forms.map((form) => (
              <button
                className={form.id === selectedForm?.id ? 'ticket-row selected' : 'ticket-row'}
                key={form.id}
                type="button"
                onClick={() => selectForm(form)}
              >
                <span className="row-main">
                  <strong>{form.customerEmail}</strong>
                  <small>Pedido {form.orderNumber || 'sin número'}</small>
                </span>
                <span className="row-meta">
                  <span className="status-badge tone-muted">{labelForFormStatus(form.status)}</span>
                  <time>
                    {form.submittedAt ? formatDate(form.submittedAt) : formatDate(form.createdAt)}
                  </time>
                </span>
                <span className="row-preview">{preview(form.reason || '')}</span>
                <span className="row-tags">
                  {form.images.length ? <em>📷 {form.images.length} foto(s)</em> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="detail-panel-wrapper">
          {!selectedForm ? (
            <section className="review-pane">
              <div className="empty-state">Selecciona un formulario.</div>
            </section>
          ) : (
            <section className="review-pane">
              <div className="review-header">
                <div>
                  <p className="eyebrow">Devolución — {selectedForm.customerEmail}</p>
                  <h2>Pedido {selectedForm.orderNumber || 'sin número'}</h2>
                </div>
                <span className="status-badge tone-muted">{labelForFormStatus(selectedForm.status)}</span>
              </div>

              <div className="detail-strip">
                {selectedForm.submittedAt ? (
                  <span>Enviado {formatDate(selectedForm.submittedAt)}</span>
                ) : null}
                {selectedForm.purchaseEmail ? (
                  <span>Compra: {selectedForm.purchaseEmail}</span>
                ) : null}
                {selectedForm.ticket ? <span>Ticket: {selectedForm.ticket.subject}</span> : null}
              </div>

              {selectedForm.sendError ? (
                <div className="send-error">
                  <strong>Último error de envío</strong>
                  <span>{selectedForm.sendError}</span>
                </div>
              ) : null}

              <div className="review-grid">
                <article className="message-block">
                  <div className="message-block-header">
                    <h3>Motivo del cliente</h3>
                  </div>
                  <div>{selectedForm.reason || '—'}</div>
                </article>
                <article className="message-block ai-block">
                  <div className="message-block-header">
                    <h3>Fotos adjuntas</h3>
                  </div>
                  <div>
                    {selectedForm.images.length === 0 ? (
                      <span style={{ color: 'var(--ink-muted)' }}>Sin fotos adjuntas.</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {selectedForm.images.map((img) => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => setPreviewImage(img)}
                            style={{
                              padding: 0,
                              border: '1px solid var(--line)',
                              borderRadius: 6,
                              background: 'transparent',
                              cursor: 'pointer'
                            }}
                          >
                            <img
                              src={`/api/forms/${selectedForm.id}/images/${img.id}`}
                              alt={img.filename}
                              style={{
                                width: 96,
                                height: 96,
                                objectFit: 'cover',
                                display: 'block',
                                borderRadius: 6
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              </div>

              <section className="editor-panel">
                <div className="editor-heading">
                  <h3>Notas internas (opcional)</h3>
                </div>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Notas para el equipo (no se envían al cliente)"
                  style={{ minHeight: 80 }}
                />
              </section>

              <section className="editor-panel">
                <div className="editor-heading">
                  <h3>Respuesta al cliente</h3>
                  <select
                    value={activeTemplate}
                    onChange={(e) => {
                      const next = e.target.value as TemplateKey;
                      setActiveTemplate(next);
                      setDirty(false);
                    }}
                    style={{
                      borderRadius: 6,
                      border: '1px solid var(--line)',
                      padding: '4px 8px',
                      background: 'var(--surface-inset)'
                    }}
                  >
                    <option value="form_devolucion_aprobada">Plantilla aprobada</option>
                    <option value="form_devolucion_rechazada">Plantilla rechazada</option>
                  </select>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                  }}
                  disabled={selectedForm.status !== 'submitted'}
                  placeholder="Editor de respuesta…"
                />
                <div className="action-bar">
                  <button
                    className="primary-action"
                    type="button"
                    disabled={selectedForm.status !== 'submitted' || !draft.trim() || submitting !== null}
                    onClick={() => performAction('approve')}
                  >
                    {submitting === 'approve' ? 'Enviando…' : 'Aprobar y enviar'}
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={selectedForm.status !== 'submitted' || !draft.trim() || submitting !== null}
                    onClick={() => performAction('reject')}
                  >
                    {submitting === 'reject' ? 'Enviando…' : 'Rechazar y enviar'}
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={selectedForm.status !== 'submitted' || submitting !== null}
                    onClick={() => performAction('manual')}
                  >
                    Manual
                  </button>
                  <button
                    className="danger-action"
                    type="button"
                    disabled={selectedForm.status !== 'submitted' || submitting !== null}
                    onClick={() => performAction('discard')}
                  >
                    Descartar
                  </button>
                </div>
              </section>

              <details className="audit-panel">
                <summary>Auditoría</summary>
                {detail?.auditEvents.length ? (
                  detail.auditEvents.map((event) => (
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
          )}
        </div>
      </section>

      {previewImage && selectedForm ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closePreview}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            cursor: 'zoom-out'
          }}
        >
          <img
            src={`/api/forms/${selectedForm.id}/images/${previewImage.id}`}
            alt={previewImage.filename}
            style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8 }}
          />
        </div>
      ) : null}
    </main>
  );
}

function messageForAction(action: string): string {
  switch (action) {
    case 'approve':
      return 'Respuesta enviada al cliente';
    case 'reject':
      return 'Rechazo enviado al cliente';
    case 'manual':
      return 'Marcado como manual';
    case 'discard':
      return 'Descartado';
    default:
      return 'Acción completada';
  }
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
