import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildBotDataExportArchive,
  buildExportManifest,
  createCsv,
  serializeExportValue,
  ticketToExportRow,
  toSqliteCell,
  type ExportTable
} from './bot-data-export';

describe('bot data export helpers', () => {
  it('serializes dates, booleans, nulls, and JSON consistently', () => {
    expect(serializeExportValue(new Date('2026-07-01T10:20:30.000Z'))).toBe(
      '2026-07-01T10:20:30.000Z'
    );
    expect(serializeExportValue(true)).toBe('true');
    expect(serializeExportValue(false)).toBe('false');
    expect(serializeExportValue(null)).toBe('');
    expect(serializeExportValue({ risk: ['human_review'] })).toBe('{"risk":["human_review"]}');
    expect(toSqliteCell(null)).toBeNull();
    expect(toSqliteCell(false)).toBe('false');
  });

  it('escapes CSV values with quotes, commas, and new lines', () => {
    const csv = createCsv({
      name: 'tickets',
      columns: ['id', 'text', 'empty'],
      rows: [
        {
          id: 'ticket-1',
          text: 'Hola, "Maria"\nLinea 2',
          empty: null
        }
      ]
    });

    expect(csv).toBe('id,text,empty\r\nticket-1,"Hola, ""Maria""\nLinea 2",\r\n');
  });

  it('adds visible admin tags to ticket export rows', () => {
    const row = ticketToExportRow({
      id: 'ticket-1',
      externalMessageId: 'message-1',
      customerEmail: 'cliente@example.com',
      customerName: 'Cliente',
      subject: 'Pedido perdido',
      receivedAt: new Date('2026-07-01T10:00:00.000Z'),
      source: 'webmail',
      originalText: 'TIPSA marco el paquete como ausente pero estaba en casa',
      aiReply: 'Respuesta IA',
      finalReply: null,
      category: 'Logistica de Web',
      intent: 'order_status',
      riskFlags: 'human_review',
      escalationRecommended: true,
      aiConfidence: 0.9,
      confidenceLabel: 'alta',
      routedTemplateId: null,
      routeSource: null,
      sentiment: 'molesto',
      sentimentSource: 'classifier',
      requiresReview: true,
      caseReasoningJson: null,
      criticJson: null,
      status: 'pending_review',
      approvedByUserId: null,
      approvedBy: null,
      sentAt: null,
      providerMessageId: null,
      imapUid: null,
      imapMailbox: null,
      messageId: null,
      inReplyTo: null,
      references: null,
      seenSyncedAt: null,
      answeredSyncedAt: null,
      sentFolderSyncedAt: null,
      webmailSyncError: null,
      sentMessageJson: null,
      sendError: null,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-01T10:05:00.000Z')
    });

    expect(row.tag_ids).toContain('escalate');
    expect(row.tag_ids).toContain('carrier_incident');
    expect(row.tag_labels).toContain('Escalar');
    expect(row.tag_labels).toContain('Incidencia transporte');
  });

  it('builds a manifest with counts for every exported table', () => {
    const manifest = buildExportManifest(
      [
        { name: 'tickets', columns: ['id'], rows: [{ id: 'ticket-1' }] },
        { name: 'thread_messages', columns: ['id'], rows: [] }
      ],
      new Date('2026-07-08T12:00:00.000Z')
    );

    expect(manifest).toEqual({
      exportedAt: '2026-07-08T12:00:00.000Z',
      version: 1,
      scope: 'bot_support',
      formats: ['sqlite', 'csv'],
      sqliteFile: 'bot-data.sqlite',
      tables: [
        { name: 'tickets', rowCount: 1, csvFile: 'csv/tickets.csv' },
        { name: 'thread_messages', rowCount: 0, csvFile: 'csv/thread_messages.csv' }
      ]
    });
  });

  it('creates a ZIP containing SQLite, CSV files, and manifest', async () => {
    const tables: ExportTable[] = [
      {
        name: 'tickets',
        columns: ['id', 'subject'],
        rows: [{ id: 'ticket-1', subject: 'Consulta' }]
      }
    ];

    const archive = await buildBotDataExportArchive({
      tables,
      exportedAt: new Date('2026-07-08T12:00:00.000Z')
    });
    const zip = await JSZip.loadAsync(archive.bytes);

    expect(archive.filename).toBe('vgummies-bot-data-2026-07-08.zip');
    expect(zip.file('bot-data.sqlite')).toBeTruthy();
    expect(zip.file('csv/tickets.csv')).toBeTruthy();
    expect(zip.file('manifest.json')).toBeTruthy();
    expect(await zip.file('csv/tickets.csv')?.async('string')).toBe(
      'id,subject\r\nticket-1,Consulta\r\n'
    );
    expect(JSON.parse((await zip.file('manifest.json')?.async('string')) || '{}')).toMatchObject({
      scope: 'bot_support',
      tables: [{ name: 'tickets', rowCount: 1 }]
    });
    expect((await zip.file('bot-data.sqlite')?.async('uint8array'))?.byteLength).toBeGreaterThan(
      100
    );
  });
});
