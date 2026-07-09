import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import {
  buildBotDataExportArchive,
  diagnoseBotDataExport,
  getBotDataExportErrorDetails
} from '@/lib/bot-data-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BOT_DATA_EXPORT_ROUTE_VERSION = '2026-07-09-diagnose-v2';

export async function GET(request: Request) {
  let mode: 'auth' | 'diagnose' | 'export' = 'auth';

  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'No autorizado', exportVersion: BOT_DATA_EXPORT_ROUTE_VERSION },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const url = new URL(request.url);
    if (url.searchParams.get('diagnose') === '1') {
      mode = 'diagnose';
      const diagnostics = await diagnoseBotDataExport();

      return NextResponse.json({
        exportVersion: BOT_DATA_EXPORT_ROUTE_VERSION,
        ...diagnostics
      }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    mode = 'export';
    const archive = await buildBotDataExportArchive();
    const bodyBuffer = new ArrayBuffer(archive.bytes.byteLength);
    new Uint8Array(bodyBuffer).set(archive.bytes);
    const body = new Blob([bodyBuffer], { type: 'application/zip' });

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archive.filename}"`,
        'Cache-Control': 'no-store',
        'X-Bot-Data-Export-Version': BOT_DATA_EXPORT_ROUTE_VERSION
      }
    });
  } catch (error) {
    const details = getBotDataExportErrorDetails(error);
    const phase = details.phase ?? mode;
    console.error('Bot data export failed', error);

    return NextResponse.json(
      {
        ok: false,
        error: 'No se pudo exportar la base historica del bot.',
        exportVersion: BOT_DATA_EXPORT_ROUTE_VERSION,
        phase,
        ...details
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
