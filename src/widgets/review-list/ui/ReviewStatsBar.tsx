// PDP 상단 평균 별점·총 개수 바. RSC — props 만 받아 stateless 렌더.
// 0건 케이스도 안전하게 처리(avg=0, count=0 입력 시 안내 문구로 분기).

type Props = {
  avg: number;
  count: number;
};

function Stars({ value }: { value: number }) {
  // value: 0~5 실수. 정수 단위 fill — 반쪽 별 표시는 별도 PR.
  const rounded = Math.round(value);
  return (
    <div className="flex items-center gap-0.5" aria-label={`평균 ${value.toFixed(1)}점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-5 w-5 ${n <= rounded ? "fill-amber-400" : "fill-gray-200"}`}
        >
          <path d="M9.05.927C9.349.012 10.651.012 10.95.927l1.713 5.272a1 1 0 00.95.69h5.546c.962 0 1.362 1.232.586 1.798l-4.488 3.26a1 1 0 00-.364 1.118l1.713 5.272c.299.916-.756 1.677-1.539 1.118l-4.488-3.26a1 1 0 00-1.175 0l-4.488 3.26c-.783.56-1.838-.202-1.539-1.118l1.713-5.272a1 1 0 00-.364-1.118L2.255 8.687c-.776-.566-.377-1.798.586-1.798h5.547a1 1 0 00.949-.69L9.05.927z" />
        </svg>
      ))}
    </div>
  );
}

export function ReviewStatsBar({ avg, count }: Props) {
  if (count === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        아직 작성된 후기가 없습니다.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
      <Stars value={avg} />
      <p className="text-sm">
        <span className="text-lg font-bold text-gray-900">{avg.toFixed(1)}</span>
        <span className="text-gray-500"> / 5</span>
        <span className="ml-2 text-gray-400">·</span>
        <span className="ml-2 text-gray-500">총 {count}개 후기</span>
      </p>
    </div>
  );
}
