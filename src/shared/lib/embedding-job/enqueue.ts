/**
 * enqueue.ts — EmbeddingJob 멱등 enqueue SSOT.
 *
 * 왜 FAILED는 in-place update + attempts 보존인가:
 *   FAILED 행에는 이전 시도 횟수(attempts)와 에러 텍스트(lastError)가 담겨 있다.
 *   admin이 상품을 다시 저장하는 것은 "콘텐츠가 바뀌었으니 다시 시도하라"는 명시적 신호이므로
 *   nextRunAt을 now()로 앞당겨 즉시 재시도를 유도한다. 단, attempts/lastError는 이력 보존을
 *   위해 worker가 최종 성공/실패 시 갱신하도록 남겨 둔다.
 *
 * 허용된 import: @prisma/client (타입만)
 * 금지: @/shared/lib/db, observability, features/widgets/app
 */

import type { Prisma } from "@prisma/client";

// 결정 트리 결과 타입 — 조건 분기를 명시적으로 표현해 switch/if 중복 제거.
type EnqueueDecision = "create" | "noop" | "reset-failed";

function resolveDecision(
  existingStatus: string | undefined,
): EnqueueDecision {
  switch (existingStatus) {
    case undefined:
    case "IN_PROGRESS":
    case "SUCCEEDED":
      return "create";
    case "PENDING":
      return "noop";
    case "FAILED":
      return "reset-failed";
    default:
      // 알 수 없는 상태는 방어적으로 새 row를 생성한다
      return "create";
  }
}

export async function enqueueProductEmbeddingJob(
  tx: Prisma.TransactionClient,
  productId: string,
  actor: string,
): Promise<void> {
  // 동일 productId에 활성 상태(PENDING/IN_PROGRESS)가 있는지 조회.
  // FAILED / SUCCEEDED 도 확인해 결정 트리에서 분기한다.
  const existing = await tx.embeddingJob.findFirst({
    where: { productId },
    orderBy: { createdAt: "desc" }, // 최신 row 기준
    select: { id: true, status: true },
  });

  const decision = resolveDecision(existing?.status);

  if (decision === "noop") {
    // PENDING이 이미 큐에 있다 — 두 번째 admin 저장도 같은 job을 재사용.
    return;
  }

  if (decision === "reset-failed") {
    // FAILED를 in-place로 PENDING 전환. attempts/lastError는 worker가 기록한 이력이므로 보존.
    await tx.embeddingJob.update({
      where: { id: existing!.id },
      data: {
        status: "PENDING",
        nextRunAt: new Date(), // admin 저장 = 콘텐츠 변경 신호 → 즉시 재시도
        actor,
      },
    });
    return;
  }

  // "create": 기존 없음 / IN_PROGRESS / SUCCEEDED 분기 모두 신규 PENDING 생성.
  await tx.embeddingJob.create({
    data: {
      productId,
      status: "PENDING",
      attempts: 0,
      actor,
    },
  });
}
