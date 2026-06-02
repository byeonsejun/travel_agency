import { z } from "zod";
import { departureSchema } from "@/entities/departure";

// 폼 본문은 entities departureSchema(7필드 + 날짜/minPax refine) 그대로 재사용.
// productId/departureId는 신뢰된 route param에서 bind되므로 입력 본문에 두지 않는다.
export const departureFormSchema = departureSchema;
export type DepartureFormInput = z.infer<typeof departureFormSchema>;

// 상태 전이 입력 — form action(hidden input) 용.
export const departureTransitionSchema = z.object({
  departureId: z.string().cuid("올바른 출발일 ID가 필요합니다"),
  productId: z.string().cuid("올바른 상품 ID가 필요합니다"),
  to: z.enum(["SCHEDULED", "CONFIRMED", "CLOSED", "CANCELED"]),
});
export type DepartureTransitionInput = z.infer<typeof departureTransitionSchema>;
