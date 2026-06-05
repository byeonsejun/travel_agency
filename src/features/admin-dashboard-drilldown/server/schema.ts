import { z } from "zod";

// 드릴다운 입력 스키마 — Zod 스키마는 런타임 object 이므로 "use server" 파일
// (actions.ts)에서 직접 export 할 수 없다("use server" 는 async 함수만 export
// 허용). 별도 모듈로 분리해 actions.ts 와 테스트가 import 한다.
export const DrilldownInputSchema = z.object({
  metric: z.enum(["revenue", "penalty", "cancellation", "occupancy"]),
  start: z.string().optional(),
  end: z.string().optional(),
  productId: z.string().optional(),
});
export type DrilldownInput = z.infer<typeof DrilldownInputSchema>;
