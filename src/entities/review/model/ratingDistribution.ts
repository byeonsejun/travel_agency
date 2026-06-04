// Prisma groupBy({ by:['rating'], _count:{_all:true} }) 의 row 모양.
export type RatingGroupRow = {
  rating: number;
  _count: { _all: number };
};

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

// DB 는 존재하는 별점만 반환 → UI 막대가 1~5 전부를 그리도록 누락 키를 0 으로 채운다.
export function normalizeRatingDistribution(
  rows: RatingGroupRow[],
): RatingDistribution {
  const base: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    if (row.rating >= 1 && row.rating <= 5) {
      base[row.rating as 1 | 2 | 3 | 4 | 5] = row._count._all;
    }
  }
  return base;
}
