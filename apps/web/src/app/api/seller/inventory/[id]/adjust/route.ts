import { NextRequest, NextResponse } from 'next/server';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  // In real impl: call inventory-service PATCH /inventory/product/:productId/adjust
  return NextResponse.json({ productId: params.id, adjustment: body.quantity, reason: body.reason, success: true });
}
