import { SearchBox, SearchChips } from "@/features/search";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-secondary">
      <div className="relative z-10 px-6 py-16 text-center md:py-24">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
          조건에 딱 맞는 여행을
          <br />
          AI가 찾아드립니다
        </h1>
        <p className="mt-4 text-base text-muted-foreground md:text-lg">
          목적지·날짜·인원만 입력하면, 나머지는 Nextour가.
        </p>
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="rounded-2xl bg-card p-3 shadow-float">
            <SearchBox />
          </div>
          <div className="mt-4 flex justify-center">
            <SearchChips />
          </div>
        </div>
      </div>
    </section>
  );
}
