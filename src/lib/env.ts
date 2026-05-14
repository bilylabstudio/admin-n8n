import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_SESSION_SECRET: z.string().min(32),
  N8N_INGEST_SECRET: z.string().min(16),
  N8N_SEND_APPROVED_WEBHOOK_URL: z.string().url(),
  N8N_SEND_APPROVED_SECRET: z.string().min(16),
  ADMIN_EMAILS: z.string().min(1),
  APP_BASE_URL: z.string().url().optional()
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  N8N_INGEST_SECRET: process.env.N8N_INGEST_SECRET,
  N8N_SEND_APPROVED_WEBHOOK_URL: process.env.N8N_SEND_APPROVED_WEBHOOK_URL,
  N8N_SEND_APPROVED_SECRET: process.env.N8N_SEND_APPROVED_SECRET,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  APP_BASE_URL: process.env.APP_BASE_URL
});

export function adminEmailSet(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}
