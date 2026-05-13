import type { UserRole, Gender } from "@prisma/client";

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: "고객",
  ADMIN: "관리자",
};

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "남성",
  FEMALE: "여성",
};
