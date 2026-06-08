import { z } from "zod";
import { PenaltyTiersSchema } from "@/entities/penalty-policy";

// 정책 key 는 버전 간 안정 식별자 → URL/슬러그 안전 문자만 허용.
// tiers 불변식(최소 1행 + minDaysBefore 엄격 내림차순)은 entities/penalty-policy 의
// PenaltyTiersSchema 를 그대로 재사용(SSOT) — 검증 규칙 drift 방지.
export const SavePenaltyPolicySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "정책 key를 입력해 주세요")
    .max(50, "정책 key는 50자 이내로 입력해 주세요")
    .regex(/^[a-z0-9_]+$/, "key는 소문자/숫자/밑줄(_)만 사용할 수 있습니다"),
  name: z
    .string()
    .trim()
    .min(1, "정책 이름을 입력해 주세요")
    .max(100, "정책 이름은 100자 이내로 입력해 주세요"),
  tiers: PenaltyTiersSchema,
});

export type SavePenaltyPolicyInput = z.infer<typeof SavePenaltyPolicySchema>;
