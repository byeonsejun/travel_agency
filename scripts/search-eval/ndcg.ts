/**
 * ndcg.ts — nDCG@k 순수 수학 (search-eval 하네스 전용).
 *
 * DCG@k  = Σ_{i=1..k} (2^rel_i − 1) / log2(i + 1)   (rel_i = 랭크 i 아이템 라벨)
 * IDCG@k = 동일 라벨 집합을 내림차순 정렬한 이상 DCG@k
 * nDCG@k = DCG@k / IDCG@k   (IDCG=0 이면 0)
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
  // IDCG: 평가 대상(상위 k개)의 라벨만 내림차순 정렬 — 꼬리(k 이후)는 평가 범위 외
  const topK = rankedRelevances.slice(0, k);
  const ideal = [...topK].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}
