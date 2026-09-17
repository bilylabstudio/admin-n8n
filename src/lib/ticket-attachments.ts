import { mkdir, rm, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

export const TICKET_ATTACHMENT_MAX_BYTES = Number(
  process.env.TICKET_ATTACHMENT_MAX_BYTES ?? 10_485_760
);
export const TICKET_ATTACHMENT_MAX_FILES = Number(process.env.TICKET_ATTACHMENT_MAX_FILES ?? 5);
export const TICKET_ATTACHMENT_TOTAL_MAX_BYTES = Number(
  process.env.TICKET_ATTACHMENT_TOTAL_MAX_BYTES ?? 26_214_400
);

// Sniffed via file-type against the real bytes, never trusting the
// client-supplied extension or Content-Type header.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip'
]);

// Owner ids are Ticket or ThreadMessage cuids.
const CUID_RE = /^c[a-z0-9]{20,}$/;

export type ValidatedAttachment = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  sizeBytes: number;
};

export class TicketAttachmentError extends Error {
  constructor(public code: TicketAttachmentErrorCode) {
    super(code);
    this.name = 'TicketAttachmentError';
  }
}

export type TicketAttachmentErrorCode =
  | 'file_too_large'
  | 'unsupported_mime'
  | 'too_many_files'
  | 'total_size_exceeded'
  | 'invalid_owner_id'
  | 'empty_file';

export async function validateAttachmentUpload(buffer: Buffer): Promise<ValidatedAttachment> {
  if (!buffer.length) {
    throw new TicketAttachmentError('empty_file');
  }
  if (buffer.length > TICKET_ATTACHMENT_MAX_BYTES) {
    throw new TicketAttachmentError('file_too_large');
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new TicketAttachmentError('unsupported_mime');
  }
  return {
    buffer,
    mimeType: detected.mime,
    ext: detected.ext,
    sizeBytes: buffer.length
  };
}

export function assertOwnerIdSafe(ownerId: string): void {
  if (typeof ownerId !== 'string' || !CUID_RE.test(ownerId)) {
    throw new TicketAttachmentError('invalid_owner_id');
  }
}

export function assertBatchWithinLimits(files: ValidatedAttachment[]): void {
  if (files.length > TICKET_ATTACHMENT_MAX_FILES) {
    throw new TicketAttachmentError('too_many_files');
  }
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (totalBytes > TICKET_ATTACHMENT_TOTAL_MAX_BYTES) {
    throw new TicketAttachmentError('total_size_exceeded');
  }
}

export function ticketAttachmentsRoot(): string {
  return process.env.TICKET_ATTACHMENTS_ROOT ?? '/data/ticket-attachments';
}

export function storageRelativePathFor(ownerId: string, fileUuid: string, ext: string): string {
  assertOwnerIdSafe(ownerId);
  return `${ownerId}/${fileUuid}.${ext}`;
}

export function absolutePathFor(relative: string): string {
  return join(ticketAttachmentsRoot(), relative);
}

export type WrittenAttachment = {
  relativePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Writes one validated attachment to disk under the given owner id
 * (a Ticket id or a ThreadMessage id). The caller is responsible for
 * checking batch-level limits (assertBatchWithinLimits) before calling
 * this repeatedly for a single message.
 */
export async function writeTicketAttachment(
  ownerId: string,
  originalFilename: string,
  file: ValidatedAttachment
): Promise<WrittenAttachment> {
  assertOwnerIdSafe(ownerId);
  const ownerDir = join(ticketAttachmentsRoot(), ownerId);
  await mkdir(ownerDir, { recursive: true });

  const fileUuid = randomUUID();
  const diskFilename = `${fileUuid}.${file.ext}`;
  await writeFile(join(ownerDir, diskFilename), file.buffer);

  return {
    relativePath: storageRelativePathFor(ownerId, fileUuid, file.ext),
    filename: sanitizeDisplayFilename(originalFilename) || diskFilename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes
  };
}

export async function deleteTicketAttachmentFile(relativePath: string): Promise<void> {
  await unlink(absolutePathFor(relativePath)).catch(() => undefined);
}

export async function deleteTicketAttachmentsForOwner(ownerId: string): Promise<void> {
  assertOwnerIdSafe(ownerId);
  const ownerDir = join(ticketAttachmentsRoot(), ownerId);
  await rm(ownerDir, { recursive: true, force: true });
}

// Keep only a safe display name: strip any path components and control
// characters a client might send in the multipart filename field.
function sanitizeDisplayFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || '';
  return base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export const TICKET_ATTACHMENT_LIMITS = {
  MAX_BYTES: TICKET_ATTACHMENT_MAX_BYTES,
  MAX_FILES: TICKET_ATTACHMENT_MAX_FILES,
  TOTAL_MAX_BYTES: TICKET_ATTACHMENT_TOTAL_MAX_BYTES,
  ALLOWED_MIME: Array.from(ALLOWED_MIME)
};
