import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_SESSION_SECRET: z.string().min(32),
  N8N_INGEST_SECRET: z.string().min(16),
  N8N_SEND_APPROVED_WEBHOOK_URL: z.string().url(),
  N8N_SEND_APPROVED_SECRET: z.string().min(16),
  N8N_FORMS_MINT_SECRET: z.string().min(16).optional(),
  ADMIN_EMAILS: z.string().min(1),
  APP_BASE_URL: z.string().url().optional(),
  WEBMAIL_SYNC_ENABLED: z.string().optional().default('false'),
  WEBMAIL_IMAP_HOST: z.string().optional(),
  WEBMAIL_IMAP_PORT: z.string().optional().default('993'),
  WEBMAIL_IMAP_SECURE: z.string().optional().default('true'),
  WEBMAIL_IMAP_USER: z.string().optional(),
  WEBMAIL_IMAP_PASSWORD: z.string().optional(),
  WEBMAIL_IMAP_MAILBOX: z.string().optional().default('INBOX'),
  WEBMAIL_IMAP_SENT_MAILBOX: z.string().optional().default('Sent'),
  WEBMAIL_IMAP_APPEND_SENT_ENABLED: z.string().optional().default('false')
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  N8N_INGEST_SECRET: process.env.N8N_INGEST_SECRET,
  N8N_SEND_APPROVED_WEBHOOK_URL: process.env.N8N_SEND_APPROVED_WEBHOOK_URL,
  N8N_SEND_APPROVED_SECRET: process.env.N8N_SEND_APPROVED_SECRET,
  N8N_FORMS_MINT_SECRET: process.env.N8N_FORMS_MINT_SECRET,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  APP_BASE_URL: process.env.APP_BASE_URL,
  WEBMAIL_SYNC_ENABLED: process.env.WEBMAIL_SYNC_ENABLED,
  WEBMAIL_IMAP_HOST: process.env.WEBMAIL_IMAP_HOST,
  WEBMAIL_IMAP_PORT: process.env.WEBMAIL_IMAP_PORT,
  WEBMAIL_IMAP_SECURE: process.env.WEBMAIL_IMAP_SECURE,
  WEBMAIL_IMAP_USER: process.env.WEBMAIL_IMAP_USER,
  WEBMAIL_IMAP_PASSWORD: process.env.WEBMAIL_IMAP_PASSWORD,
  WEBMAIL_IMAP_MAILBOX: process.env.WEBMAIL_IMAP_MAILBOX,
  WEBMAIL_IMAP_SENT_MAILBOX: process.env.WEBMAIL_IMAP_SENT_MAILBOX,
  WEBMAIL_IMAP_APPEND_SENT_ENABLED: process.env.WEBMAIL_IMAP_APPEND_SENT_ENABLED
});

export function adminEmailSet(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}
