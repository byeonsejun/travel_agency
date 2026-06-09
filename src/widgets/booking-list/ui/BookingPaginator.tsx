import Link from "next/link";

type Props = {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
};

export function BookingPaginator({ page, total, pageSize, basePath }: Props) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const linkClass = (active: boolean) =>
    `inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent"
    }`;

  // 표시할 페이지 번호 범위: 현재 페이지 중심 ±2
  const range: number[] = [];
  for (
    let i = Math.max(1, page - 2);
    i <= Math.min(totalPages, page + 2);
    i++
  ) {
    range.push(i);
  }

  return (
    <nav
      aria-label="예약 내역 페이지 네비게이션"
      className="mt-6 flex items-center justify-center gap-1"
    >
      <Link
        href={hasPrev ? `${basePath}?page=${page - 1}` : "#"}
        aria-disabled={!hasPrev}
        tabIndex={hasPrev ? undefined : -1}
        className={`inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors ${
          hasPrev
            ? "text-muted-foreground hover:bg-accent"
            : "pointer-events-none text-muted-foreground/50"
        }`}
      >
        이전
      </Link>

      {range[0] > 1 && (
        <>
          <Link href={`${basePath}?page=1`} className={linkClass(false)}>
            1
          </Link>
          {range[0] > 2 && (
            <span className="px-1 text-muted-foreground">…</span>
          )}
        </>
      )}

      {range.map((p) => (
        <Link
          key={p}
          href={`${basePath}?page=${p}`}
          aria-current={p === page ? "page" : undefined}
          className={linkClass(p === page)}
        >
          {p}
        </Link>
      ))}

      {range[range.length - 1] < totalPages && (
        <>
          {range[range.length - 1] < totalPages - 1 && (
            <span className="px-1 text-muted-foreground">…</span>
          )}
          <Link
            href={`${basePath}?page=${totalPages}`}
            className={linkClass(false)}
          >
            {totalPages}
          </Link>
        </>
      )}

      <Link
        href={hasNext ? `${basePath}?page=${page + 1}` : "#"}
        aria-disabled={!hasNext}
        tabIndex={hasNext ? undefined : -1}
        className={`inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors ${
          hasNext
            ? "text-muted-foreground hover:bg-accent"
            : "pointer-events-none text-muted-foreground/50"
        }`}
      >
        다음
      </Link>
    </nav>
  );
}
