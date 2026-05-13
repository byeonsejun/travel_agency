import { z } from "zod";

export const passportProfileSchema = z.object({
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
    .regex(/^[A-Z]{1,2}[0-9]{7,9}$/, "여권번호 형식을 확인하세요"),
  expireDate: z.coerce.date(),
  nationality: z.string().default("KR"),
});

export type PassportProfileInput = z.infer<typeof passportProfileSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1, "이름을 입력하세요").optional(),
  phone: z
    .string()
    .regex(/^01[0-9]{8,9}$/, "올바른 휴대폰 번호를 입력하세요")
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
