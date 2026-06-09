import { ProductImage } from "@/entities/product";
import type { ProductDetail } from "@/entities/product";
import { CompareRemoveButton } from "@/features/product-compare";

type Props = {
  products: ProductDetail[];
};

type Row = {
  key: string;
  label: string;
  render: (p: ProductDetail) => React.ReactNode;
};

const formatPrice = (n: number) => `${n.toLocaleString()}원`;

const ROWS: Row[] = [
  {
    key: "destination",
    label: "목적지",
    render: (p) => p.destination,
  },
  {
    key: "duration",
    label: "기간",
    render: (p) => `${p.durationNights}박 ${p.durationDays}일`,
  },
  {
    key: "basePrice",
    label: "시작가 (성인)",
    render: (p) => <span className="font-extrabold text-foreground">{formatPrice(p.basePriceAdult)}</span>,
  },
  {
    key: "tags",
    label: "태그",
    render: (p) =>
      p.tags.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <span
              key={t.id}
              className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
            >
              #{t.tag}
            </span>
          ))}
        </div>
      ),
  },
  {
    key: "included",
    label: "포함 사항",
    render: (p) => {
      const inc = p.inclusions.filter((i) => i.kind === "INCLUDED");
      return inc.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
          {inc.map((i) => (
            <li key={i.id}>{i.label}</li>
          ))}
        </ul>
      );
    },
  },
  {
    key: "excluded",
    label: "불포함 사항",
    render: (p) => {
      const exc = p.inclusions.filter((i) => i.kind === "EXCLUDED");
      return exc.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
          {exc.map((i) => (
            <li key={i.id}>{i.label}</li>
          ))}
        </ul>
      );
    },
  },
  {
    key: "itinerary",
    label: "일정 요약",
    render: (p) =>
      p.itineraryDays.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <ol className="space-y-1 text-sm text-foreground">
          {p.itineraryDays
            .slice()
            .sort((a, b) => a.dayNumber - b.dayNumber)
            .map((d) => (
              <li key={d.id}>
                <span className="font-semibold">Day {d.dayNumber}</span>{" "}
                {d.title}
              </li>
            ))}
        </ol>
      ),
  },
];

function ProductHeaderCell({ product }: { product: ProductDetail }) {
  return (
    <div className="space-y-2">
      <div className="relative h-32 w-full overflow-hidden rounded-lg bg-secondary">
        <ProductImage
          src={product.heroImageUrl}
          alt={product.title}
          className="h-full w-full"
        />
        <div className="absolute right-1 top-1">
          <CompareRemoveButton productId={product.id} />
        </div>
      </div>
      <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
        {product.title}
      </h3>
    </div>
  );
}

export function ProductCompareTable({ products }: Props) {
  // 데스크탑 표 + 모바일 카드 스택을 같은 데이터로 두 번 렌더.
  return (
    <>
      {/* 데스크탑: 가로 표 */}
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className="w-32 border-b border-border p-3 text-left text-xs font-semibold text-muted-foreground">
                항목
              </th>
              {products.map((p) => (
                <th
                  key={p.id}
                  className="border-b border-border p-3 text-left align-top"
                >
                  <ProductHeaderCell product={p} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="align-top">
                <th className="border-b border-border bg-secondary p-3 text-left text-xs font-semibold text-muted-foreground">
                  {row.label}
                </th>
                {products.map((p) => (
                  <td
                    key={p.id}
                    className="border-b border-border p-3 text-sm text-foreground"
                  >
                    {row.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일: 상품별 세로 카드 스택 */}
      <div className="space-y-6 md:hidden">
        {products.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <ProductHeaderCell product={p} />
            <dl className="mt-4 space-y-3">
              {ROWS.map((row) => (
                <div key={row.key}>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">{row.render(p)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
