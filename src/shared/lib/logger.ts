/**
 * @deprecated 이 파일은 하위 호환성 shim이다.
 * 신규 코드는 `@/shared/lib/observability`에서 직접 import할 것.
 * 기존 호출처(`src/features/auth/server/auth.ts` 등)는 무수정으로 동작한다.
 */
export { logger } from "./observability";
