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
  // ==========================================
  // 1. SUSCRIPCIÓN (3 Subcategorías)
  // ==========================================
  sub_baja_generica: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_explicacion_condiciones: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_suscripcion_pedido_generado: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_suscripcion_pedido_no_generado: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_pedido_en_camino: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_pedido_no_salido_excepcion: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_confirmar_cancelacion: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_confirmar_cancelacion_revisar: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_cancelacion_recibida: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_cancelacion_recibida_repetida: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_sigue_activa_verificar: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_cancelada_pedido_sigue_en_pie: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_enlace_no_funciona: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },
  sub_enlace_no_funciona_frustracion: { label: 'No quiere / Quiere darse de baja', family: 'suscripcion' },

  sub_reclama_devolucion_suscripcion: { label: 'Quiere devolución dinero', family: 'suscripcion' },
  sub_pedido_recibido_devolucion: { label: 'Quiere devolución dinero', family: 'suscripcion' },

  sub_amenaza_denuncia: { label: 'Quiere denunciar quiere llegar mas lejos', family: 'suscripcion' },
  sub_clienta_pesada: { label: 'Quiere denunciar quiere llegar mas lejos', family: 'suscripcion' },

  // ==========================================
  // 2. PRODUCTO (3 Subcategorías)
  // ==========================================
  prod_como_tomar: { label: 'Modo de uso y recomendaciones', family: 'producto' },
  prod_consejos_inicio: { label: 'Modo de uso y recomendaciones', family: 'producto' },
  prod_tragadas_enteras: { label: 'Modo de uso y recomendaciones', family: 'producto' },

  prod_resultados_tiempo: { label: 'Efectos, tiempo e información del producto', family: 'producto' },
  prod_sleep_info: { label: 'Efectos, tiempo e información del producto', family: 'producto' },
  prod_seguimiento_tratamiento: { label: 'Efectos, tiempo e información del producto', family: 'producto' },
  prod_origen_espana: { label: 'Efectos, tiempo e información del producto', family: 'producto' },

  prod_azucar_diabetes: { label: 'Salud, azúcar y molestias digestivas', family: 'producto' },
  prod_molestias_digestivas: { label: 'Salud, azúcar y molestias digestivas', family: 'producto' },
  prod_feedback_digestiones: { label: 'Salud, azúcar y molestias digestivas', family: 'producto' },
  prod_interaccion_medicacion: { label: 'Salud, azúcar y molestias digestivas', family: 'producto' },

  // ==========================================
  // 3. DEVOLUCIÓN Y REEMBOLSO (3 Subcategorías)
  // ==========================================
  reembolso_ya_emitido: { label: 'Estado / Confirmación de reembolso', family: 'devolucion_reembolso' },
  pedido_anulado_reembolsado: { label: 'Estado / Confirmación de reembolso', family: 'devolucion_reembolso' },

  dev_motivo_devolucion: { label: 'Gestión e instrucciones de devolución', family: 'devolucion_reembolso' },
  dev_envio_recibido_confirmacion: { label: 'Gestión e instrucciones de devolución', family: 'devolucion_reembolso' },
  dev_recibido_devolucion_sin_intro: { label: 'Gestión e instrucciones de devolución', family: 'devolucion_reembolso' },
  dev_producto_cerrado_direccion: { label: 'Gestión e instrucciones de devolución', family: 'devolucion_reembolso' },
  dev_pregunta_precinto: { label: 'Gestión e instrucciones de devolución', family: 'devolucion_reembolso' },

  dev_3x2_abierta: { label: 'Condiciones de devolución y promociones (3x2)', family: 'devolucion_reembolso' },
  dev_3x2_dos_cerradas: { label: 'Condiciones de devolución y promociones (3x2)', family: 'devolucion_reembolso' },
  dev_3x2_dos_cerradas_detalle: { label: 'Condiciones de devolución y promociones (3x2)', family: 'devolucion_reembolso' },
  dev_3x2_condiciones_disputa: { label: 'Condiciones de devolución y promociones (3x2)', family: 'devolucion_reembolso' },

  // ==========================================
  // 4. ENVÍOS (3 Subcategorías)
  // ==========================================
  envio_tracking_en_transito: { label: 'Seguimiento y estado del envío', family: 'envios' },
  envio_no_registrado_sale_hoy: { label: 'Seguimiento y estado del envío', family: 'envios' },
  envio_preventa_22junio: { label: 'Seguimiento y estado del envío', family: 'envios' },

  envio_direccion_pedir: { label: 'Modificación de dirección o punto de recogida', family: 'envios' },
  envio_direccion_editada: { label: 'Modificación de dirección o punto de recogida', family: 'envios' },
  envio_punto_recogida: { label: 'Modificación de dirección o punto de recogida', family: 'envios' },
  envio_punto_recogida_preventa: { label: 'Modificación de dirección o punto de recogida', family: 'envios' },

  envio_transporte_revision: { label: 'Incidencias con transporte o paquete', family: 'envios' },
  envio_pedido_incompleto: { label: 'Incidencias con transporte o paquete', family: 'envios' },
  envio_recontactar_urgente: { label: 'Incidencias con transporte o paquete', family: 'envios' },

  // ==========================================
  // 5. PEDIDO Y PAGO Y OTROS
  // ==========================================
  promo_3x2_unidades_individuales: { label: 'Dudas promociones y pago', family: 'pedido_pago' },
  comm_baja_emails_revisar: { label: 'Baja de correos comerciales', family: 'sin_etiqueta' }
};

const PREFIX_FAMILIES: Array<[string, TemplateFamily]> = [
  ['sub_', 'suscripcion'],
  ['prod_', 'producto'],
  ['dev_', 'devolucion_reembolso'],
  ['reembolso_', 'devolucion_reembolso'],
  ['envio_', 'envios'],
  ['pedido_', 'pedido_pago'],
  ['promo_', 'pedido_pago'],
  ['comm_', 'sin_etiqueta']
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

  const known = TEMPLATE_LABELS[templateId];
  if (known) return known;

  // Limpieza automática si llega un ID nuevo no registrado previamente
  const cleanId = templateId
    .replace(/^(sub_|prod_|dev_|envio_|pedido_|promo_|comm_)/, '')
    .replace(/_/g, ' ');

  return {
    label: cleanId.charAt(0).toUpperCase() + cleanId.slice(1),
    family: templateFamily(templateId)
  };
}

export function routeSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Sin fuente';
  return ROUTE_SOURCE_LABELS[source] ?? source;
}
