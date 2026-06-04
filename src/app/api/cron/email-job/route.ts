/**
 * EmailJob 배치 처리 cron worker 엔드포인트.
 *   GET /api/cron/email-job
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: 워커가 Prisma/Resend 사용.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
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
