"use server";
import { auth } from "@/features/auth/server/auth";
import {
  parseFilter,
  getRevenueRows,
  getPenaltyRows,
  getCancellationRows,
  getOccupancyRows,
  type DrilldownData,
} from "@/entities/analytics";
import { DrilldownInputSchema, type DrilldownInput } from "./schema";

// 대시보드와 동일 필터 차원(productId + start/end)을 받아 KPI 카드와 동일
// 코호트로 드릴다운한다. 날짜·productId 형식 검증·window 재도출은 모두 서버의
// parseFilter 가 담당 — 클라이언트가 보낸 값을 신뢰하지 않는다.
// 입력 스키마는 ./schema 로 분리 — "use server" 파일은 async 함수만 export 가능.
export type DrilldownState =
  | { type: "success"; data: DrilldownData }
  | { type: "error"; message: string };

export async function loadDrilldownAction(
  input: DrilldownInput,
): Promise<DrilldownState> {
  const session = await auth();
  if (!session?.user?.id)
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  if (session.user.role !== "ADMIN")
    return { type: "error", message: "권한 없음" };

  const parsed = DrilldownInputSchema.safeParse(input);
  if (!parsed.success) return { type: "error", message: "입력값 오류" };

  // 클라이언트 날짜·productId 불신 — parseFilter 로 window·productId 재도출.
  const filter = parseFilter({
    start: parsed.data.start,
    end: parsed.data.end,
    productId: parsed.data.productId,
  });

  try {
    switch (parsed.data.metric) {
      case "revenue":
        return {
          type: "success",
          data: { metric: "revenue", result: await getRevenueRows(filter) },
        };
      case "penalty":
        return {
          type: "success",
          data: { metric: "penalty", result: await getPenaltyRows(filter) },
        };
      case "cancellation":
        return {
          type: "success",
          data: {
            metric: "cancellation",
            result: await getCancellationRows(filter),
          },
        };
      case "occupancy":
        return {
          type: "success",
          data: { metric: "occupancy", result: await getOccupancyRows(filter) },
        };
    }
  } catch {
    return { type: "error", message: "데이터 조회 실패" };
  }
}
