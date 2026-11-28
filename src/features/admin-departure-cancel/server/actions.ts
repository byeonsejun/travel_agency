"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server";
import { db } from "@/shared/lib/db";
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import { tagDeparturesByProduct } from "@/entities/departure";
import { DepartureNotCancelableError } from "./errors";
import { startDepartureCancellation } from "./startDepartureCancellation";


/**
 * departure 편집 페이지의 "강제 취소" 진입점 — form action.
 * ADMIN 가드 후 startDepartureCancellation 위임 → departure 캐시 무효화 → 배치 상세로 redirect.
 * 이미 취소된 경우(DepartureNotCancelableError) 출발일 목록으로 안내.
 */
export async function forceCancelDepartureAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/admin/products");
  const adminId = session.user.id;

  const departureId = String(formData.get("departureId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!departureId) redirect("/admin/products");

  let batchId: string;
  try {
    const res = await startDepartureCancellation({
      departureId,
      actor: `admin:${adminId}`,
      reason: "관리자 강제 취소",
    });
    batchId = res.batchId;
  } catch (e) {
    if (e instanceof DepartureNotCancelableError) {
      redirect(`/admin/products/${productId}/departures`);
    }
    throw e;
  }

  // departure가 CANCELED 되었으므로 공개 PDP 좌석표 캐시 즉시 무효화.
  // admin 강제 취소 → 매진 상태가 즉시 반영되어야 함 (ADR-0053 §4): updateTag = no-stale.
  if (productId) {
    updateTag(tagDeparturesByProduct(productId));
    revalidatePath(`/products/${productId}`);
  }
  redirect(`/admin/departure-cancellations/${batchId}`);
}

/**
 * 배치 단위(또는 단건) FAILED RefundJob 재시도. FAILED → PENDING(nextRunAt=now) CAS 후
 * cron이 같은 Saga로 재drain. 재시도 직후 배치 status 재계산.
 * jobId 있으면 단건, 없으면 배치 전체 FAILED.
 */
export async function retryBatchRefundAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin/products");

  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) redirect("/admin/departure-cancellations");

  const jobIdRaw = formData.get("jobId");
  const where = jobIdRaw
    ? { id: String(jobIdRaw), status: "FAILED" as const }
    : { cancellationBatchId: batchId, status: "FAILED" as const };

  await db.refundJob.updateMany({ where, data: { status: "PENDING", nextRunAt: new Date() } });
  await recomputeBatchStatus(batchId);

  revalidatePath(`/admin/departure-cancellations/${batchId}`);
  redirect(`/admin/departure-cancellations/${batchId}`);
}
