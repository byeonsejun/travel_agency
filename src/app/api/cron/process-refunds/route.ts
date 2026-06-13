/**
 * RefundJob 큐 cron worker — 얇은 래퍼. 로직은 shared/lib/refund-job/worker.
 * 외부 트리거의 per-worker 개별 호출 진입점으로 유지(dispatcher와 별개).
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processRefundJobBatch } from "@/shared/lib/refund-job/worker";
import { logger, metrics } from "@/shared/lib/observability";


export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processRefundJobBatch({ limit: 10 });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.refund.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.refund.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
