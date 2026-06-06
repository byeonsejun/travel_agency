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
    if (isEncrypted(row.passportNo)) continue;    // 이미 암호화 → 스킵(멱등)
    result.push({ id: row.id, encrypted: encrypt(row.passportNo) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 백필 로직
// ---------------------------------------------------------------------------

async function backfillPassportProfiles(): Promise<void> {
  const rows = await db.passportProfile.findMany({
    select: { id: true, passportNo: true },
  });

  const plan = planEncryption(rows);
  let encrypted = 0;
  const skipped = rows.length - plan.length;

  for (const { id, encrypted: encValue } of plan) {
    await db.passportProfile.update({
      where: { id },
      data: { passportNo: encValue },
    });
    encrypted += 1;
  }

  console.log(`✓ PassportProfile: encrypted ${encrypted}, skipped ${skipped}`);
}

async function backfillTravelers(): Promise<void> {
  const rows = await db.traveler.findMany({
    where: { passportNo: { not: null } },
    select: { id: true, passportNo: true },
  });

  const plan = planEncryption(rows);
  let encrypted = 0;
  const skipped = rows.length - plan.length;

  for (const { id, encrypted: encValue } of plan) {
    await db.traveler.update({
      where: { id },
      data: { passportNo: encValue },
    });
    encrypted += 1;
  }

  console.log(`✓ Traveler: encrypted ${encrypted}, skipped ${skipped}`);
}

async function main(): Promise<void> {
  console.log("▶ encrypt-passports 백필 시작…");
  await backfillPassportProfiles();
  await backfillTravelers();
  console.log("✓ encrypt-passports 백필 완료.");
}

if (process.env.NODE_ENV !== "test") {
  main().catch(console.error).finally(() => db.$disconnect());
}
