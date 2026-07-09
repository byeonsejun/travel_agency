"use client";

import { useLayoutEffect } from "react";

/**
 * PDP 진입 시 스크롤을 항상 최상단으로 강제 리셋한다.
 *
 * Next.js `<Link>`의 기본 스크롤 정책은 "새 페이지가 이미 뷰포트에 보이면 스크롤
 * 위치를 유지"하므로(공식 문서), 목록에서 깊이 스크롤한 채 카드를 클릭하면 PDP가
 * 이전 스크롤 위치인 채로 열린다. `(site)/layout.tsx`가 헤더/푸터를 유지한 채
 * children만 교체하는 공유 셸 구조라 이 정책이 그대로 적용됨 — PDP는 이 컴포넌트로
 * 그 기본 정책을 오버라이드한다. 다른 라우트의 스크롤 유지/뒤로가기 복원은 무관.
 *
 * useLayoutEffect: 페인트 전에 동기 실행해 이전 스크롤 위치가 잠깐 보이는 플리커를
 * 최소화(브라우저 API만 호출하는 1회성 부수효과라 cleanup 불필요).
 */
export function PdpScrollReset({ productId }: { productId: string }) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [productId]);

  return null;
}
