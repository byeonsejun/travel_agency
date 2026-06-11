"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  tagDeparturesByProduct,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  DepartureNotFoundError,
  StaleDepartureStatusError,
  InvalidDepartureTransitionError,
} from "@/entities/departure";
import { departureFormSchema, departureTransitionSchema } from "../model/schemas";
import type { DepartureFormInput } from "../model/schemas";

export type DepartureActionState =
  | { type: "success"; departureId?: string }
  | { type: "error"; message: string; fieldErrors?: Record<string, string[]> };

// ── 3중 권한 가드 helper ──────────────────────────────────────────────

async function requireAdminSession(): Promise<
  { ok: true; adminId: string } | { ok: false; error: DepartureActionState }
> {
  const session = await auth();
  if (!session?.user?.id)
    return { ok: false, error: { type: "error", message: "관리자 로그인이 필요합니다" } };
  if (session.user.role !== "ADMIN")
    return { ok: false, error: { type: "error", message: "관리자 권한이 필요합니다" } };
  return { ok: true, adminId: session.user.id };
}

// ── Zod 에러 → fieldErrors ────────────────────────────────────────────

function buildZodError(error: import("zod").ZodError): DepartureActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return {
    type: "error",
    message: error.issues[0]?.message ?? "입력값을 확인해 주세요",
    fieldErrors,
  };
}

// ── 캐시 무효화 helper ────────────────────────────────────────────────
// spec §10: 공개 PDP ISR(`/products/${productId}`) + 출발일 목록 태그.
// admin 라우트는 force-dynamic이므로 revalidatePath 불필요.

function invalidate(productId: string) {
  revalidateTag(tagDeparturesByProduct(productId), "max");
  revalidatePath(`/products/${productId}`);
}

// ── 도메인 에러 → 사용자 메시지 ──────────────────────────────────────

function mapDomainError(e: unknown): string {
  if (e instanceof CapacityBelowBookedError)
    return "현재 예약된 좌석 수보다 적게 정원을 줄일 수 없습니다";
  if (e instanceof DepartureDateConflictError)
    return "해당 날짜에 이미 출발일이 있습니다";
  if (e instanceof DepartureHasBookingsError)
    return `예약 ${e.bookedSeats}건이 존재합니다 — 개별 취소 후 출발 취소가 가능합니다`;
  if (e instanceof DepartureNotFoundError)
    return "출발일을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요";
  if (e instanceof StaleDepartureStatusError)
    return "상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요";
  if (e instanceof InvalidDepartureTransitionError)
    return "현재 상태에서는 불가능한 전이입니다";
  return "처리에 실패했습니다. 잠시 후 다시 시도해 주세요";
}

// ══════════════════════════════════════════════════════════════════════
// createDepartureAction
// ══════════════════════════════════════════════════════════════════════

/**
 * 출발일 신규 등록 Server Action.
 *
 * productId는 route param에서 bind — useActionState(action.bind(null, productId), null)
 * 보안: 3중 가드(middleware → admin layout → 본 action)
 * 캐시: tagDeparturesByProduct + /products/${productId} PDP ISR 무효화
 */
export async function createDepartureAction(
  productId: string,
  _prev: DepartureActionState | null,
  input: DepartureFormInput,
): Promise<DepartureActionState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;

  // 2. Zod 검증
  const parsed = departureFormSchema.safeParse(input);
  if (!parsed.success) return buildZodError(parsed.error);

  // 3. 출발일 생성
  try {
    const departureId = await createDeparture(productId, parsed.data);
    invalidate(productId);
    return { type: "success", departureId };
  } catch (e) {
    return { type: "error", message: mapDomainError(e) };
  }
}

// ══════════════════════════════════════════════════════════════════════
// updateDepartureAction
// ══════════════════════════════════════════════════════════════════════

/**
 * 출발일 수정 Server Action.
 *
 * departureId + productId 둘 다 route param에서 bind.
 * 정원 축소 race-free: entity layer의 updateMany CAS가 담당.
 */
export async function updateDepartureAction(
  departureId: string,
  productId: string,
  _prev: DepartureActionState | null,
  input: DepartureFormInput,
): Promise<DepartureActionState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;

  // 2. Zod 검증
  const parsed = departureFormSchema.safeParse(input);
  if (!parsed.success) return buildZodError(parsed.error);

  // 3. 출발일 수정
  try {
    await updateDeparture(departureId, parsed.data);
    invalidate(productId);
    return { type: "success", departureId };
  } catch (e) {
    return { type: "error", message: mapDomainError(e) };
  }
}

// ══════════════════════════════════════════════════════════════════════
// transitionDepartureAction
// ══════════════════════════════════════════════════════════════════════

/**
 * 출발일 상태 전이 Server Action — <form action> progressive enhancement.
 *
 * FormData 입력: departureId, productId, to (hidden inputs).
 * 성공: /admin/products/${productId}/departures 로 redirect.
 * 에러: edit 페이지의 ?error=CODE 쿼리로 전달 → RSC 배너 렌더.
 *
 * IMPORTANT: redirect()는 Next.js control-flow 에러를 throw하므로
 * 성공 redirect는 try 블록 밖에서 호출해야 catch가 삼키지 않는다.
 */
export async function transitionDepartureAction(formData: FormData): Promise<void> {
  const { redirect } = await import("next/navigation");

  const guard = await requireAdminSession();
  if (!guard.ok) {
    redirect(`/admin/products`);
    return; // TypeScript 제어 흐름 힌트 — redirect()는 throw이지만 never로 타입이 좁혀지지 않음.
  }

  const parsed = departureTransitionSchema.safeParse({
    departureId: formData.get("departureId"),
    productId: formData.get("productId"),
    to: formData.get("to"),
  });
  if (!parsed.success) {
    redirect(`/admin/products`);
    return;
  }

  const { departureId, productId, to } = parsed.data;
  const editPath = `/admin/products/${productId}/departures/${departureId}/edit`;

  try {
    await transitionDepartureStatus(departureId, to);
    invalidate(productId);
  } catch (e) {
    const code =
      e instanceof DepartureHasBookingsError
        ? "has_bookings"
        : e instanceof StaleDepartureStatusError
          ? "stale"
          : e instanceof DepartureNotFoundError
            ? "not_found"
            : e instanceof InvalidDepartureTransitionError
              ? "invalid"
              : "unknown";
    redirect(`${editPath}?error=${code}`);
    return;
  }

  // 성공 redirect — try 블록 밖에서 호출해야 catch에 잡히지 않는다.
  redirect(`/admin/products/${productId}/departures`);
}
