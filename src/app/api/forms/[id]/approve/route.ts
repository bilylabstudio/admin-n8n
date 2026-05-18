import type { NextRequest } from 'next/server';
import { handleFormAction } from '@/lib/form-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handleFormAction(req, params.id, 'approve');
}
