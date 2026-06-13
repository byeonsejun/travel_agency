"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * HeroParallaxBackground — 히어로 배경 패럴랙스 (시그니처 모션, client 리프).
 *
 * HomeHero(RSC)의 정적 셸은 그대로 두고, 배경 이미지 레이어만 이 client 컴포넌트로
 * 격리한다 → 카피·검색창·heading 계층은 서버 prerender 유지.
 *
 * 동작(절제된 깊이감):
 *  - 스크롤: 배경이 전경보다 천천히 따라옴(최대 SCROLL_MAX px 수직 이동).
 *  - 마우스: 뷰포트 중심 기준 ±MOUSE_MAX px 미세 이동(시차).
 *  - transform(translate/scale)만 사용 — 레이아웃 리플로우 0. BASE_SCALE 오버스캔으로
 *    이동 시에도 가장자리가 노출되지 않는다(section overflow-hidden가 클립).
 *  - 이벤트는 passive + requestAnimationFrame로 묶어 프레임당 1회만 DOM write.
 *
 * 접근성(이중 보장):
 *  - JS: matchMedia('(prefers-reduced-motion: reduce)') → 리스너 미부착, 정적 폴백.
 *  - CSS: `motion-reduce:!transform-none` → reduce 사용자는 인라인 scale도 무효화(정적).
 */

const SCROLL_MAX = 20; // px — 스크롤 시 배경 최대 수직 이동(미묘하게)
const MOUSE_MAX = 10; // px — 마우스 시 배경 최대 수평 이동
const SCROLL_RANGE = 600; // px — 이 거리만큼 스크롤하면 SCROLL_MAX에 수렴
const BASE_SCALE = 1.18; // 이동분을 흡수하는 오버스캔(배경 사진이라 확대 비인지)

export function HeroParallaxBackground() {
  const layerRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  // 다음 프레임에 반영할 목표 이동값(이벤트 핸들러는 여기에 쓰기만, 적용은 rAF에서).
  const target = useRef({ sy: 0, mx: 0, my: 0 });

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;

    // 접근성 폴백 — reduce 사용자는 리스너를 아예 달지 않는다(정적 히어로).
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) return;

    const apply = () => {
      frame.current = null;
      const { sy, mx, my } = target.current;
      el.style.transform = `translate3d(${mx}px, ${sy + my}px, 0) scale(${BASE_SCALE})`;
    };
    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(apply);
    };

    const onScroll = () => {
      // 히어로 상단이 뷰포트 위로 사라진 정도(0~1) → 절제된 수직 이동.
      const top = el.getBoundingClientRect().top; // read (layout)
      const progress = Math.min(Math.max(-top, 0), SCROLL_RANGE) / SCROLL_RANGE;
      target.current.sy = progress * SCROLL_MAX;
      schedule();
    };
    const onPointerMove = (e: PointerEvent) => {
      target.current.mx = (e.clientX / window.innerWidth - 0.5) * 2 * MOUSE_MAX;
      target.current.my = (e.clientY / window.innerHeight - 0.5) * 2 * (MOUSE_MAX * 0.6);
      schedule();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    onScroll(); // 초기 위치 반영(스크롤된 채 진입한 경우 대비)

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        // ⚠️ 필수: pending rAF 취소 후 ref 도 null 로 리셋.
        // 누락 시 재마운트(Strict Mode 더블 인보크/PDP 왕복)가 stale non-null 을
        // 물려받아 schedule() 의 `frame.current === null` 게이트가 영구 차단됨 → 패럴랙스 사망.
        frame.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className="absolute inset-0 motion-reduce:!transform-none"
      style={{ transform: `scale(${BASE_SCALE})`, willChange: "transform" }}
    >
      <Image
        src="/hero-travel.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
    </div>
  );
}
