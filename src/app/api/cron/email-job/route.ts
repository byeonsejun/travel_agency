/**
 * EmailJob 배치 처리 cron worker — 얇은 래퍼.
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: Prisma/Resend 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processEmailJobBatch({ limit: 10 });
    logger.info("cron.email-job.run", { ...result });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.email-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.email-job.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
