"use server";
import { z } from "zod";
import { auth } from "@/features/auth/server/auth";
import {
  parseRange,
  getRevenueRows,
  getPenaltyRows,
  getCancellationRows,
  getOccupancyRows,
  type DrilldownData,
} from "@/entities/analytics";

export const DrilldownInputSchema = z.object({
  metric: z.enum(["revenue", "penalty", "cancellation", "occupancy"]),
  range: z.enum(["today", "7d", "30d", "90d", "all"]),
});
export type DrilldownInput = z.infer<typeof DrilldownInputSchema>;

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

  // 클라이언트가 보낸 날짜 불신 — range 키로 서버가 window 재도출.
  const range = parseRange(parsed.data.range);

  try {
    switch (parsed.data.metric) {
      case "revenue":
        return {
          type: "success",
          data: { metric: "revenue", result: await getRevenueRows(range) },
        };
      case "penalty":
        return {
          type: "success",
          data: { metric: "penalty", result: await getPenaltyRows(range) },
        };
      case "cancellation":
        return {
          type: "success",
          data: {
            metric: "cancellation",
            result: await getCancellationRows(range),
          },
        };
      case "occupancy":
        return {
          type: "success",
          data: { metric: "occupancy", result: await getOccupancyRows() },
        };
    }
  } catch {
    return { type: "error", message: "데이터 조회 실패" };
  }
}
