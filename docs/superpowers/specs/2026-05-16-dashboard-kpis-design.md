# Dashboard de KPIs de Soporte — Diseño

**Fecha:** 2026-05-16  
**Estado:** Aprobado

## Objetivo

Página `/dashboard` en el Review Admin que muestra métricas de soporte en tiempo real e histórico, sin cambios en la base de datos.

## Arquitectura

- **Página:** `/dashboard` — Server Component para render inicial + Client Component para polling
- **API:** `GET /api/dashboard?period=7d|30d|90d` — una sola ruta con todas las agregaciones Prisma
- **Refresco:** polling cada 30 segundos, indicador "Actualizado hace X s"
- **Sin migraciones:** usa `Ticket` y `AuditEvent` tal como están

## Sección 1 — Tiempo real (4 tarjetas superiores)

| Tarjeta | Dato | Query |
|---------|------|-------|
| Pendientes ahora | Tickets en `pending_review`, `new`, `ai_generated` | `COUNT WHERE status IN (...)` |
| Espera promedio hoy | Minutos desde `receivedAt` de tickets pendientes | `AVG(NOW - receivedAt) WHERE pending` |
| Recibidos hoy | Tickets creados en últimas 24h | `COUNT WHERE receivedAt > NOW-24h` |
| Errores de envío | Tickets en `send_failed` activos | `COUNT WHERE status = 'send_failed'` |

## Sección 2 — KPIs históricos (selector 7d / 30d / 90d)

- **Volumen por día:** barras con `receivedAt` agrupado por día
- **Tiempo medio de respuesta:** `AVG(sentAt - receivedAt)` en minutos por día
- **Precisión IA:** donut — `approved_sent` / `edited_sent` / `discarded` / `manual`
- **Tasa de escalación:** % tickets con `escalationRecommended = true`

## Sección 3 — Dudas frecuentes

- Top 10 `category` y Top 10 `intent` del período seleccionado
- Tabla con nombre + count + barra proporcional

## Sección 4 — Satisfacción (proxy, sin campo real)

- **Calidad IA:** ratio `approved_sent / (approved_sent + edited_sent)`
- **Tasa de abandono:** `discarded / total` en el período
- **Casos sensibles:** % con `riskFlags` no vacío o `escalationRecommended = true`

## Componentes a crear

1. `src/app/dashboard/page.tsx` — página con datos iniciales SSR
2. `src/app/dashboard/dashboard-client.tsx` — polling + estado reactivo
3. `src/app/api/dashboard/route.ts` — agregaciones Prisma
4. Estilos en `globals.css` (nuevas clases `.dashboard-*`)

## Datos de la API

```ts
type DashboardData = {
  realtime: {
    pendingNow: number;
    avgWaitMinutes: number;
    receivedToday: number;
    sendFailed: number;
  };
  period: '7d' | '30d' | '90d';
  volumeByDay: { date: string; count: number }[];
  avgResponseByDay: { date: string; avgMinutes: number }[];
  statusBreakdown: { status: string; count: number }[];
  topCategories: { category: string; count: number }[];
  topIntents: { intent: string; count: number }[];
  escalationRate: number;
  aiAccuracy: number;
  abandonRate: number;
  sensitiveRate: number;
  serverTime: string;
};
```
