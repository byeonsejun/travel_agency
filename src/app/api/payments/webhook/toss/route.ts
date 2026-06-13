import { NextRequest, NextResponse } from 'next/server';
import { handleTossWebhook, InvalidSignatureError } from '@/entities/payment';
import { logger, withObservedRoute } from '@/shared/lib/observability';


export const POST = withObservedRoute('payments.webhook.toss', async (req: NextRequest): Promise<NextResponse> => {
  // rawBody 보존 — JSON.parse 전에 서명 검증에 필요 (domain-booking R9)
  const rawBody = await req.text();
  const signature = req.headers.get('toss-signature');
  // v2 멱등 키 — 토스가 모든 webhook 에 동봉. 같은 transmission 재전송 시 동일 id.
  // (HTTP 헤더 이름은 case-insensitive — Next 는 lowercase 정규화하여 저장)
  const transmissionId = req.headers.get('tosspayments-webhook-transmission-id');

  try {
    await handleTossWebhook({ rawBody, signature, transmissionId });
    // 200 빠른 응답 — Toss 재시도 폭주 방지(가이드 §4: 10초 SLA).
    // 멱등성은 handleTossWebhook 내부에서 보장.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }
    // 그 외 에러(DB/PG/schema) → 500, Toss 재시도하면 멱등성으로 흡수.
    // 진단을 위해 logger 에 풀 스택 + 원본 페이로드 기록 (응답 본문은 의도적으로 minimal).
    logger.error("payments.webhook.toss.error", err, { rawBody });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
});
