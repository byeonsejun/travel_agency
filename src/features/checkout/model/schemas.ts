import { z } from "zod";
import { TravelerSchema } from "@/entities/booking";

export const CheckoutFormSchema = z
  .object({
    departureId: z.string().cuid(),
    adultCount: z.number().int().min(1, "성인은 최소 1명이어야 합니다"),
    childCount: z.number().int().min(0).default(0),
    infantCount: z.number().int().min(0).default(0),
    travelers: z.array(TravelerSchema).min(1, "여행자 정보를 입력하세요"),
    termKeys: z.array(z.string()).min(1, "필수 약관에 동의해 주세요"),
    notes: z.string().optional(),
  })
  .refine((d) => d.infantCount <= d.adultCount, {
    message: "영아 수는 성인 수를 초과할 수 없습니다",
    path: ["infantCount"],
  })
  .refine((d) => d.adultCount + d.childCount + d.infantCount <= 9, {
    message: "총 인원은 9명을 초과할 수 없습니다",
    path: ["adultCount"],
  })
  .refine((d) => d.travelers.length === d.adultCount + d.childCount, {
    message: "여행자 수와 인원 수가 일치하지 않습니다",
    path: ["travelers"],
  });

export type CheckoutFormInput = z.infer<typeof CheckoutFormSchema>;
