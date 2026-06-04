import { Suspense } from "react";
import { ProgressLink } from "@/shared/ui/ProgressLink";
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

  return (
    <div className="space-y-4 border-b border-gray-200 pb-6">
      {/* Destination tabs */}
      <div className="flex gap-2 overflow-x-auto">
        <ProgressLink
          href={buildHref()}
          className={`whitespace-nowrap pb-2 text-sm font-medium transition-colors ${
            isAllActive
              ? "border-b-2 border-blue-500 text-blue-600"
              : "border-b-2 border-transparent text-gray-600 hover:text-gray-900"
          }`}
        >
          전체
        </ProgressLink>
        {destinations.map((dest) => (
          <ProgressLink
            key={dest.code}
            href={buildHref(dest.code)}
            className={`whitespace-nowrap pb-2 text-sm font-medium transition-colors ${
              activeCode === dest.code
                ? "border-b-2 border-blue-500 text-blue-600"
                : "border-b-2 border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {dest.label} ({dest.count})
          </ProgressLink>
        ))}
      </div>

      {/* Sort select with Suspense */}
      <div className="flex justify-end">
        <Suspense fallback={<div className="h-10 w-48 rounded border border-gray-300 bg-gray-100" />}>
          <SortSelect current={activeSort} />
        </Suspense>
      </div>
    </div>
  );
}
