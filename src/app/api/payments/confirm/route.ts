import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/features/auth/server/auth";
import {
  ConfirmPaymentRequestSchema,
  confirmPayment,
  PaymentError,
} from "@/entities/payment";
import { withObservedRoute } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PaymentError code → HTTP status 매핑 (spec §5, backend-expert R3-2) */
function mapPaymentError(err: unknown): NextResponse {
  if (err instanceof PaymentError) {
    const { code } = err;

    if (code === "BOOKING_NOT_FOUND" || code === "PAID_PAYMENT_NOT_FOUND") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    if (code === "FORBIDDEN") {
      return NextResponse.json({ error: code }, { status: 403 });
    }
    if (
      code === "BOOKING_NOT_PAYABLE" ||
      code === "REFUND_ALREADY_REQUESTED" ||
      code === "BOOKING_NOT_REFUNDABLE"
    ) {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (
      code === "AMOUNT_MISMATCH_REQUEST" ||
      code === "AMOUNT_MISMATCH_PG_RESPONSE" ||
      code === "AMOUNT_NOT_INTEGER" ||
      code === "WEBHOOK_AMOUNT_MISMATCH"
    ) {
      return NextResponse.json({ error: code }, { status: 422 });
    }
    // PG_NETWORK_ERROR, PG_HTTP, DB_UPDATE_FAILED → 500
    return NextResponse.json({ error: code }, { status: 500 });
  }

  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

export const POST = withObservedRoute(
  "payments.confirm",
  async (req: NextRequest): Promise<NextResponse> => {
    // Step 1: 인증 가드 — backend-expert R3-3
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Step 2: 입력 검증 — backend-expert R3-1, domain-booking R6
    const body = await req.json().catch(() => null);
    const parsed = ConfirmPaymentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Step 3: 도메인 위임 — 비즈니스 로직 없음, architect R3
    try {
      const result = await confirmPayment({
        userId: session.user.id,
        ...parsed.data,
      });
      return NextResponse.json(result);
    } catch (err) {
      return mapPaymentError(err);
    }
  }
);
