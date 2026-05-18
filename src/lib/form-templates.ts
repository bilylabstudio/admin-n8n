export type FormTemplateKey =
  | 'form_devolucion_aprobada'
  | 'form_devolucion_rechazada'
  | 'form_devolucion_recibida';

export type FormTemplateVars = {
  nombre: string;
  orderNumber?: string;
  formId?: string;
  motivo?: string;
};

function interpolate(template: string, vars: FormTemplateVars): string {
  return template
    .replaceAll('{nombre}', vars.nombre?.trim() || 'cliente')
    .replaceAll('{orderNumber}', vars.orderNumber?.trim() || 'el pedido indicado')
    .replaceAll('{formId}', vars.formId?.trim() || '')
    .replaceAll('{motivo}', vars.motivo?.trim() || '');
}

const templates: Record<FormTemplateKey, string> = {
  form_devolucion_aprobada: `¡Hola {nombre}! 💚

Hemos validado tu solicitud para el pedido #{orderNumber}. Procedemos con la devolución.

En las próximas 48 horas recibirás un email con las instrucciones para enviar el producto y los detalles del reembolso.

Gracias por tu paciencia.`,

  form_devolucion_rechazada: `Hola {nombre},

Hemos revisado tu solicitud y, lamentablemente, no podemos procesar la devolución en esta ocasión.

{motivo}

Si necesitas más información o quieres aclarar algún punto, responde a este email y te atendemos personalmente.`,

  form_devolucion_recibida: `¡Hola {nombre}! 💚

Hemos recibido tu solicitud de devolución (ID: {formId}). Nuestro equipo la revisará y te responderá en un plazo de 24-48 horas.

Si necesitas añadir información, simplemente responde a este email.`
};

export function renderTemplate(key: FormTemplateKey, vars: FormTemplateVars): string {
  return interpolate(templates[key], vars);
}

export function subjectForTemplate(key: FormTemplateKey): string {
  switch (key) {
    case 'form_devolucion_aprobada':
      return 'Hemos aprobado tu solicitud de devolución';
    case 'form_devolucion_rechazada':
      return 'Hemos revisado tu solicitud de devolución';
    case 'form_devolucion_recibida':
      return 'Hemos recibido tu solicitud de devolución';
  }
}
