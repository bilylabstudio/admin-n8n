FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

ARG APP_SESSION_SECRET
ENV APP_SESSION_SECRET=$APP_SESSION_SECRET

ARG N8N_INGEST_SECRET
ENV N8N_INGEST_SECRET=$N8N_INGEST_SECRET

ARG N8N_SEND_APPROVED_WEBHOOK_URL
ENV N8N_SEND_APPROVED_WEBHOOK_URL=$N8N_SEND_APPROVED_WEBHOOK_URL

ARG N8N_SEND_APPROVED_SECRET
ENV N8N_SEND_APPROVED_SECRET=$N8N_SEND_APPROVED_SECRET

ARG ADMIN_EMAILS
ENV ADMIN_EMAILS=$ADMIN_EMAILS

ARG APP_BASE_URL
ENV APP_BASE_URL=$APP_BASE_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
