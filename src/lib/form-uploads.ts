import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

export const FORM_UPLOAD_MAX_BYTES = Number(process.env.FORM_UPLOAD_MAX_BYTES ?? 5_242_880);
export const FORM_UPLOAD_MAX_FILES = Number(process.env.FORM_UPLOAD_MAX_FILES ?? 3);
export const FORM_UPLOAD_TOTAL_MAX_BYTES = FORM_UPLOAD_MAX_BYTES * FORM_UPLOAD_MAX_FILES;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

const CUID_RE = /^c[a-z0-9]{20,}$/;

export type ValidatedUpload = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  sizeBytes: number;
};

export class FormUploadError extends Error {
  constructor(public code: FormUploadErrorCode) {
    super(code);
    this.name = 'FormUploadError';
  }
}

export type FormUploadErrorCode =
  | 'file_too_large'
  | 'unsupported_mime'
  | 'too_many_files'
  | 'total_size_exceeded'
  | 'invalid_form_id';

export async function validateUpload(buffer: Buffer): Promise<ValidatedUpload> {
  if (buffer.length > FORM_UPLOAD_MAX_BYTES) {
    throw new FormUploadError('file_too_large');
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new FormUploadError('unsupported_mime');
  }
  return {
    buffer,
    mimeType: detected.mime,
    ext: detected.ext,
    sizeBytes: buffer.length
  };
}

export function assertFormIdSafe(formId: string): void {
  if (typeof formId !== 'string' || !CUID_RE.test(formId)) {
    throw new FormUploadError('invalid_form_id');
  }
}

export function uploadsRoot(): string {
  return process.env.FORM_UPLOADS_ROOT ?? '/data/form-uploads';
}

export function storageRelativePathFor(formId: string, fileUuid: string, ext: string): string {
  assertFormIdSafe(formId);
  return `${formId}/${fileUuid}.${ext}`;
}

export function absolutePathFor(relative: string): string {
  return join(uploadsRoot(), relative);
}

export type WrittenImage = {
  relativePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export async function writeFormUploads(
  formId: string,
  files: ValidatedUpload[]
): Promise<WrittenImage[]> {
  assertFormIdSafe(formId);
  if (files.length > FORM_UPLOAD_MAX_FILES) {
    throw new FormUploadError('too_many_files');
  }
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (totalBytes > FORM_UPLOAD_TOTAL_MAX_BYTES) {
    throw new FormUploadError('total_size_exceeded');
  }

  const formDir = join(uploadsRoot(), formId);
  await mkdir(formDir, { recursive: true });

  const written: WrittenImage[] = [];
  try {
    for (const file of files) {
      const fileUuid = randomUUID();
      const filename = `${fileUuid}.${file.ext}`;
      await writeFile(join(formDir, filename), file.buffer);
      written.push({
        relativePath: storageRelativePathFor(formId, fileUuid, file.ext),
        filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes
      });
    }
    return written;
  } catch (err) {
    await rm(formDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function deleteFormUploads(formId: string): Promise<void> {
  assertFormIdSafe(formId);
  const formDir = join(uploadsRoot(), formId);
  await rm(formDir, { recursive: true, force: true });
}

export const FORM_UPLOAD_LIMITS = {
  MAX_BYTES: FORM_UPLOAD_MAX_BYTES,
  MAX_FILES: FORM_UPLOAD_MAX_FILES,
  TOTAL_MAX_BYTES: FORM_UPLOAD_TOTAL_MAX_BYTES,
  ALLOWED_MIME: Array.from(ALLOWED_MIME)
};
