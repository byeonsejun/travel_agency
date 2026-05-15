/**
 * context.ts — AsyncLocalStorage 기반 요청 컨텍스트 저장소.
 *
 * ⚠️ Node runtime 전용. middleware(Edge runtime)에서 이 파일을 import 금지.
 *    Edge에서 LogContext 타입만 필요하다면 `./types`를 직접 import할 것.
 *
 * 설계 원칙:
 *  - `runWithContext`로 진입한 async 체인 전반에서 LogContext가 자동 전파됨
 *  - `getContext()`는 ALS 밖이어도 에러를 던지지 않고 undefined를 반환 (fail-safe)
 *  - `setContext(partial)`은 현재 store에 머지. ALS 바깥이면 no-op.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { LogContext } from "./types";

const storage = new AsyncLocalStorage<LogContext>();

/**
 * 주어진 컨텍스트로 async 실행 범위를 열고, fn을 실행한다.
 * fn 내부 어디서든(중첩 Promise, setTimeout, 이벤트 핸들러 포함) `getContext()`로 접근 가능.
 */
export function runWithContext<T>(ctx: LogContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * 현재 async 실행 범위의 컨텍스트를 반환한다.
 * ALS 바깥이거나 아직 runWithContext가 호출되지 않았으면 `undefined`를 반환 (에러 없음).
 */
export function getContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * 현재 컨텍스트에 partial 필드를 머지한다.
 * ALS 바깥에서 호출하면 no-op (에러 없음).
 *
 * 주의: 병렬 runWithContext 분기가 동일 부모 store를 공유하는 경우 상호 영향이 발생할 수 있다.
 * 각 분기를 독립적으로 운영하려면 별도 runWithContext를 사용할 것.
 */
export function setContext(partial: Partial<LogContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, partial);
}
