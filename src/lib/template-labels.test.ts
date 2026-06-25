import { describe, expect, it } from 'vitest';
import { templateLabelFor } from './template-labels';

describe('template labels', () => {
  it('registers the visible subscription order labels', () => {
    expect(templateLabelFor('sub_suscripcion_pedido_generado')).toEqual({
      label: 'Suscripcion: pedido generado',
      family: 'suscripcion'
    });
    expect(templateLabelFor('sub_suscripcion_pedido_no_generado')).toEqual({
      label: 'Suscripcion: pedido no generado',
      family: 'suscripcion'
    });
  });
});
