import { NextRequest, NextResponse } from "next/server";
import { handleTossWebhook, InvalidSignatureError } from "@/entities/payment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // rawBody 보존 — JSON.parse 전에 HMAC 서명 검증에 필요 (domain-booking R9)
  const rawBody = await req.text();
  const signature = req.headers.get("toss-signature");

  try {
    await handleTossWebhook({ rawBody, signature });
    // 200 빠른 응답 — Toss 재시도 폭주 방지. 멱등성은 handleTossWebhook 내부에서 보장.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
    }
    // 그 외 에러(DB/PG) → 500, Toss가 재시도하면 멱등성으로 흡수
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
