"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { RouteProgress } from "./RouteProgress";

type ProgressLinkProps = ComponentProps<typeof Link>;

/**
 * next/link <Link> 래퍼. children 과 함께 RouteProgress 를 렌더하여
 * 이 링크 클릭으로 시작된 네비게이션 펜딩을 상단 바로 표시한다.
 * 클릭된 링크만 pending → 단일 상단 바처럼 보인다.
 */
export function ProgressLink({ children, ...props }: ProgressLinkProps) {
  return (
    <Link {...props}>
      {children}
      <RouteProgress />
    </Link>
  );
}
