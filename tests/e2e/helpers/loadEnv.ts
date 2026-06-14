/**
 * E2E 전용 .env 로더 (read-only).
 *
 * Playwright 테스트 러너 프로세스에는 Next.js처럼 `.env`가 자동 로드되지 않는다.
 * 세션 쿠키 서명(`encode`)에 필요한 `AUTH_SECRET`을 얻기 위해 `.env`를 *읽기만* 한다.
 * 사용자 `.env`는 절대 수정하지 않으며, 이미 `process.env`에 존재하는 키는
 * 덮어쓰지 않는다(= Playwright `webServer.env`로 주입한 Mock 값이 우선).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

/** `.env`를 파싱해 누락된 키만 `process.env`에 채운다. 다중 호출 안전(idempotent). */
export function loadEnvFromDotenv(): void {
  if (loaded) return;
  loaded = true;

  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch {
    // .env 부재 시 조용히 통과 — 호출부에서 AUTH_SECRET 누락을 명시적으로 검증한다.
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue; // 기존 값(Mock 주입 포함) 보존

    let value = trimmed.slice(eq + 1).trim();
    // 양끝 따옴표 제거 (KEY="v" / KEY='v')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
