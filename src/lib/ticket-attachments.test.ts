import { describe, it, expect } from 'vitest';
import {
  assertOwnerIdSafe,
  assertBatchWithinLimits,
  humanFileSize,
  storageRelativePathFor,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_TOTAL_MAX_BYTES,
  TicketAttachmentError,
  validateAttachmentUpload,
  type ValidatedAttachment
} from './ticket-attachments';

// 67-byte minimal valid PNG (1x1 transparent pixel)
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Minimal valid PDF header + trailer, enough for file-type to detect application/pdf.
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
  'utf8'
);

describe('validateAttachmentUpload', () => {
  it('rejects empty buffers', async () => {
    await expect(validateAttachmentUpload(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'empty_file'
    });
  });

  it('rejects oversize buffers', async () => {
    const big = Buffer.alloc(TICKET_ATTACHMENT_MAX_BYTES + 1);
    await expect(validateAttachmentUpload(big)).rejects.toBeInstanceOf(TicketAttachmentError);
    await expect(validateAttachmentUpload(big)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('rejects mime types outside the allow-list (e.g. executables, plain text)', async () => {
    const txt = Buffer.from('hello world this is plain text, not a real attachment');
    await expect(validateAttachmentUpload(txt)).rejects.toMatchObject({
      code: 'unsupported_mime'
    });
  });

  it('accepts a valid PNG', async () => {
    const png = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    const result = await validateAttachmentUpload(png);
    expect(result.mimeType).toBe('image/png');
    expect(result.ext).toBe('png');
    expect(result.sizeBytes).toBe(png.length);
  });

  it('accepts a valid PDF', async () => {
    const result = await validateAttachmentUpload(MINIMAL_PDF);
    expect(result.mimeType).toBe('application/pdf');
  });
});

describe('assertOwnerIdSafe', () => {
  it('accepts a 25-char cuid', () => {
    expect(() => assertOwnerIdSafe('cl1234567890abcdefghijklm')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertOwnerIdSafe('../../etc/passwd')).toThrow(TicketAttachmentError);
    expect(() => assertOwnerIdSafe('..')).toThrow(TicketAttachmentError);
    expect(() => assertOwnerIdSafe('foo/bar')).toThrow(TicketAttachmentError);
    expect(() => assertOwnerIdSafe('')).toThrow(TicketAttachmentError);
  });

  it('rejects non-cuid strings', () => {
    expect(() => assertOwnerIdSafe('abc')).toThrow(TicketAttachmentError);
    expect(() => assertOwnerIdSafe('UPPERCASE')).toThrow(TicketAttachmentError);
  });
});

describe('storageRelativePathFor', () => {
  it('produces ownerId/uuid.ext layout', () => {
    const path = storageRelativePathFor('cl1234567890abcdefghijklm', 'abc-123', 'pdf');
    expect(path).toBe('cl1234567890abcdefghijklm/abc-123.pdf');
  });

  it('rejects unsafe owner ids', () => {
    expect(() => storageRelativePathFor('../foo', 'uuid', 'pdf')).toThrow(TicketAttachmentError);
  });
});

function fakeAttachment(sizeBytes: number): ValidatedAttachment {
  return { buffer: Buffer.alloc(sizeBytes), mimeType: 'application/pdf', ext: 'pdf', sizeBytes };
}

describe('assertBatchWithinLimits', () => {
  it('accepts a batch within both the count and total-size limits', () => {
    const files = [fakeAttachment(1024), fakeAttachment(2048)];
    expect(() => assertBatchWithinLimits(files)).not.toThrow();
  });

  it('rejects more than TICKET_ATTACHMENT_MAX_FILES files', () => {
    const files = Array.from({ length: TICKET_ATTACHMENT_MAX_FILES + 1 }, () => fakeAttachment(1));
    expect(() => assertBatchWithinLimits(files)).toThrow(TicketAttachmentError);
    try {
      assertBatchWithinLimits(files);
    } catch (err) {
      expect((err as TicketAttachmentError).code).toBe('too_many_files');
    }
  });

  it('rejects a batch whose combined size exceeds TICKET_ATTACHMENT_TOTAL_MAX_BYTES', () => {
    const files = [fakeAttachment(TICKET_ATTACHMENT_TOTAL_MAX_BYTES), fakeAttachment(1)];
    expect(() => assertBatchWithinLimits(files)).toThrow(TicketAttachmentError);
    try {
      assertBatchWithinLimits(files);
    } catch (err) {
      expect((err as TicketAttachmentError).code).toBe('total_size_exceeded');
    }
  });

  it('allows a single file right at the total-size cap', () => {
    const files = [fakeAttachment(TICKET_ATTACHMENT_TOTAL_MAX_BYTES)];
    expect(() => assertBatchWithinLimits(files)).not.toThrow();
  });
});

describe('humanFileSize', () => {
  it('formats bytes, KB, MB', () => {
    expect(humanFileSize(500)).toBe('500 B');
    expect(humanFileSize(2048)).toBe('2.0 KB');
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
