import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const body = await req.json() as { role: string };
  return NextResponse.json({ ok: true, userId: params.id, newRole: body.role });
}
