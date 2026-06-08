import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminDepartureById,
  allowedNextStatuses,
  DEPARTURE_STATUS_LABEL,
} from "@/entities/departure";
import {
  DepartureForm,
  updateDepartureAction,
  transitionDepartureAction,
} from "@/features/admin-departure";
import {
  ForceCancelButton,
  forceCancelDepartureAction,
} from "@/features/admin-departure-cancel";
import { getActivePenaltyPolicies } from "@/entities/penalty-policy";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; depId: string }>;
  searchParams: Promise<{ error?: string }>;
};

const TRANSITION_ERRORS: Record<string, string> = {
  has_bookings:
    "예약이 존재해 출발을 취소할 수 없습니다. /admin/bookings에서 개별 취소 후 다시 시도하세요.",
  stale: "상태가 변경되었습니다. 새로고침 후 다시 시도하세요.",
  invalid: "현재 상태에서는 불가능한 전이입니다.",
  not_found: "출발일을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.",
  unknown: "상태 전이에 실패했습니다.",
};

const ACTION_LABEL: Record<string, string> = {
  CONFIRMED: "출발 확정",
  CLOSED: "마감",
  SCHEDULED: "재개봉",
  CANCELED: "출발 취소",
};

export default async function EditDeparturePage({ params, searchParams }: PageProps) {
  const { id: productId, depId } = await params;
  const { error } = await searchParams;
  const [dep, policies] = await Promise.all([
    getAdminDepartureById(depId),
    getActivePenaltyPolicies(),
  ]);
  if (!dep) notFound();

  const policyOptions = policies.map((p) => ({ key: p.key, name: p.name }));
  const action = updateDepartureAction.bind(null, depId, productId);
  const nextStatuses = allowedNextStatuses(dep.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/products/${productId}/departures`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">출발일 편집</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {DEPARTURE_STATUS_LABEL[dep.status]}
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {TRANSITION_ERRORS[error] ?? TRANSITION_ERRORS.unknown}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <DepartureForm
            action={action}
            initial={dep}
            bookedSeats={dep.bookedSeats}
            policies={policyOptions}
          />
        </div>

        {/* 상태 전이 패널 — <form action> progressive enhancement */}
        <aside className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">상태 전이</h2>
          <p className="text-xs text-gray-500">
            현재: {DEPARTURE_STATUS_LABEL[dep.status]} · 예약 {dep.bookedSeats}석
          </p>
          {nextStatuses.length === 0 ? (
            <p className="text-xs text-gray-400">더 이상 전이할 수 없습니다 (종료 상태).</p>
          ) : (
            nextStatuses.map((to) => {
              // 취소 + 예약 존재 → 강제 취소(fan-out 환불) 진입점 (fat-finger confirm).
              if (to === "CANCELED" && dep.bookedSeats > 0) {
                return (
                  <ForceCancelButton
                    key={to}
                    action={forceCancelDepartureAction}
                    departureId={dep.id}
                    productId={productId}
                    bookedSeats={dep.bookedSeats}
                  />
                );
              }
              // 그 외 전이(확정/마감/재개봉 + 예약 0건 일반 취소) → 기존 progressive-enhancement form.
              return (
                <form key={to} action={transitionDepartureAction}>
                  <input type="hidden" name="departureId" value={dep.id} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="to" value={to} />
                  <button
                    type="submit"
                    className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                      to === "CANCELED"
                        ? "bg-red-50 text-red-700 hover:bg-red-100"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {ACTION_LABEL[to] ?? to}
                  </button>
                </form>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
