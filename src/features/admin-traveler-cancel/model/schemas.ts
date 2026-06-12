import { z } from "zod";

// Zod 스키마(런타임 값)는 "use server" 파일에 둘 수 없다(async 함수만 export 허용,
// Next 16). 액션이 import해 safeParse에 사용. ([project_use_server_only_async])
export const TravelerCancelSchema = z.object({
  bookingId: z.string().min(1),
  travelerIds: z.array(z.string().min(1)).min(1),
  applyPenalty: z.boolean(),
  reason: z.string().optional(),
});

export type TravelerCancelInput = z.infer<typeof TravelerCancelSchema>;
