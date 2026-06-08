import { z } from "zod";

export const departureSchema = z
  .object({
    departureDate: z.coerce.date(),
    returnDate: z.coerce.date(),
    priceAdult: z.number().int().min(0, "성인 요금을 입력하세요"),
    priceChild: z.number().int().min(0, "아동 요금을 입력하세요"),
    priceInfant: z.number().int().min(0).default(0),
    capacity: z.number().int().min(1, "정원을 입력하세요"),
    minPax: z.number().int().min(1, "최소 출발 인원을 입력하세요"),
    // 위약금 정책 오버라이드(Phase 14). "" / 미지정은 null(상품 정책 상속)로 정규화.
    penaltyPolicyKey: z
      .preprocess(
        (v) => (v === "" || v == null ? null : v),
        z.string().min(1).nullable(),
      )
      .optional(),
  })
  .refine((data) => data.returnDate > data.departureDate, {
    message: "귀국일은 출발일 이후여야 합니다",
    path: ["returnDate"],
  })
  .refine((data) => data.minPax <= data.capacity, {
    message: "최소 출발 인원은 정원보다 클 수 없습니다",
    path: ["minPax"],
  });

export type DepartureFormData = z.infer<typeof departureSchema>;
