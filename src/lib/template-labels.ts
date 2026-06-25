export type TemplateFamily =
  | 'suscripcion'
  | 'producto'
  | 'devolucion_reembolso'
  | 'envios'
  | 'pedido_pago'
  | 'sin_etiqueta';

export type SentimentValue = 'molesto' | 'neutral' | 'contento';

export type TemplateLabel = {
  label: string;
  family: TemplateFamily;
};

export const FAMILY_LABELS: Record<TemplateFamily, string> = {
  suscripcion: 'Suscripcion',
  producto: 'Producto',
  devolucion_reembolso: 'Devolucion y reembolso',
  envios: 'Envios',
  pedido_pago: 'Pedido y pago',
  sin_etiqueta: 'Sin etiqueta cerrada'
};

export const SENTIMENT_LABELS: Record<SentimentValue, string> = {
  molesto: 'Molestos',
  neutral: 'Neutrales',
  contento: 'Contentos'
};

export const ROUTE_SOURCE_LABELS: Record<string, string> = {
  canonical_router: 'Router canonico',
  sub_specialist: 'Especialista suscripcion',
  subscription_order_context: 'Contexto pedido suscripcion',
  approved_memory: 'Memoria aprobada',
  special_case: 'Caso especial',
  llm_draft: 'Borrador IA',
  backfill_router: 'Backfill router',
  backfill_llm: 'Backfill IA',
  fallback_email: 'Fallback email'
};

export const TEMPLATE_LABELS: Record<string, TemplateLabel> = {
  sub_baja_generica: { label: 'Como darse de baja', family: 'suscripcion' },
  sub_explicacion_condiciones: {
    label: 'Suscripcion generada: condiciones',
    family: 'suscripcion'
  },
  sub_suscripcion_pedido_generado: {
    label: 'Suscripcion: pedido generado',
    family: 'suscripcion'
  },
  sub_suscripcion_pedido_no_generado: {
    label: 'Suscripcion: pedido no generado',
    family: 'suscripcion'
  },
  sub_reclama_devolucion_suscripcion: {
    label: 'Reclama devolucion por suscripcion',
    family: 'suscripcion'
  },
  sub_clienta_pesada: { label: 'Suscripcion insistente', family: 'suscripcion' },
  sub_amenaza_denuncia: { label: 'Suscripcion amenaza denuncia', family: 'suscripcion' },
  sub_pedido_en_camino: { label: 'Pedido de suscripcion en camino', family: 'suscripcion' },
  sub_pedido_recibido_devolucion: {
    label: 'Suscripcion recibida y quiere devolver',
    family: 'suscripcion'
  },
  sub_pedido_no_salido_excepcion: {
    label: 'Suscripcion generada no enviada',
    family: 'suscripcion'
  },
  sub_confirmar_cancelacion: { label: 'Confirmar cancelacion', family: 'suscripcion' },
  sub_cancelacion_recibida: { label: 'Correo de cancelacion recibido', family: 'suscripcion' },
  sub_cancelacion_recibida_repetida: {
    label: 'Cancelacion ya recibida repetida',
    family: 'suscripcion'
  },
  sub_sigue_activa_verificar: { label: 'Suscripcion sigue activa', family: 'suscripcion' },
  sub_cancelada_pedido_sigue_en_pie: {
    label: 'Cancelada pero pedido sigue en pie',
    family: 'suscripcion'
  },
  sub_enlace_no_funciona: { label: 'Enlace de baja no funciona', family: 'suscripcion' },
  sub_enlace_no_funciona_frustracion: {
    label: 'Enlace de baja con frustracion',
    family: 'suscripcion'
  },

  prod_resultados_tiempo: { label: 'Tiempo para ver resultados', family: 'producto' },
  prod_como_tomar: { label: 'Como tomar las gominolas', family: 'producto' },
  prod_feedback_digestiones: { label: 'Feedback digestiones', family: 'producto' },
  prod_azucar_diabetes: { label: 'Azucar o diabetes', family: 'producto' },
  prod_molestias_digestivas: { label: 'Molestias digestivas', family: 'producto' },
  prod_tragadas_enteras: { label: 'Gominolas tragadas enteras', family: 'producto' },
  prod_sleep_info: { label: 'Informacion producto Sleep', family: 'producto' },
  prod_consejos_inicio: { label: 'Consejos al iniciar tratamiento', family: 'producto' },
  prod_origen_espana: { label: 'Origen fabricacion Espana', family: 'producto' },
  prod_seguimiento_tratamiento: { label: 'Seguimiento del tratamiento', family: 'producto' },

  reembolso_ya_emitido: { label: 'Reembolso ya emitido', family: 'devolucion_reembolso' },
  pedido_anulado_reembolsado: {
    label: 'Pedido anulado y reembolsado',
    family: 'devolucion_reembolso'
  },
  dev_3x2_abierta: { label: '3x2 con bolsa abierta', family: 'devolucion_reembolso' },
  dev_envio_recibido_confirmacion: {
    label: 'Confirmacion de envio de devolucion',
    family: 'devolucion_reembolso'
  },
  dev_3x2_dos_cerradas: {
    label: '3x2 con dos bolsas cerradas',
    family: 'devolucion_reembolso'
  },
  dev_3x2_dos_cerradas_detalle: {
    label: 'Detalle 3x2 dos bolsas cerradas',
    family: 'devolucion_reembolso'
  },
  dev_3x2_condiciones_disputa: {
    label: 'Disputa condiciones 3x2',
    family: 'devolucion_reembolso'
  },
  dev_producto_cerrado_direccion: {
    label: 'Producto cerrado y direccion',
    family: 'devolucion_reembolso'
  },
  dev_recibido_devolucion_sin_intro: {
    label: 'Instrucciones devolucion sin intro',
    family: 'devolucion_reembolso'
  },
  dev_motivo_devolucion: { label: 'Pedir motivo de devolucion', family: 'devolucion_reembolso' },

  envio_no_registrado_sale_hoy: { label: 'Pedido no registrado sale hoy', family: 'envios' },
  envio_transporte_revision: { label: 'Revision con transporte', family: 'envios' },
  envio_preventa_22junio: { label: 'Pedido en preventa', family: 'envios' },
  envio_direccion_pedir: { label: 'Pedir direccion correcta', family: 'envios' },
  envio_direccion_editada: { label: 'Direccion editada', family: 'envios' },
  envio_punto_recogida: { label: 'Cambiar a punto de recogida', family: 'envios' },
  envio_punto_recogida_preventa: {
    label: 'Punto de recogida en preventa',
    family: 'envios'
  },
  envio_pedido_incompleto: { label: 'Pedido incompleto', family: 'envios' },

  promo_3x2_unidades_individuales: {
    label: 'Promo 3x2 unidades individuales',
    family: 'pedido_pago'
  }
};

const PREFIX_FAMILIES: Array<[string, TemplateFamily]> = [
  ['sub_', 'suscripcion'],
  ['prod_', 'producto'],
  ['dev_', 'devolucion_reembolso'],
  ['reembolso_', 'devolucion_reembolso'],
  ['envio_', 'envios'],
  ['pedido_', 'pedido_pago'],
  ['promo_', 'pedido_pago']
];

export function templateFamily(templateId: string | null | undefined): TemplateFamily {
  if (!templateId) return 'sin_etiqueta';

  const known = TEMPLATE_LABELS[templateId];
  if (known) return known.family;

  return PREFIX_FAMILIES.find(([prefix]) => templateId.startsWith(prefix))?.[1] ?? 'sin_etiqueta';
}

export function templateLabelFor(templateId: string | null | undefined): TemplateLabel {
  if (!templateId) {
    return {
      label: 'Sin etiqueta cerrada / borrador IA',
      family: 'sin_etiqueta'
    };
  }

  return (
    TEMPLATE_LABELS[templateId] ?? {
      label: `Plantilla sin registrar (${templateId})`,
      family: templateFamily(templateId)
    }
  );
}

export function routeSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Sin fuente';
  return ROUTE_SOURCE_LABELS[source] ?? source;
}
