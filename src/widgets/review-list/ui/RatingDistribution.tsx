import type { RatingDistribution as Dist } from "@/entities/review";

type Props = {
  distribution: Dist;
  total: number;
};

// PDP 별점 분포 막대. 5→1 역순. total=0 이면 ReviewStatsBar 가 "후기 없음" 을
// 이미 처리하므로 렌더 생략. props 만 받는 stateless RSC.
export function RatingDistribution({ distribution, total }: Props) {
  if (total === 0) return null;

  const order = [5, 4, 3, 2, 1] as const;
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white px-4 py-3">
      {order.map((star) => {
        const count = distribution[star];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-gray-500">{star}점</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-gray-400">
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
