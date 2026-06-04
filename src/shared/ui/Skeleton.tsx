import type { ComponentPropsWithoutRef } from "react";

type SkeletonProps = ComponentPropsWithoutRef<"div">;

/** 도메인 무지 펄스 박스. className 으로 크기/모양 지정. CSS 애니메이션이라 RSC 안전(no 'use client'). */
export function Skeleton({ className = "", ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-gray-200 ${className}`}
      {...rest}
    />
  );
}
