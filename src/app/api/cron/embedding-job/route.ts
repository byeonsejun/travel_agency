/**
 * EmbeddingJob 배치 처리 cron worker — 얇은 래퍼.
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: worker가 Prisma 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processEmbeddingJobBatch } from "@/shared/lib/embedding-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processEmbeddingJobBatch({ limit: 5 });
    logger.info("cron.embedding-job.run", {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.embedding-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.embedding-job.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
