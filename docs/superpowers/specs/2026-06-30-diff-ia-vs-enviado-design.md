# Diseño: Comparación "Borrador IA vs Enviado" en la vista de Enviados

Fecha: 2026-06-30
Repo: review-admin (github.com/perezjensen/admin-n8n)
Estado: aprobado (brainstorming) — pendiente de plan de implementación

## Contexto y objetivo

En la vista de **Enviados** del panel de soporte, cuando un ticket fue **editado y enviado** (`edited_sent`), hoy solo se ve el texto que se envió (`finalReply`). No hay forma de ver, junto a él, **el borrador original que propuso la IA** (`aiReply`).

El usuario (operador) quiere poder **ver la diferencia** entre lo que la IA generó y lo que finalmente se envió, para evaluar la calidad de la IA y dar feedback (de forma personal/externa, sin capturar nada en el sistema).

Los datos ya existen en el ticket: `aiReply` (borrador de la IA) y `finalReply` (lo enviado, editado por el humano).

## Alcance

**Dentro:**
- Un colapsable en la burbuja de respuesta enviada del **detalle** del ticket.
- Solo para estado `edited_sent` y solo cuando el enviado difiere realmente del borrador (`isReplyEdited`).
- Diff resaltado **por palabras** (verde = añadido por el humano; rojo tachado = quitado del borrador de la IA).
- 100% cliente. Sin cambios en base de datos ni API.

**Fuera (YAGNI):**
- Captura/almacenamiento de feedback (columna BD, rating, comentario).
- Vista lado a lado o diff por caracteres/líneas.
- Mostrarlo en la lista de tickets (solo en el detalle).
- Cualquier cambio para `approved_sent` (enviado sin cambios: no hay diferencia que mostrar).

## Arquitectura y componentes

Unidades pequeñas y aisladas:

1. **`src/lib/reply-diff.ts`** — lógica pura, sin React.
   - `type DiffSegment = { type: 'equal' | 'added' | 'removed'; text: string }`
   - `computeWordDiff(iaDraft: string, sent: string): DiffSegment[]`
     - Base = `iaDraft` (`aiReply`), objetivo = `sent` (`finalReply`).
     - Tokeniza por palabras conservando los espacios para poder re-renderizar legible.
     - LCS por palabras → segmentos: `equal` (en ambos), `added` (solo en `sent` = lo puso el humano), `removed` (solo en `iaDraft` = lo quitó el humano).
     - Determinista; no depende de React ni del DOM.
   - Sin dependencias nuevas (algoritmo propio, ~40-60 líneas).

2. **Componente de render del diff** — archivo propio (no dentro de `inbox-client.tsx`, que ya ~1600 líneas).
   - Nombre tentativo: `src/app/reply-diff-view.tsx` (client component pequeño).
   - Props: `{ iaDraft: string; sent: string }`.
   - Llama a `computeWordDiff` y pinta los segmentos con clases CSS (`.diff-added`, `.diff-removed`).
   - Incluye una leyenda breve ("verde = añadido · rojo = quitado de la IA").
   - Presentacional puro (sin estado propio salvo lo necesario para render).

3. **Integración en `src/app/inbox-client.tsx`** — burbuja de respuesta enviada (hoy ~líneas 1351-1366).
   - Solo si `ticket.status === 'edited_sent'` **y** `ticket.aiReply` **y** `isReplyEdited(ticket.finalReply, ticket.aiReply)`.
   - Botón colapsable: *"Ver qué cambió respecto a la IA ▾"* / al abrir *"Ocultar comparación ▴"*.
   - Estado de expansión: un `Set<string>` de `ticket.id` expandidos (estado local del componente de conversación), para permitir varios abiertos.
   - Al expandir, renderiza `<ReplyDiffView iaDraft={ticket.aiReply} sent={ticket.finalReply || ''} />`.

4. **Estilos en `src/app/globals.css`**
   - `.diff-added` (fondo/texto verde suave), `.diff-removed` (rojo + `text-decoration: line-through`), estilo del toggle colapsable y la leyenda. Reutiliza tokens/paleta existentes.

## Flujo de datos

```
ticket (ya en cliente: aiReply, finalReply, status)
  └─ si edited_sent && isReplyEdited(finalReply, aiReply):
       toggle colapsable (estado local: Set de ids expandidos)
         └─ al abrir: computeWordDiff(aiReply, finalReply) → segmentos → render con clases CSS
```

No hay llamadas de red nuevas. No hay persistencia.

## Casos borde

- `approved_sent` (enviado sin cambios): no se muestra el toggle.
- `edited_sent` pero `finalReply` normalizado == `aiReply` (edición trivial de espacios): `isReplyEdited` lo trata como no editado → no se muestra (evita "diff vacío").
- `aiReply` vacío (raro en `edited_sent`): no se muestra el toggle.
- Textos muy largos: el diff por palabras se mantiene legible; el colapsable evita saturar la vista por defecto (cerrado).
- Normalización: la tokenización conserva espacios; el diff no altera el contenido, solo lo resalta.

## Pruebas

- **`src/lib/reply-diff.test.ts`** (vitest, como el resto de `lib/`):
  - idéntico → todos `equal`.
  - solo añadido (humano agregó palabras) → segmentos `added`.
  - solo quitado (humano borró palabras de la IA) → segmentos `removed`.
  - mixto (añade y quita) → orden correcto de segmentos.
  - `iaDraft` vacío → todo `added`.
  - `sent` vacío → todo `removed`.
- El componente y la integración son presentacionales; no se añaden tests de UI (fuera de alcance). El resto de la suite no se toca.

## Criterio de éxito

- En un ticket `edited_sent`, al desplegar el colapsable, se ve claramente qué palabras añadió el humano (verde) y cuáles quitó de la IA (rojo tachado), sin salir de la vista de detalle.
- En `approved_sent` no aparece nada nuevo.
- `npm test` verde (incluye el nuevo `reply-diff.test.ts`); `tsc --noEmit` limpio.
