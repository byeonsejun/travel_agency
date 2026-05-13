import { z } from "zod";

const travelerSchema = z.object({
  lastNameEn: z
    .string()
    .regex(/^[A-Z]+$/, "여권에 표기된 영문 대문자 성을 입력하세요"),
  firstNameEn: z
    .string()
    .regex(/^[A-Z\s]+$/, "여권에 표기된 영문 대문자 이름을 입력하세요"),
  gender: z.enum(["MALE", "FEMALE"]),
  birthDate: z.coerce.date(),
  passportNo: z
    .string()
    .regex(/^[A-Z]{1,2}[0-9]{7,9}$/, "여권번호 형식을 확인하세요")
    .optional(),
  expireDate: z.coerce.date().optional(),
  phone: z.string().optional(),
  email: z.string().email("올바른 이메일을 입력하세요").optional(),
});

export const createBookingSchema = z
  .object({
    departureId: z.string().cuid(),
    adultCount: z.number().int().min(1, "성인은 최소 1명이어야 합니다"),
    childCount: z.number().int().min(0).default(0),
    infantCount: z.number().int().min(0).default(0),
    travelers: z.array(travelerSchema).min(1, "여행자 정보를 입력하세요"),
    termKeys: z.array(z.string()).min(1, "필수 약관에 동의해 주세요"),
    notes: z.string().optional(),
  })
  .refine(
    (data) =>
      data.travelers.length === data.adultCount + data.childCount,
    { message: "여행자 수와 인원 수가 일치하지 않습니다", path: ["travelers"] }
  );

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// 어드민 — 예약 상태 변경
export const updateBookingStatusSchema = z.object({
  bookingId: z.string().cuid(),
  reason: z.string().optional(),
});
