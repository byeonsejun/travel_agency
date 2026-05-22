import { z } from "zod";

// 리뷰 입력 검증. 클라이언트 폼·Server Action 양쪽이 같은 schema를 공유해
// 표시 검증 ↔ 서버 가드 간 drift 0를 보장한다.
//
// - rating: 정수 1~5 강제. 별점은 항상 정수 (PRD §4.2).
// - content: trim 후 1~1000자. 양끝 공백만 입력한 경우도 빈 문자열로 간주해 거부.
export const ReviewInputSchema = z.object({
  rating: z
    .number()
    .int({ message: "별점은 정수여야 합니다." })
    .min(1, { message: "별점은 1점 이상이어야 합니다." })
    .max(5, { message: "별점은 5점 이하여야 합니다." }),
  content: z
    .string()
    .trim()
    .min(1, { message: "후기 내용을 입력해주세요." })
    .max(1000, { message: "후기는 최대 1000자까지 입력 가능합니다." }),
});

export type ReviewInput = z.infer<typeof ReviewInputSchema>;
