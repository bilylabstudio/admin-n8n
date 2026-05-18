import { describe, it, expect } from 'vitest';
import {
  assertFormIdSafe,
  FORM_UPLOAD_MAX_BYTES,
  FormUploadError,
  storageRelativePathFor,
  validateUpload
} from './form-uploads';

// 67-byte minimal valid PNG (1x1 transparent pixel)
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('validateUpload', () => {
  it('rejects oversize buffers', async () => {
    const big = Buffer.alloc(FORM_UPLOAD_MAX_BYTES + 1);
    await expect(validateUpload(big)).rejects.toBeInstanceOf(FormUploadError);
    await expect(validateUpload(big)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('rejects unknown mime types', async () => {
    const txt = Buffer.from('hello world this is plain text');
    await expect(validateUpload(txt)).rejects.toBeInstanceOf(FormUploadError);
    await expect(validateUpload(txt)).rejects.toMatchObject({ code: 'unsupported_mime' });
  });

  it('accepts a valid PNG', async () => {
    const png = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
    const result = await validateUpload(png);
    expect(result.mimeType).toBe('image/png');
    expect(result.ext).toBe('png');
    expect(result.sizeBytes).toBe(png.length);
  });
});

describe('assertFormIdSafe', () => {
  it('accepts a 25-char cuid', () => {
    expect(() => assertFormIdSafe('cl1234567890abcdefghijklm')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertFormIdSafe('../../etc/passwd')).toThrow(FormUploadError);
    expect(() => assertFormIdSafe('..')).toThrow(FormUploadError);
    expect(() => assertFormIdSafe('foo/bar')).toThrow(FormUploadError);
    expect(() => assertFormIdSafe('')).toThrow(FormUploadError);
  });

  it('rejects non-cuid strings', () => {
    expect(() => assertFormIdSafe('abc')).toThrow(FormUploadError);
    expect(() => assertFormIdSafe('UPPERCASE')).toThrow(FormUploadError);
    expect(() => assertFormIdSafe('123456789012345678901234')).toThrow(FormUploadError);
  });
});

describe('storageRelativePathFor', () => {
  it('produces formId/uuid.ext layout', () => {
    const path = storageRelativePathFor('cl1234567890abcdefghijklm', 'abc-123', 'jpg');
    expect(path).toBe('cl1234567890abcdefghijklm/abc-123.jpg');
  });

  it('rejects unsafe formIds', () => {
    expect(() => storageRelativePathFor('../foo', 'uuid', 'jpg')).toThrow(FormUploadError);
  });
});
