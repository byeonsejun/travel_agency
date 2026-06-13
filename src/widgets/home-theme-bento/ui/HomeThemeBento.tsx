import Image from "next/image";
import Link from "next/link";
import { THEME_TILES, buildThemeHref } from "../model/themeLinks";

/**
 * 테마별 기획전 — 비대칭 에디토리얼 벤토(RSC).
 *
 * 레이아웃: 4타일을 동일 크기로 나열하지 않고 grid span 으로 리듬을 준다.
 *   데스크톱(md+, 4col×2row): [피처 2×2] · [와이드 2×1] · [작은 1×1] · [작은 1×1].
 *   모바일(2col): 피처/와이드는 full(2col), 나머지 2개는 반(1col) — 깨짐 없는 스택형 폴백.
 *
 * 색: 클린 블루 토큰만. 타일 비주얼은 (a) 사진(image) + (b) 토큰 오버레이에서 나온다.
 *   - image 있으면 next/image 사진 + foreground 그라데이션 오버레이(가독성).
 *   - image 없으면(현재) primary 토큰 블록 placeholder + 동일 오버레이("이미지 슬롯" 표식).
 *
 * 호버: CSS 만(모션 라이브러리 0). 살짝 들림 + 그림자 상승 + 오버레이 톤 심화.
 *   prefers-reduced-motion 에서는 transform/transition 무효화(정적 폴백).
 * 'use client' 없음 → 홈 정적(○) prerender 유지.
 */

// 레이아웃은 표현 관심사라 데이터(themeLinks)가 아닌 컴포넌트가 소유. 타일 순서와 1:1.
const TILE_LAYOUT = [
  // 피처: 좌측 큰 타일(2×2)
  { span: "col-span-2 md:col-span-2 md:row-span-2", minH: "min-h-[220px]", sizes: "(min-width: 768px) 50vw, 100vw" },
  // 와이드: 우상단(2×1)
  { span: "col-span-2 md:col-span-2 md:row-span-1", minH: "min-h-[150px]", sizes: "(min-width: 768px) 50vw, 100vw" },
  // 작은 타일 2개(1×1)
  { span: "col-span-1 md:col-span-1 md:row-span-1", minH: "min-h-[150px]", sizes: "(min-width: 768px) 25vw, 50vw" },
  { span: "col-span-1 md:col-span-1 md:row-span-1", minH: "min-h-[150px]", sizes: "(min-width: 768px) 25vw, 50vw" },
] as const;

export function HomeThemeBento() {
  return (
    <section className="mt-16">
      <h2 className="mb-6 text-2xl font-extrabold tracking-tight">테마별 기획전</h2>

      <div className="grid grid-cols-2 gap-4 md:h-[460px] md:grid-cols-4 md:grid-rows-2">
        {THEME_TILES.map((t, i) => {
          const layout = TILE_LAYOUT[i] ?? TILE_LAYOUT[TILE_LAYOUT.length - 1];
          return (
            <Link
              key={t.query}
              href={buildThemeHref(t.query)}
              className={`group relative flex flex-col justify-end overflow-hidden rounded-lg border border-border shadow-card transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${layout.span} ${layout.minH} md:min-h-0 md:h-full`}
            >
              {/* 베이스 레이어: 사진(image) 또는 토큰 placeholder 블록 */}
              {t.image ? (
                <Image src={t.image} alt="" fill sizes={layout.sizes} className="object-cover" />
              ) : (
                <div className="absolute inset-0 bg-primary" aria-hidden>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium tracking-wide text-primary-foreground/45">
                    이미지 슬롯
                  </span>
                </div>
              )}

              {/* 토큰 오버레이 — 가독성 + 호버 톤 심화(전부 foreground 토큰) */}
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-foreground/75 via-foreground/20 to-transparent transition-opacity duration-300 group-hover:from-foreground/85"
              />

              {/* 텍스트 — 토큰(primary-foreground=화이트) */}
              <div className="relative p-5 md:p-6">
                <span className="mb-1 block text-sm font-semibold text-primary-foreground/85">{t.sub}</span>
                <span className="block text-lg font-extrabold text-primary-foreground md:text-xl">{t.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
