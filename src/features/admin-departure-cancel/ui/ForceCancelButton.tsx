"use client";

// Fat-finger 방어 — 강제 취소는 파급력이 크므로 제출 전 명시적 confirm.
// page는 RSC라 confirm을 쓸 수 없으므로 이 client 아일랜드로 격리.
// 타이머/리스너 없음 → cleanup 불필요.
export function ForceCancelButton({
  action,
  departureId,
  productId,
  bookedSeats,
}: {
  action: (formData: FormData) => void | Promise<void>;
  departureId: string;
  productId: string;
  bookedSeats: number;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = window.confirm(
          `정말 강제 취소하시겠습니까?\n\n${bookedSeats}건의 예약이 일괄 취소되고, 결제 완료 건은 환불 큐에 적재됩니다.\n이 작업은 되돌릴 수 없습니다.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="departureId" value={departureId} />
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        강제 취소 ({bookedSeats}건 환불)
      </button>
    </form>
  );
}
