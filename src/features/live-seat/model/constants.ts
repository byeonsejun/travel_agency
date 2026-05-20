// 폴링 주기 — 20초. 너무 짧으면 트래픽·DB 부담, 너무 길면 race window 길어짐.
// 일반 모객 상황에서 충분하고 flash sale에서도 클릭 직전 신선도를 확보.
export const POLL_INTERVAL_MS = 20_000;

// 절대값 임계값 — "🔥 마감 임박" 배지를 노출하는 잔여석 상한.
// 사용자의 의사결정 압박을 시각적으로 환기하되 panic-buying 유도는 회피.
export const LOW_STOCK_THRESHOLD = 5;
