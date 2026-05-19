import { describe, expect, it } from 'vitest';
import {
  STATIC_RETURN_FORM_DEDUPE_STATUSES,
  formatReturnReason,
  parseStoredReturnReason,
  parseReturnFormInput,
  validateReturnFormInput,
  type ReturnFormInput
} from './return-form-fields';

const validInput: ReturnFormInput = {
  purchaseEmail: 'cliente@example.com',
  orderNumber: '#1234',
  productAffected: 'V-Gummies Sleep',
  returnReason: 'Producto danado',
  reasonDetail: 'El frasco llego abierto',
  caseExplanation: 'La caja venia golpeada y el producto estaba derramado.'
};

describe('parseReturnFormInput', () => {
  it('trims fields and normalizes purchase email', () => {
    const data = new FormData();
    data.set('purchaseEmail', ' CLIENTE@EXAMPLE.COM ');
    data.set('orderNumber', ' #1234 ');
    data.set('productAffected', ' Producto ');
    data.set('returnReason', ' Motivo ');
    data.set('reasonDetail', ' Detalle ');
    data.set('caseExplanation', ' Explicacion completa ');

    expect(parseReturnFormInput(data)).toEqual({
      purchaseEmail: 'cliente@example.com',
      orderNumber: '#1234',
      productAffected: 'Producto',
      returnReason: 'Motivo',
      reasonDetail: 'Detalle',
      caseExplanation: 'Explicacion completa'
    });
  });
});

describe('validateReturnFormInput', () => {
  it('accepts the approved required fields', () => {
    expect(validateReturnFormInput(validInput)).toBeNull();
  });

  it('rejects missing required fields with stable error codes', () => {
    expect(validateReturnFormInput({ ...validInput, purchaseEmail: 'bad' })).toBe('invalid_email');
    expect(validateReturnFormInput({ ...validInput, orderNumber: '' })).toBe('missing_order_number');
    expect(validateReturnFormInput({ ...validInput, productAffected: '' })).toBe(
      'missing_product_affected'
    );
    expect(validateReturnFormInput({ ...validInput, returnReason: '' })).toBe(
      'missing_return_reason'
    );
    expect(validateReturnFormInput({ ...validInput, reasonDetail: '' })).toBe(
      'missing_reason_detail'
    );
    expect(validateReturnFormInput({ ...validInput, caseExplanation: 'corto' })).toBe(
      'case_explanation_too_short'
    );
  });
});

describe('formatReturnReason', () => {
  it('stores the new fields as a readable reason block', () => {
    const formatted = formatReturnReason(validInput);

    expect(formatted).toContain('Producto afectado: V-Gummies Sleep');
    expect(formatted).toContain('Motivo de devolucion: Producto danado');
    expect(formatted).toContain('Detalle del motivo: El frasco llego abierto');
    expect(formatted).toContain('Explicacion del caso: La caja venia golpeada');
  });
});

describe('parseStoredReturnReason', () => {
  it('extracts the structured fields saved in reason', () => {
    expect(parseStoredReturnReason(formatReturnReason(validInput))).toEqual({
      productAffected: 'V-Gummies Sleep',
      returnReason: 'Producto danado',
      reasonDetail: 'El frasco llego abierto',
      caseExplanation: 'La caja venia golpeada y el producto estaba derramado.'
    });
  });

  it('returns an empty object for legacy free-text reasons', () => {
    expect(parseStoredReturnReason('Cliente escribio texto libre antiguo')).toEqual({});
  });
});

describe('STATIC_RETURN_FORM_DEDUPE_STATUSES', () => {
  it('does not dedupe static submissions against invisible pending token rows', () => {
    expect(STATIC_RETURN_FORM_DEDUPE_STATUSES).toEqual(['submitted']);
    expect(STATIC_RETURN_FORM_DEDUPE_STATUSES).not.toContain('pending');
  });
});
