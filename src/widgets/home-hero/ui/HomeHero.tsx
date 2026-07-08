import { SearchBox, SearchChips } from "@/features/search";
import { HeroParallaxBackground } from "./HeroParallaxBackground";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl">
      {/* 배경 여행 이미지 (self-host, CSP img-src 'self') — LCP 대상이라 priority.
          패럴랙스 모션만 client 리프로 격리, 셸은 RSC 유지(HeroParallaxBackground). */}
      <HeroParallaxBackground />
      {/* 가독성 오버레이 — 블루틴트 다크 그라데이션으로 흰 텍스트 대비 확보.
          장식 레이어라 pointer-events-none: 검색창·칩 등 전경 인터랙션만 hit-test 소유. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/35 via-foreground/45 to-foreground/65" />

      <div className="relative z-10 px-6 py-20 text-center md:py-28">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.35)] md:text-5xl">
          조건에 딱 맞는 여행을
          <br />
          AI가 찾아드립니다
        </h1>
        <p className="mt-4 text-base text-white/90 drop-shadow-[0_1px_12px_rgba(0,0,0,0.35)] md:text-lg">
          목적지·날짜·인원만 입력하면, 나머지는 Nextour가.
        </p>
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="rounded-2xl bg-card p-3 shadow-float">
            <SearchBox />
          </div>
          <div className="mt-5 flex justify-center">
            <SearchChips />
          </div>
        </div>
      </div>
    </section>
  );
}
