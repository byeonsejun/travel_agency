import { ProgressLink } from "@/shared/ui/ProgressLink";

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

  return (
    <nav
      className="flex items-center justify-center gap-2 border-t border-gray-200 pt-6"
      aria-label="Pagination"
    >
      {/* Previous button */}
      {currentPage > 1 ? (
        <ProgressLink
          href={buildHref(currentPage - 1)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          이전
        </ProgressLink>
      ) : (
        <button
          disabled
          className="cursor-not-allowed rounded border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400"
        >
          이전
        </button>
      )}

      {/* Page numbers */}
      <div className="flex gap-1">
        {rangeStart > 1 && (
          <>
            <ProgressLink
              href={buildHref(1)}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              1
            </ProgressLink>
            {rangeStart > 2 && (
              <span className="px-2 py-2 text-sm text-gray-600">...</span>
            )}
          </>
        )}

        {pageNumbers.map((page) => (
          <ProgressLink
            key={page}
            href={buildHref(page)}
            className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
              page === currentPage
                ? "bg-blue-500 text-white"
                : "border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {page}
          </ProgressLink>
        ))}

        {rangeEnd < totalPages && (
          <>
            {rangeEnd < totalPages - 1 && (
              <span className="px-2 py-2 text-sm text-gray-600">...</span>
            )}
            <ProgressLink
              href={buildHref(totalPages)}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {totalPages}
            </ProgressLink>
          </>
        )}
      </div>

      {/* Next button */}
      {currentPage < totalPages ? (
        <ProgressLink
          href={buildHref(currentPage + 1)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          다음
        </ProgressLink>
      ) : (
        <button
          disabled
          className="cursor-not-allowed rounded border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400"
        >
          다음
        </button>
      )}
    </nav>
  );
}
