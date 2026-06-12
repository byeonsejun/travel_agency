/**
 * BookingEvent.actor(`"admin:{id}"` | `"user:{id}"` | `"system:{src}"`)를
 * 고객 친화 라벨로 변환. 내부 ID를 고객 화면에 노출하지 않기 위한 표시 전용 순수 함수.
 */
export function formatEventActor(actor: string): string {
  if (actor.startsWith("admin:")) return "여행사(관리자)";
  if (actor.startsWith("user:")) return "고객";
  if (actor.startsWith("system:")) return "시스템";
  return actor;
}
