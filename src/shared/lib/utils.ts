import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 (조건부 + 충돌 해소). shadcn 표준 헬퍼. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
