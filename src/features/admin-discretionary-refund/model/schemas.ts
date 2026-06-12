import { z } from "zod";

// Zod 스키마(런타임 값)는 "use server" 파일에 둘 수 없다(async 함수만 export 허용,
// Next 16). 액션이 import해 safeParse에 사용. ([project_use_server_only_async])
export const DiscretionaryRefundSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
  amount: z.number().int().positive(),
  requestId: z.string().min(1),
  reason: z.string().optional(),
});

export type DiscretionaryRefundInput = z.infer<typeof DiscretionaryRefundSchema>;
