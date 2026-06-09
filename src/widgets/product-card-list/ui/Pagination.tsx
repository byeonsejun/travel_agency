import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "@/shared/ui/button";

type PaginationProps = {
  total: number;
  pageSize: number;
  currentPage: number;
  searchParams: Record<string, string>;
};

export function Pagination({
  total,
  pageSize,
  currentPage,
  searchParams,
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return null;
  }

  const buildHref = (page: number): string => {
    const params = new URLSearchParams({ ...searchParams, page: String(page) });
    return `/products?${params.toString()}`;
  };

  const pageNumbers: number[] = [];
  const rangeStart = Math.max(1, currentPage - 2);
  const rangeEnd = Math.min(totalPages, currentPage + 2);

  for (let i = rangeStart; i <= rangeEnd; i++) {
    pageNumbers.push(i);
  }

  const navBtn = buttonVariants({ variant: "outline", size: "default" });
  const pageBtn = (active: boolean) =>
    active
      ? buttonVariants({ variant: "default", size: "icon" })
      : buttonVariants({ variant: "outline", size: "icon" });

  return (
    <nav
      className="flex items-center justify-center gap-2 border-t border-border pt-6"
      aria-label="Pagination"
    >
      {/* Previous button */}
      {currentPage > 1 ? (
        <Link href={buildHref(currentPage - 1)} className={navBtn}>
          이전
        </Link>
      ) : (
        <button disabled className={cn(navBtn, "cursor-not-allowed opacity-50")}>
          이전
        </button>
      )}

      {/* Page numbers */}
      <div className="flex gap-1">
        {rangeStart > 1 && (
          <>
            <Link href={buildHref(1)} className={pageBtn(false)}>
              1
            </Link>
            {rangeStart > 2 && (
              <span className="px-2 py-2 text-sm text-muted-foreground">...</span>
            )}
          </>
        )}

        {pageNumbers.map((page) => (
          <Link
            key={page}
            href={buildHref(page)}
            aria-current={page === currentPage ? "page" : undefined}
            className={pageBtn(page === currentPage)}
          >
            {page}
          </Link>
        ))}

        {rangeEnd < totalPages && (
          <>
            {rangeEnd < totalPages - 1 && (
              <span className="px-2 py-2 text-sm text-muted-foreground">...</span>
            )}
            <Link href={buildHref(totalPages)} className={pageBtn(false)}>
              {totalPages}
            </Link>
          </>
        )}
      </div>

      {/* Next button */}
      {currentPage < totalPages ? (
        <Link href={buildHref(currentPage + 1)} className={navBtn}>
          다음
        </Link>
      ) : (
        <button disabled className={cn(navBtn, "cursor-not-allowed opacity-50")}>
          다음
        </button>
      )}
    </nav>
  );
}
