import Link from "next/link";
import { THEME_TILES, buildThemeHref } from "../model/themeLinks";

export function HomeThemeBento() {
  return (
    <section className="mt-16">
      <h2 className="mb-6 text-2xl font-extrabold tracking-tight">테마별 기획전</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {THEME_TILES.map((t) => (
          <Link
            key={t.query}
            href={buildThemeHref(t.query)}
            className={`flex min-h-[130px] flex-col justify-end rounded-lg bg-gradient-to-br ${t.className} p-6 text-lg font-extrabold text-white transition-transform hover:-translate-y-1`}
          >
            <span className="mb-1 text-sm font-semibold opacity-90">{t.sub}</span>
            {t.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
