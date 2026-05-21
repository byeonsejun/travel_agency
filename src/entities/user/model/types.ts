import type { User, UserRole, PassportProfile, Gender } from "@prisma/client";

export type { UserRole, Gender };

export type UserWithProfile = User & {
  passportProfile: PassportProfile | null;
};

// 클라이언트에 노출해도 안전한 유저 정보 (민감 필드 제거)
export type SafeUser = Pick<User, "id" | "name" | "email" | "image" | "role">;

// passportNo가 마스킹된 여권 정보 — 클라이언트 응답에서 원본 노출 차단
export type SafePassportProfile = Omit<PassportProfile, "passportNo"> & {
  passportNo: string;
};
