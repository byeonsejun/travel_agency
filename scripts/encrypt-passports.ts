/**
 * encrypt-passports.ts — 여권번호(passportNo) PII 일회성 멱등 백필.
 *
 * 대상 테이블:
 *  1) PassportProfile.passportNo — 전체 조회, 평문인 row만 암호화
 *  2) Traveler.passportNo       — passportNo not-null 조회, 평문인 row만 암호화
 *
 * 멱등성:
 *  - `isEncrypted(value)` 가 true면 스킵 → 두 번 실행해도 이중 암호화 없음.
 *  - `encrypt(value)` 자체도 이미 enc:v1: 값이면 그대로 반환(이중 가드).
 *
 * 실행: npx tsx scripts/encrypt-passports.ts
 * (실행 전 .env 로드 필요: set -a; . ./.env; set +a)
 */

import { db } from "@/shared/lib/db";
import { encrypt, isEncrypted } from "@/shared/lib/crypto";

// ---------------------------------------------------------------------------
// 순수 헬퍼 — DB 없이 단위 테스트 가능
// ---------------------------------------------------------------------------

/**
 * 주어진 row 배열 중 암호화가 필요한(null이 아니고 아직 평문인) row에 대해
 * 암호화된 값을 계산해 반환한다.
 *
 * @param rows — passportNo를 포함한 row 배열 (Traveler / PassportProfile 공용)
 * @returns    — 암호화가 필요한 row만 { id, encrypted } 형태로 반환
 *              (null 및 이미 암호화된 row는 제외 — 멱등)
 */
export function planEncryption(
  rows: { id: string; passportNo: string | null }[]
): { id: string; encrypted: string }[] {
  const result: { id: string; encrypted: string }[] = [];
  for (const row of rows) {
    if (row.passportNo === null) continue;        // null → 건너뜀
    if (row.passportNo.trim() === "") continue;   // 빈 문자열(손상 row) → 평문 그대로 보존, 암호화 안 함
    if (isEncrypted(row.passportNo)) continue;    // 이미 암호화 → 스킵(멱등)
    result.push({ id: row.id, encrypted: encrypt(row.passportNo) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 백필 로직
// ---------------------------------------------------------------------------

type BackfillStats = { encrypted: number; skipped: number; errors: number };

/**
 * plan을 건별 update로 적용한다. 한 row 실패가 테이블 전체를 중단시키지 않도록
 * per-row try/catch로 격리하고 errors를 누적한다(멱등이므로 재실행 안전).
 */
async function applyPlan(
  label: string,
  total: number,
  plan: { id: string; encrypted: string }[],
  update: (id: string, encrypted: string) => Promise<unknown>
): Promise<BackfillStats> {
  let encrypted = 0;
  let errors = 0;
  for (const { id, encrypted: encValue } of plan) {
    try {
      await update(id, encValue);
      encrypted += 1;
    } catch (e) {
      errors += 1;
      console.warn(`✗ ${label} ${id} update 실패 (재실행으로 복구 가능): ${e}`);
    }
  }
  const skipped = total - plan.length;
  console.log(`✓ ${label}: encrypted ${encrypted}, skipped ${skipped}, errors ${errors}`);
  return { encrypted, skipped, errors };
}

async function backfillPassportProfiles(): Promise<BackfillStats> {
  const rows = await db.passportProfile.findMany({
    select: { id: true, passportNo: true },
  });
  return applyPlan("PassportProfile", rows.length, planEncryption(rows), (id, passportNo) =>
    db.passportProfile.update({ where: { id }, data: { passportNo } })
  );
}

async function backfillTravelers(): Promise<BackfillStats> {
  const rows = await db.traveler.findMany({
    where: { passportNo: { not: null } },
    select: { id: true, passportNo: true },
  });
  return applyPlan("Traveler", rows.length, planEncryption(rows), (id, passportNo) =>
    db.traveler.update({ where: { id }, data: { passportNo } })
  );
}

async function main(): Promise<void> {
  console.log("▶ encrypt-passports 백필 시작…");
  // 한 테이블 실패가 다른 테이블을 막지 않도록 둘 다 실행한 뒤 종합 판정한다.
  const profiles = await backfillPassportProfiles();
  const travelers = await backfillTravelers();
  const totalErrors = profiles.errors + travelers.errors;
  if (totalErrors > 0) {
    // 멱등이므로 재실행 시 성공분은 skip되고 실패분만 재시도된다.
    throw new Error(`encrypt-passports: ${totalErrors}건 실패 — 스크립트를 재실행하세요.`);
  }
  console.log("✓ encrypt-passports 백필 완료.");
}

// Vitest는 NODE_ENV=test를 자동 설정한다. 테스트는 이 모듈을 import만 하고(순수 헬퍼
// 검증), 아래 가드 덕분에 import 시 DB에 접속하지 않는다. 테스트 실행 시 NODE_ENV를
// 임의로 덮어쓰지 말 것(덮어쓰면 import 단계에서 실 DB로 main()이 발동).
if (process.env.NODE_ENV !== "test") {
  main().catch(console.error).finally(() => db.$disconnect());
}
