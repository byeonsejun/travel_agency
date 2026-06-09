import { Suspense } from "react";
import Link from "next/link";
import { SortSelect } from "./SortSelect";

type Destination = { code: string; label: string; count: number };

type ProductFilterBarProps = {
  destinations: Destination[];
  activeCode?: string;
  activeSort: string;
};

export function ProductFilterBar({
  destinations,
  activeCode,
  activeSort,
}: ProductFilterBarProps) {
  const buildHref = (code?: string): string => {
    const params = new URLSearchParams();
    if (code) {
      params.set("destination", code);
    }
    params.set("sort", activeSort);
    return `/products?${params.toString()}`;
  };

  const isAllActive = !activeCode;

  const chipClass = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
    }`;

  return (
    <div className="space-y-4 border-b border-border pb-6">
      {/* Destination chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href={buildHref()} className={chipClass(isAllActive)}>
          전체
        </Link>
        {destinations.map((dest) => (
          <Link
            key={dest.code}
            href={buildHref(dest.code)}
            className={chipClass(activeCode === dest.code)}
          >
            {dest.label} ({dest.count})
          </Link>
        ))}
      </div>

      {/* Sort select with Suspense */}
      <div className="flex justify-end">
        <Suspense fallback={<div className="h-9 w-40 rounded-md border border-input bg-secondary" />}>
          <SortSelect current={activeSort} />
        </Suspense>
      </div>
    </div>
  );
}
