import { join } from 'node:path';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { db } from './db';
import { getTicketTags } from './ticket-tags';

export type ExportCell =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export type ExportRow = Record<string, ExportCell>;

export type ExportTable = {
  name: string;
  columns: string[];
  rows: ExportRow[];
};

export type BotDataExportManifest = {
  exportedAt: string;
  version: 1;
  scope: 'bot_support';
  formats: ['sqlite', 'csv'];
  sqliteFile: 'bot-data.sqlite';
  tables: Array<{
    name: string;
    rowCount: number;
    csvFile: string;
  }>;
};

export type BotDataExportArchive = {
  filename: string;
  bytes: Uint8Array;
  manifest: BotDataExportManifest;
};

type TicketExportSource = {
  id: string;
  externalMessageId: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  receivedAt: Date;
  source: string;
  originalText: string;
  aiReply: string;
  finalReply: string | null;
  category: string | null;
  intent: string | null;
  riskFlags: string | null;
  escalationRecommended: boolean;
  aiConfidence: number | null;
  confidenceLabel: string | null;
  routedTemplateId: string | null;
  routeSource: string | null;
  sentiment: string | null;
  sentimentSource: string | null;
  requiresReview: boolean;
  caseReasoningJson: ExportCell;
  criticJson: ExportCell;
  status: string;
  approvedByUserId: string | null;
  approvedBy?: { email: string } | null;
  sentAt: Date | null;
  providerMessageId: string | null;
  imapUid: string | null;
  imapMailbox: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  seenSyncedAt: Date | null;
  answeredSyncedAt: Date | null;
  sentFolderSyncedAt: Date | null;
  webmailSyncError: string | null;
  sentMessageJson: ExportCell;
  sendError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const TICKET_COLUMNS = [
  'id',
  'external_message_id',
  'customer_email',
  'customer_name',
  'subject',
  'received_at',
  'source',
  'original_text',
  'ai_reply',
  'final_reply',
  'category',
  'intent',
  'risk_flags',
  'tag_ids',
  'tag_labels',
  'escalation_recommended',
  'ai_confidence',
  'confidence_label',
  'routed_template_id',
  'route_source',
  'sentiment',
  'sentiment_source',
  'requires_review',
  'case_reasoning_json',
  'critic_json',
  'status',
  'approved_by_user_id',
  'approved_by_email',
  'sent_at',
  'provider_message_id',
  'imap_uid',
  'imap_mailbox',
  'message_id',
  'in_reply_to',
  'references',
  'seen_synced_at',
  'answered_synced_at',
  'sent_folder_synced_at',
  'webmail_sync_error',
  'sent_message_json',
  'send_error',
  'created_at',
  'updated_at'
] as const;

const THREAD_MESSAGE_COLUMNS = [
  'id',
  'customer_email',
  'customer_name',
  'ticket_id',
  'direction',
  'source',
  'subject',
  'text',
  'message_at',
  'message_id',
  'imap_uid',
  'imap_mailbox',
  'provider_message_id',
  'raw_json',
  'created_at',
  'updated_at'
] as const;

const AUDIT_EVENT_COLUMNS = [
  'id',
  'ticket_id',
  'form_id',
  'event_type',
  'before_status',
  'after_status',
  'metadata_json',
  'user_email',
  'created_at'
] as const;

const FORM_SUBMISSION_COLUMNS = [
  'id',
  'token',
  'type',
  'ticket_id',
  'customer_email',
  'order_number',
  'purchase_email',
  'reason',
  'submitted_at',
  'ip_address',
  'user_agent',
  'status',
  'review_notes',
  'final_reply',
  'approved_by_email',
  'sent_at',
  'send_error',
  'expires_at',
  'created_at',
  'updated_at'
] as const;

const FORM_IMAGE_COLUMNS = [
  'id',
  'form_id',
  'filename',
  'storage_path',
  'mime_type',
  'size_bytes',
  'created_at'
] as const;

const BLOCKED_EMAIL_COLUMNS = ['id', 'email', 'reason', 'created_at'] as const;

const SUPPORT_APPROVED_RESPONSE_COLUMNS = [
  'id',
  'case_id',
  'family',
  'subintent',
  'customer_example',
  'approved_response',
  'must_include',
  'must_not_include',
  'status',
  'priority',
  'created_at',
  'updated_at'
] as const;

export function serializeExportValue(value: ExportCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function toSqliteCell(value: ExportCell): string | null {
  if (value === null || value === undefined) return null;
  return serializeExportValue(value);
}

export function createCsv(table: ExportTable): string {
  const lines = [
    table.columns.map(csvEscape).join(','),
    ...table.rows.map((row) =>
      table.columns.map((column) => csvEscape(serializeExportValue(row[column]))).join(',')
    )
  ];

  return `${lines.join('\r\n')}\r\n`;
}

export function buildExportManifest(
  tables: ExportTable[],
  exportedAt: Date = new Date()
): BotDataExportManifest {
  return {
    exportedAt: exportedAt.toISOString(),
    version: 1,
    scope: 'bot_support',
    formats: ['sqlite', 'csv'],
    sqliteFile: 'bot-data.sqlite',
    tables: tables.map((table) => ({
      name: table.name,
      rowCount: table.rows.length,
      csvFile: `csv/${table.name}.csv`
    }))
  };
}

export async function buildBotDataExportArchive(options: {
  exportedAt?: Date;
  tables?: ExportTable[];
} = {}): Promise<BotDataExportArchive> {
  const exportedAt = options.exportedAt ?? new Date();
  const tables = options.tables ?? await collectBotDataExportTables();
  const manifest = buildExportManifest(tables, exportedAt);
  const sqlite = await createSqliteDatabase(tables);
  const zip = new JSZip();

  zip.file('bot-data.sqlite', sqlite);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  for (const table of tables) {
    zip.file(`csv/${table.name}.csv`, createCsv(table));
  }

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return {
    filename: `vgummies-bot-data-${exportedAt.toISOString().slice(0, 10)}.zip`,
    bytes,
    manifest
  };
}

export async function collectBotDataExportTables(): Promise<ExportTable[]> {
  const [
    tickets,
    threadMessages,
    auditEvents,
    formSubmissions,
    formImages,
    blockedEmails,
    supportApprovedResponses
  ] = await Promise.all([
    db.ticket.findMany({
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      include: { approvedBy: { select: { email: true } } }
    }),
    db.threadMessage.findMany({
      orderBy: [{ messageAt: 'asc' }, { createdAt: 'asc' }]
    }),
    db.auditEvent.findMany({
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } }
    }),
    db.formSubmission.findMany({
      orderBy: [{ createdAt: 'asc' }],
      include: { approvedBy: { select: { email: true } } }
    }),
    db.formImage.findMany({
      orderBy: { createdAt: 'asc' }
    }),
    db.blockedEmail.findMany({
      orderBy: { createdAt: 'asc' }
    }),
    db.supportApprovedResponse.findMany({
      orderBy: [{ family: 'asc' }, { subintent: 'asc' }, { priority: 'desc' }]
    })
  ]);

  return [
    {
      name: 'tickets',
      columns: [...TICKET_COLUMNS],
      rows: tickets.map(ticketToExportRow)
    },
    {
      name: 'thread_messages',
      columns: [...THREAD_MESSAGE_COLUMNS],
      rows: threadMessages.map((message) => ({
        id: message.id,
        customer_email: message.customerEmail,
        customer_name: message.customerName,
        ticket_id: message.ticketId,
        direction: message.direction,
        source: message.source,
        subject: message.subject,
        text: message.text,
        message_at: message.messageAt,
        message_id: message.messageId,
        imap_uid: message.imapUid,
        imap_mailbox: message.imapMailbox,
        provider_message_id: message.providerMessageId,
        raw_json: message.rawJson,
        created_at: message.createdAt,
        updated_at: message.updatedAt
      }))
    },
    {
      name: 'audit_events',
      columns: [...AUDIT_EVENT_COLUMNS],
      rows: auditEvents.map((event) => ({
        id: event.id,
        ticket_id: event.ticketId,
        form_id: event.formId,
        event_type: event.eventType,
        before_status: event.beforeStatus,
        after_status: event.afterStatus,
        metadata_json: event.metadataJson,
        user_email: event.user?.email ?? null,
        created_at: event.createdAt
      }))
    },
    {
      name: 'form_submissions',
      columns: [...FORM_SUBMISSION_COLUMNS],
      rows: formSubmissions.map((form) => ({
        id: form.id,
        token: form.token,
        type: form.type,
        ticket_id: form.ticketId,
        customer_email: form.customerEmail,
        order_number: form.orderNumber,
        purchase_email: form.purchaseEmail,
        reason: form.reason,
        submitted_at: form.submittedAt,
        ip_address: form.ipAddress,
        user_agent: form.userAgent,
        status: form.status,
        review_notes: form.reviewNotes,
        final_reply: form.finalReply,
        approved_by_email: form.approvedBy?.email ?? null,
        sent_at: form.sentAt,
        send_error: form.sendError,
        expires_at: form.expiresAt,
        created_at: form.createdAt,
        updated_at: form.updatedAt
      }))
    },
    {
      name: 'form_images',
      columns: [...FORM_IMAGE_COLUMNS],
      rows: formImages.map((image) => ({
        id: image.id,
        form_id: image.formId,
        filename: image.filename,
        storage_path: image.storagePath,
        mime_type: image.mimeType,
        size_bytes: image.sizeBytes,
        created_at: image.createdAt
      }))
    },
    {
      name: 'blocked_emails',
      columns: [...BLOCKED_EMAIL_COLUMNS],
      rows: blockedEmails.map((blocked) => ({
        id: blocked.id,
        email: blocked.email,
        reason: blocked.reason,
        created_at: blocked.createdAt
      }))
    },
    {
      name: 'support_approved_responses',
      columns: [...SUPPORT_APPROVED_RESPONSE_COLUMNS],
      rows: supportApprovedResponses.map((response) => ({
        id: response.id,
        case_id: response.caseId,
        family: response.family,
        subintent: response.subintent,
        customer_example: response.customerExample,
        approved_response: response.approvedResponse,
        must_include: response.mustInclude,
        must_not_include: response.mustNotInclude,
        status: response.status,
        priority: response.priority,
        created_at: response.createdAt,
        updated_at: response.updatedAt
      }))
    }
  ];
}

export function ticketToExportRow(ticket: TicketExportSource): ExportRow {
  const tags = getTicketTags(ticket);

  return {
    id: ticket.id,
    external_message_id: ticket.externalMessageId,
    customer_email: ticket.customerEmail,
    customer_name: ticket.customerName,
    subject: ticket.subject,
    received_at: ticket.receivedAt,
    source: ticket.source,
    original_text: ticket.originalText,
    ai_reply: ticket.aiReply,
    final_reply: ticket.finalReply,
    category: ticket.category,
    intent: ticket.intent,
    risk_flags: ticket.riskFlags,
    tag_ids: tags.map((tag) => tag.id).join(','),
    tag_labels: tags.map((tag) => tag.label).join(','),
    escalation_recommended: ticket.escalationRecommended,
    ai_confidence: ticket.aiConfidence,
    confidence_label: ticket.confidenceLabel,
    routed_template_id: ticket.routedTemplateId,
    route_source: ticket.routeSource,
    sentiment: ticket.sentiment,
    sentiment_source: ticket.sentimentSource,
    requires_review: ticket.requiresReview,
    case_reasoning_json: ticket.caseReasoningJson,
    critic_json: ticket.criticJson,
    status: ticket.status,
    approved_by_user_id: ticket.approvedByUserId,
    approved_by_email: ticket.approvedBy?.email ?? null,
    sent_at: ticket.sentAt,
    provider_message_id: ticket.providerMessageId,
    imap_uid: ticket.imapUid,
    imap_mailbox: ticket.imapMailbox,
    message_id: ticket.messageId,
    in_reply_to: ticket.inReplyTo,
    references: ticket.references,
    seen_synced_at: ticket.seenSyncedAt,
    answered_synced_at: ticket.answeredSyncedAt,
    sent_folder_synced_at: ticket.sentFolderSyncedAt,
    webmail_sync_error: ticket.webmailSyncError,
    sent_message_json: ticket.sentMessageJson,
    send_error: ticket.sendError,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt
  };
}

async function createSqliteDatabase(tables: ExportTable[]): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  });
  const sqlite = new SQL.Database();

  try {
    sqlite.run('BEGIN TRANSACTION');
    for (const table of tables) {
      sqlite.run(createTableSql(table));

      if (!table.rows.length) continue;

      const insertSql = [
        `INSERT INTO ${quoteSqlIdentifier(table.name)} (`,
        table.columns.map(quoteSqlIdentifier).join(', '),
        ') VALUES (',
        table.columns.map(() => '?').join(', '),
        ')'
      ].join('');
      const stmt = sqlite.prepare(insertSql);

      try {
        for (const row of table.rows) {
          stmt.run(table.columns.map((column) => toSqliteCell(row[column])));
        }
      } finally {
        stmt.free();
      }
    }
    sqlite.run('COMMIT');
    return sqlite.export();
  } catch (error) {
    sqlite.run('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
  }
}

function createTableSql(table: ExportTable): string {
  const columns = table.columns
    .map((column) => `${quoteSqlIdentifier(column)} TEXT`)
    .join(', ');
  return `CREATE TABLE ${quoteSqlIdentifier(table.name)} (${columns})`;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
