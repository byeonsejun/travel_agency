/**
 * Master cron Dispatcher — 단일 진입점. refund/email/embedding 워커를
 * Promise.allSettled로 병렬 실행(워커 단위 격리). 한 워커 throw가 전체를
 * 죽이지 않음(각 워커는 내부에서 per-job 격리). Vercel cron은 이 1개만 호출
 * (Hobby 제한 우회), 실시간 2분 주기는 외부 트리거가 담당.
 *
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: 워커가 Prisma/Resend 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processRefundJobBatch } from "@/shared/lib/refund-job/worker";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { processEmbeddingJobBatch } from "@/shared/lib/embedding-job/worker";
import { processRumCleanup } from "@/shared/lib/rum-cleanup/worker";
import { logger } from "@/shared/lib/observability";


const WORKERS = [
  { name: "refund", run: () => processRefundJobBatch({ limit: 10 }) },
  { name: "email", run: () => processEmailJobBatch({ limit: 10 }) },
  { name: "embedding", run: () => processEmbeddingJobBatch({ limit: 5 }) },
  { name: "rum-cleanup", run: () => processRumCleanup() },
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settled = await Promise.allSettled(WORKERS.map((w) => w.run()));
  const workers = settled.map((s, i) => {
    const worker = WORKERS[i].name;
    if (s.status === "fulfilled") {
      return { worker, status: "fulfilled" as const, ...s.value };
    }
    const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return { worker, status: "rejected" as const, error };
  });

  logger.info("cron.dispatcher.run", {
    workers: workers.map((w) => ({ worker: w.worker, status: w.status })),
  });
  return NextResponse.json({ ranAt: new Date().toISOString(), workers });
}
