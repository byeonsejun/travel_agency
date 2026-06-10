/**
 * ndcg.ts — nDCG@k 순수 수학 (search-eval 하네스 전용).
 *
 * DCG@k  = Σ_{i=1..k} (2^rel_i − 1) / log2(i + 1)   (rel_i = 랭크 i 아이템 라벨)
 * IDCG@k = 전체 라벨 집합을 내림차순 정렬한 이상 순서의 DCG@k (top-k 절단)
 * nDCG@k = DCG@k / IDCG@k   (IDCG=0 이면 0)
 *
 * 표준 IR 정의: IDCG는 *전체* 판정 집합을 이상 정렬한 뒤 k까지 본다.
 * 그래야 고관련 항목이 k 밖으로 묻힌 랭킹이 페널티를 받는다(이상 순서라면
 * 그 항목을 상위로 끌어올렸을 것이므로). top-k만으로 IDCG를 구하면 이 페널티가
 * 사라져, sweep이 "우수 결과 매장" 오류를 감지하지 못한다 — 사용 금지.
 *
 * rankedRelevances: 점수 내림차순으로 정렬된 후보들의 관련성 라벨(0~3).
 */
export function dcgAtK(relevances: number[], k: number): number {
  let dcg = 0;
  const limit = Math.min(k, relevances.length);
  for (let i = 0; i < limit; i++) {
    // i는 0-index → 랭크(i+1) → 분모 log2((i+1)+1) = log2(i+2)
    dcg += (2 ** relevances[i] - 1) / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(rankedRelevances: number[], k: number): number {
  const dcg = dcgAtK(rankedRelevances, k);
  // IDCG: 전체 집합을 이상 정렬(복사본 — 입력 불변) 후 동일 k로 평가.
  const ideal = [...rankedRelevances].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}
