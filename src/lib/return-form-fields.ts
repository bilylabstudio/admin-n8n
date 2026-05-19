export type ReturnFormInput = {
  purchaseEmail: string;
  orderNumber: string;
  productAffected: string;
  returnReason: string;
  reasonDetail: string;
  caseExplanation: string;
};

export type ReturnFormValidationError =
  | 'invalid_email'
  | 'missing_order_number'
  | 'missing_product_affected'
  | 'missing_return_reason'
  | 'missing_reason_detail'
  | 'case_explanation_too_short';

export const STATIC_RETURN_FORM_DEDUPE_STATUSES = ['submitted'] as const;

const STORED_REASON_LABELS: {
  key: keyof Pick<ReturnFormInput, 'productAffected' | 'returnReason' | 'reasonDetail' | 'caseExplanation'>;
  label: string;
}[] = [
  { key: 'productAffected', label: 'Producto afectado:' },
  { key: 'returnReason', label: 'Motivo de devolucion:' },
  { key: 'reasonDetail', label: 'Detalle del motivo:' },
  { key: 'caseExplanation', label: 'Explicacion del caso:' }
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CASE_EXPLANATION_MIN_LENGTH = 10;

function clean(value: FormDataEntryValue | string | null): string {
  return String(value ?? '').trim();
}

export function parseReturnFormInput(formData: FormData): ReturnFormInput {
  return {
    purchaseEmail: clean(formData.get('purchaseEmail')).toLowerCase(),
    orderNumber: clean(formData.get('orderNumber')),
    productAffected: clean(formData.get('productAffected')),
    returnReason: clean(formData.get('returnReason')),
    reasonDetail: clean(formData.get('reasonDetail')),
    caseExplanation: clean(formData.get('caseExplanation'))
  };
}

export function validateReturnFormInput(input: ReturnFormInput): ReturnFormValidationError | null {
  if (!EMAIL_RE.test(input.purchaseEmail)) return 'invalid_email';
  if (!input.orderNumber) return 'missing_order_number';
  if (!input.productAffected) return 'missing_product_affected';
  if (!input.returnReason) return 'missing_return_reason';
  if (!input.reasonDetail) return 'missing_reason_detail';
  if (input.caseExplanation.length < CASE_EXPLANATION_MIN_LENGTH) return 'case_explanation_too_short';
  return null;
}

export function formatReturnReason(input: ReturnFormInput): string {
  return [
    `Producto afectado: ${input.productAffected}`,
    `Motivo de devolucion: ${input.returnReason}`,
    `Detalle del motivo: ${input.reasonDetail}`,
    `Explicacion del caso: ${input.caseExplanation}`
  ].join('\n\n');
}

export function parseStoredReturnReason(
  reason: string | null | undefined
): Partial<Pick<ReturnFormInput, 'productAffected' | 'returnReason' | 'reasonDetail' | 'caseExplanation'>> {
  const text = String(reason ?? '');
  const parsed: Partial<
    Pick<ReturnFormInput, 'productAffected' | 'returnReason' | 'reasonDetail' | 'caseExplanation'>
  > = {};

  for (const item of STORED_REASON_LABELS) {
    const start = text.indexOf(item.label);
    if (start === -1) continue;

    const valueStart = start + item.label.length;
    const nextLabelStart = STORED_REASON_LABELS.map((candidate) => text.indexOf(candidate.label, valueStart))
      .filter((idx) => idx > valueStart)
      .sort((a, b) => a - b)[0];

    parsed[item.key] = text.slice(valueStart, nextLabelStart ?? text.length).trim();
  }

  return parsed;
}
