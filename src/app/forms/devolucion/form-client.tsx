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
  const [purchaseEmail, setPurchaseEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [productAffected, setProductAffected] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [caseExplanation, setCaseExplanation] = useState('');
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next: SelectedFile[] = [...files];
    for (const file of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setError(`Maximo ${MAX_FILES} archivos.`);
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

    if (!EMAIL_RE.test(purchaseEmail.trim())) {
      setError('El email de compra no parece valido.');
      return;
    }
    if (!orderNumber.trim()) {
      setError('Falta el numero de pedido.');
      return;
    }
    if (!productAffected.trim()) {
      setError('Falta el producto afectado.');
      return;
    }
    if (!returnReason.trim()) {
      setError('Falta el motivo de devolucion.');
      return;
    }
    if (!reasonDetail.trim()) {
      setError('Falta el detalle del motivo.');
      return;
    }
    if (caseExplanation.trim().length < 10) {
      setError('Explica el caso con un poco mas de detalle.');
      return;
    }
    if (files.length === 0) {
      setError('Adjunta al menos una foto o evidencia.');
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set('purchaseEmail', purchaseEmail.trim().toLowerCase());
      body.set('orderNumber', orderNumber.trim());
      body.set('productAffected', productAffected.trim());
      body.set('returnReason', returnReason.trim());
      body.set('reasonDetail', reasonDetail.trim());
      body.set('caseExplanation', caseExplanation.trim());
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
        <span>Email de compra *</span>
        <input
          type="email"
          name="purchaseEmail"
          value={purchaseEmail}
          onChange={(e) => setPurchaseEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Numero de pedido *</span>
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
        <span>Producto afectado *</span>
        <input
          name="productAffected"
          value={productAffected}
          onChange={(e) => setProductAffected(e.target.value)}
          placeholder="Nombre del producto"
          autoComplete="off"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Motivo de devolucion *</span>
        <input
          name="returnReason"
          value={returnReason}
          onChange={(e) => setReturnReason(e.target.value)}
          placeholder="Producto danado, equivocado, incompleto..."
          autoComplete="off"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Detalle del motivo *</span>
        <textarea
          name="reasonDetail"
          value={reasonDetail}
          onChange={(e) => setReasonDetail(e.target.value)}
          rows={4}
          placeholder="Describe el problema principal"
          required
        />
      </label>

      <label className="public-form-field">
        <span>Explicacion del caso *</span>
        <textarea
          name="caseExplanation"
          value={caseExplanation}
          onChange={(e) => setCaseExplanation(e.target.value)}
          rows={5}
          placeholder="Cuentanos que paso, cuando lo notaste y cualquier detalle util"
          required
        />
      </label>

      <div className="public-form-field">
        <span>Fotos o evidencia *</span>
        <input
          type="file"
          multiple
          accept={ALLOWED_MIME.join(',')}
          onChange={(e) => addFiles(e.target.files)}
        />
        {files.length > 0 ? (
          <ul className="public-form-files">
            {files.map((f, i) => (
              <li key={`${f.file.name}-${i}`}>
                <span>
                  {f.file.name} - {f.sizeKb} KB
                </span>
                <button type="button" onClick={() => removeFile(i)}>
                  Quitar
                </button>
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
        {submitting ? 'Enviando...' : 'Enviar solicitud'}
      </button>
    </form>
  );
}

function translateError(code: string | undefined): string {
  switch (code) {
    case 'rate_limited':
      return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
    case 'invalid_email':
      return 'El email de compra no parece valido.';
    case 'missing_order_number':
      return 'Falta el numero de pedido.';
    case 'missing_product_affected':
      return 'Falta el producto afectado.';
    case 'missing_return_reason':
      return 'Falta el motivo de devolucion.';
    case 'missing_reason_detail':
      return 'Falta el detalle del motivo.';
    case 'case_explanation_too_short':
      return 'Explica el caso con un poco mas de detalle.';
    case 'missing_evidence':
      return 'Adjunta al menos una foto o evidencia.';
    case 'too_many_files':
      return `Maximo ${MAX_FILES} archivos.`;
    case 'file_too_large':
      return `Cada archivo debe pesar menos de ${MAX_BYTES / 1024 / 1024} MB.`;
    case 'unsupported_mime':
      return 'Solo se admiten imagenes JPG, PNG, WEBP o HEIC.';
    case 'total_size_exceeded':
      return 'El total de archivos supera el maximo permitido.';
    default:
      return '';
  }
}
