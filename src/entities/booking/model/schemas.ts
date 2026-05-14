import { z } from "zod";

export const TravelerSchema = z.object({
  lastNameEn: z
    .string()
    .min(1, "성을 입력하세요")
    .regex(/^[A-Z]+$/, "여권에 표기된 영문 대문자 성을 입력하세요"),
  firstNameEn: z
    .string()
    .min(1, "이름을 입력하세요")
    .regex(/^[A-Z\s]+$/, "여권에 표기된 영문 대문자 이름을 입력하세요"),
  gender: z.enum(["MALE", "FEMALE"]),
  birthDate: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: "생년월일은 과거 날짜여야 합니다" }),
  passportNo: z
    .string()
    .regex(/^[A-Z0-9]{8,9}$/, "여권번호는 8~9자리 영숫자여야 합니다")
    .optional(),
  expireDate: z.coerce.date().optional(),
  phone: z.string().optional(),
  email: z.string().email("올바른 이메일을 입력하세요").optional(),
  role: z.enum(["BOOKER", "TRAVELER"]).optional(),
});

export type TravelerInput = z.infer<typeof TravelerSchema>;

export const CreateBookingSchema = z
  .object({
    departureId: z.string().cuid(),
    userId: z.string().cuid(),
    adultCount: z.number().int().min(1, "성인은 최소 1명이어야 합니다"),
    childCount: z.number().int().min(0).default(0),
    infantCount: z.number().int().min(0).default(0),
    expectedTotalPrice: z
      .number()
      .int("금액은 정수(원 단위)여야 합니다")
      .nonnegative("금액은 0 이상이어야 합니다"),
    travelers: z.array(TravelerSchema).min(1, "여행자 정보를 입력하세요"),
    termKeys: z.array(z.string()).min(1, "필수 약관에 동의해 주세요"),
    notes: z.string().optional(),
  })
  .refine((data) => data.infantCount <= data.adultCount, {
    message: "영아 수는 성인 수를 초과할 수 없습니다",
    path: ["infantCount"],
  })
  .refine(
    (data) =>
      data.adultCount + data.childCount + data.infantCount <= 9,
    {
      message: "총 인원은 9명을 초과할 수 없습니다",
      path: ["adultCount"],
    }
  )
  .refine(
    (data) => data.travelers.length === data.adultCount + data.childCount,
    {
      message: "여행자 수와 인원 수가 일치하지 않습니다",
      path: ["travelers"],
    }
  );

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
