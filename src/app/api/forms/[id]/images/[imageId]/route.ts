import { readFile, stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { absolutePathFor, assertFormIdSafe, FormUploadError } from '@/lib/form-uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  try {
    assertFormIdSafe(params.id);
  } catch (err) {
    if (err instanceof FormUploadError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    throw err;
  }

  // Admin session is required to view images. The public form flow no longer
  // exposes images back to the customer; the confirmation page is text-only.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const image = await db.formImage.findUnique({
    where: { id: params.imageId }
  });

  if (!image || image.formId !== params.id) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const absolutePath = absolutePathFor(image.storagePath);

  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile()) throw new Error('not_a_file');
  } catch {
    return NextResponse.json({ ok: false, error: 'file_missing' }, { status: 404 });
  }

  const data = await readFile(absolutePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
