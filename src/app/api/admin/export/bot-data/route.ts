import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import {
  buildBotDataExportArchive,
  diagnoseBotDataExport,
  getBotDataExportErrorDetails
} from '@/lib/bot-data-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    if (url.searchParams.get('diagnose') === '1') {
      return NextResponse.json(await diagnoseBotDataExport(), {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const archive = await buildBotDataExportArchive();
    const bodyBuffer = new ArrayBuffer(archive.bytes.byteLength);
    new Uint8Array(bodyBuffer).set(archive.bytes);
    const body = new Blob([bodyBuffer], { type: 'application/zip' });

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archive.filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    const details = getBotDataExportErrorDetails(error);
    console.error('Bot data export failed', error);

    return NextResponse.json(
      {
        ok: false,
        error: 'No se pudo exportar la base historica del bot.',
        ...details
      },
      { status: 500 }
    );
  }
}
