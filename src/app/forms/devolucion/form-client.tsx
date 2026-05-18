'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type SelectedFile = { file: File; sizeKb: number };

export function FormClient() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [purchaseEmail, setPurchaseEmail] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next: SelectedFile[] = [...files];
    for (const file of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setError(`Máximo ${MAX_FILES} archivos.`);
        break;
      }
      if (file.size > MAX_BYTES) {
        setError(`Cada archivo debe pesar menos de ${MAX_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      if (!ALLOWED_MIME.includes(file.type)) {
        setError('Solo JPG, PNG, WEBP o HEIC.');
        continue;
      }
      next.push({ file, sizeKb: Math.round(file.size / 1024) });
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => {
    setFiles((current) => current.filter((_, i) => i !== idx));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_RE.test(email.trim())) {
      setError('Email inválido.');
      return;
    }
    if (orderNumber.trim().length === 0) {
      setError('Falta el número de pedido.');
      return;
    }
    if (reason.trim().length < 10) {
      setError('Cuéntanos el motivo con un poco más de detalle (mínimo 10 caracteres).');
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set('email', email.trim().toLowerCase());
      body.set('orderNumber', orderNumber.trim());
      body.set('purchaseEmail', purchaseEmail.trim());
      body.set('reason', reason.trim());
      body.set('_hp', honeypot);
      for (const f of files) body.append('files', f.file);

      const res = await fetch('/api/forms/devolucion/submit', {
        method: 'POST',
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(translateError(data.error) || 'No se pudo enviar la solicitud.');
        setSubmitting(false);
        return;
      }

      router.push(`/forms/devolucion/confirmacion/${data.form_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      setSubmitting(false);
    }
  };

  return (
    <form className="public-form" onSubmit={submit} noValidate>
      <label className="public-form-field">
        <span>Email *</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Número de pedido *</span>
        <input
          name="orderNumber"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="#12345"
          autoComplete="off"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Email con que compraste (si es distinto)</span>
        <input
          type="email"
          name="purchaseEmail"
          value={purchaseEmail}
          onChange={(e) => setPurchaseEmail(e.target.value)}
          placeholder="opcional"
          autoComplete="off"
        />
      </label>

      <label className="public-form-field">
        <span>Motivo de la devolución *</span>
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={5}
          placeholder="Describe qué pasó con el producto"
          required
        />
      </label>

      <div className="public-form-field">
        <span>Fotos del producto (máx 3 · 5 MB c/u)</span>
        <input
          type="file"
          multiple
          accept={ALLOWED_MIME.join(',')}
          onChange={(e) => addFiles(e.target.files)}
        />
        {files.length > 0 ? (
          <ul className="public-form-files">
            {files.map((f, i) => (
              <li key={i}>
                <span>{f.file.name} · {f.sizeKb} KB</span>
                <button type="button" onClick={() => removeFile(i)}>Quitar</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}
      >
        <label>
          No rellenes este campo
          <input
            type="text"
            name="_hp"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="public-form-error">{error}</p> : null}

      <button className="public-form-submit" type="submit" disabled={submitting}>
        {submitting ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </form>
  );
}

function translateError(code: string | undefined): string {
  switch (code) {
    case 'rate_limited':
      return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
    case 'invalid_email':
      return 'El email no parece válido.';
    case 'missing_order_number':
      return 'Falta el número de pedido.';
    case 'reason_too_short':
      return 'El motivo debe tener al menos 10 caracteres.';
    case 'too_many_files':
      return `Máximo ${MAX_FILES} archivos.`;
    case 'file_too_large':
      return `Cada archivo debe pesar menos de ${MAX_BYTES / 1024 / 1024} MB.`;
    case 'unsupported_mime':
      return 'Solo se admiten imágenes JPG, PNG, WEBP o HEIC.';
    case 'total_size_exceeded':
      return 'El total de archivos supera el máximo permitido.';
    default:
      return '';
  }
}
