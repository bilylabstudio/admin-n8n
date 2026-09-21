import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { mergeDuplicateOpenTickets } from '@/lib/tickets';

export const dynamic = 'force-dynamic';

// One-time (but safe to re-run) admin action: unifies every customer's
// duplicate open tickets ("Por revisar", "Sin respuesta IA", etc.) into a
// single active ticket per customer, exactly like new incoming emails are
// now handled going forward. Idempotent — running it again with nothing
// left to merge is a no-op. Requires an authenticated admin session, same
// as the rest of the /api/tickets endpoints.
async function run() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const result = await mergeDuplicateOpenTickets();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST() {
  return run();
}

export async function GET() {
  return run();
}
