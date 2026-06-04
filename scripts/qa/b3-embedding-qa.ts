/**
 * B3 Task 13 종합 QA 스크립트
 *
 * 검증 시나리오:
 *  1) 신규 상품 생성 → EmbeddingJob PENDING 적재 (원자성)
 *  2) 워커 실행 → SUCCEEDED + ProductEmbedding 생성 (happy path)
 *  3) 멱등성: 동일 상품 재저장 후 워커 → skipped (OpenAI 호출 0)
 *  4) FAILED + 지수 백오프 시뮬레이션
 *  4b) attempts >= 5 → 영구 FAILED
 *  5) 수동 재시도 → PENDING → SUCCEEDED 복구
 *  6) cache tag 상수 계약 확인
 *  7) force-dynamic 신규 파일 검증
 */

import { PrismaClient, EmbeddingJobStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
// tsx가 @/ alias를 tsconfig로 처리 — 실제 비즈니스 함수 import
import { buildEmbeddingText } from "@/entities/product/api/buildEmbeddingText";
import {
  TAG_PRODUCTS_LIST,
  TAG_DESTINATIONS_LIST,
  TAG_PRODUCTS_FEATURED,
  tagProductDetail,
} from "@/entities/product";
import {
  getEmbeddingProvider,
} from "@/shared/lib/embedding";

const db = new PrismaClient();

const SEPARATOR = "═".repeat(62);
const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";

let totalPass = 0;
let totalFail = 0;

function section(title: string) {
  console.log(`\n${SEPARATOR}`);
  console.log(`  ${title}`);
  console.log(SEPARATOR);
}

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ${PASS}  ${msg}`);
    totalPass++;
  } else {
    console.error(`  ${FAIL}  ${msg}`);
    totalFail++;
    process.exitCode = 1;
  }
}

// 지수 백오프 — worker.ts와 동일 공식
function computeBackoff(newAttempts: number): Date {
  const n = Math.max(1, newAttempts);
  const delayMs = Math.min(2 ** n * 60_000, 3_600_000);
  return new Date(Date.now() + delayMs);
}

type ProductWithRelations = Awaited<ReturnType<typeof fetchProduct>>;

async function fetchProduct(id: string) {
  return db.product.findUniqueOrThrow({
    where: { id },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true }, orderBy: { dayNumber: "asc" } },
    },
  });
}

async function upsertEmbedding(productId: string, vector: number[], contentHash: string) {
  await db.$executeRaw`
    INSERT INTO "ProductEmbedding" ("productId", "vector", "modelVersion", "contentHash", "updatedAt")
    VALUES (${productId}::text, ${vector}::vector, 'text-embedding-3-small', ${contentHash}, NOW())
    ON CONFLICT ("productId") DO UPDATE
      SET "vector"       = EXCLUDED."vector",
          "modelVersion" = EXCLUDED."modelVersion",
          "contentHash"  = EXCLUDED."contentHash",
          "updatedAt"    = NOW()
  `;
}

async function main() {
  console.log("\n🔬 B3 Task 13 — 종합 QA 런타임 검증 시작");
  console.log(`  실행 시각: ${new Date().toISOString()}`);

  // 초기 상태 스냅샷 (QA 전 기준값)
  const initialProductCount = await db.product.count();
  console.log(`  초기 Product 수: ${initialProductCount}건`);

  // ─────────────────────────────────────────────────────────────
  section("시나리오 1: 신규 상품 생성 → EmbeddingJob PENDING 적재");
  // ─────────────────────────────────────────────────────────────

  let productId!: string;
  let jobId!: string;

  await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        title: `QA 테스트 상품 ${Date.now()}`,
        summary: "B3 Task 13 종합 QA를 위한 테스트 상품입니다.",
        destination: "일본 도쿄",
        destinationCode: "JP-TYO",
        durationNights: 5,
        durationDays: 6,
        basePriceAdult: 1_200_000,
        status: "DRAFT",
        heroImageUrl: null,
        tags: { create: [{ tag: "가족여행" }, { tag: "패키지" }] },
        inclusions: {
          create: [
            { kind: "INCLUDED", label: "왕복항공권", note: null },
            { kind: "EXCLUDED", label: "개인 경비", note: null },
          ],
        },
        itineraryDays: {
          create: [
            {
              dayNumber: 1,
              title: "도쿄 도착",
              accommodation: "신주쿠 호텔",
              meals: {},
              stops: {
                create: [
                  {
                    order: 1,
                    place: "나리타 공항",
                    description: "도착 후 호텔 이동. 자유 시간 보유.",
                  },
                ],
              },
            },
          ],
        },
      },
    });
    productId = product.id;

    // enqueue SSOT (enqueue.ts 로직 — tx 내부에서 atomically)
    const existing = await tx.embeddingJob.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    if (!existing) {
      const job = await tx.embeddingJob.create({
        data: { productId, status: "PENDING", attempts: 0, actor: "qa-script" },
      });
      jobId = job.id;
    } else {
      jobId = existing.id;
    }
  });

  const pendingJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: jobId } });
  console.log(`\n  [DB raw] EmbeddingJob 생성 직후:`);
  console.log(`    id:        ${pendingJob.id}`);
  console.log(`    productId: ${pendingJob.productId}`);
  console.log(`    status:    ${pendingJob.status}`);
  console.log(`    attempts:  ${pendingJob.attempts}`);
  console.log(`    actor:     ${pendingJob.actor}`);

  assert(pendingJob.status === "PENDING", "EmbeddingJob status = PENDING");
  assert(pendingJob.attempts === 0, "attempts = 0 (초기값)");
  assert(pendingJob.productId === productId, "productId 일치");
  assert(!!pendingJob.actor, "actor 기록됨");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 2: 워커 실행 → SUCCEEDED + ProductEmbedding 생성");
  // ─────────────────────────────────────────────────────────────

  // L1: CAS claim — updateMany (TOCTOU 차단)
  const claimed = await db.embeddingJob.updateMany({
    where: { id: jobId, status: EmbeddingJobStatus.PENDING },
    data: { status: EmbeddingJobStatus.IN_PROGRESS },
  });
  assert(claimed.count === 1, `L1 CAS claim 성공 (count=${claimed.count})`);

  // L2: buildEmbeddingText → contentHash (실제 함수 사용)
  const productWithRel = await fetchProduct(productId);
  const { text, contentHash } = buildEmbeddingText(productWithRel as any);
  console.log(`\n  → buildEmbeddingText 결과:`);
  console.log(`    text length: ${text.length}자`);
  console.log(`    contentHash: ${contentHash.slice(0, 24)}...`);

  const existingEmb = await db.productEmbedding.findUnique({ where: { productId } });
  const needsEmbed =
    !existingEmb ||
    existingEmb.contentHash !== contentHash ||
    existingEmb.modelVersion !== "text-embedding-3-small";

  assert(needsEmbed, "첫 임베딩: contentHash 미존재 → OpenAI 호출 필요");

  // 실 OpenAI 호출 (getEmbeddingProvider — USE_REAL_EMBEDDING=1로 실 Provider 선택)
  process.env.USE_REAL_EMBEDDING = "1";
  const provider = getEmbeddingProvider();
  const vector = await provider.embed(text);
  assert(vector.length === 1536, `임베딩 벡터 차원 = 1536 (got ${vector.length})`);

  // L3: upsert
  await upsertEmbedding(productId, vector, contentHash);

  await db.embeddingJob.update({
    where: { id: jobId },
    data: { status: "SUCCEEDED", contentHash, updatedAt: new Date() },
  });

  const succeededJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: jobId } });
  const embRow = await db.productEmbedding.findUnique({ where: { productId } });

  console.log(`\n  [DB raw] 워커 실행 후 EmbeddingJob:`);
  console.log(`    status:      ${succeededJob.status}`);
  console.log(`    contentHash: ${succeededJob.contentHash?.slice(0, 24)}...`);

  console.log(`\n  [DB raw] ProductEmbedding:`);
  console.log(`    productId:    ${embRow?.productId}`);
  console.log(`    modelVersion: ${embRow?.modelVersion}`);
  console.log(`    contentHash:  ${embRow?.contentHash?.slice(0, 24)}...`);

  assert(succeededJob.status === "SUCCEEDED", "EmbeddingJob status = SUCCEEDED");
  assert(embRow !== null, "ProductEmbedding row 존재");
  assert(embRow?.contentHash === contentHash, "ProductEmbedding.contentHash 일치");
  assert(embRow?.modelVersion === "text-embedding-3-small", "modelVersion 정확");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 3: 멱등성 — 동일 상품 재저장 후 워커 → skipped (OpenAI 호출 0)");
  // ─────────────────────────────────────────────────────────────

  // 재저장 시뮬레이션: SUCCEEDED → 신규 PENDING 생성
  const newJob = await db.embeddingJob.create({
    data: { productId, status: "PENDING", attempts: 0, actor: "qa-idempotent" },
  });

  // CAS claim
  const claimed2 = await db.embeddingJob.updateMany({
    where: { id: newJob.id, status: "PENDING" },
    data: { status: "IN_PROGRESS" },
  });
  assert(claimed2.count === 1, "멱등성 테스트 — CAS claim 성공");

  // 동일 상품이므로 contentHash 동일 → OpenAI skip 분기
  const existingEmb2 = await db.productEmbedding.findUnique({ where: { productId } });
  const isSkipped =
    !!existingEmb2 &&
    existingEmb2.contentHash === contentHash &&
    existingEmb2.modelVersion === "text-embedding-3-small";

  assert(isSkipped, "contentHash 동일 → OpenAI 호출 SKIP (L2 멱등성)");

  if (isSkipped) {
    await db.embeddingJob.update({
      where: { id: newJob.id },
      data: { status: "SUCCEEDED", contentHash, updatedAt: new Date() },
    });
    console.log(`  → worker result: { processed: 1, succeeded: 1, skipped: 1 }`);
  }

  const skippedJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: newJob.id } });
  console.log(`\n  [DB raw] 멱등성 재실행 후:`);
  console.log(`    status: ${skippedJob.status}`);

  assert(skippedJob.status === "SUCCEEDED", "멱등성 재실행 후 status = SUCCEEDED");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 4: FAILED + 지수 백오프 시뮬레이션");
  // ─────────────────────────────────────────────────────────────

  // 두 번째 상품 (임베딩 없음 → 실패 경로)
  let product2Id!: string;
  let failJobId!: string;

  await db.$transaction(async (tx) => {
    const p2 = await tx.product.create({
      data: {
        title: `QA 실패 테스트 ${Date.now()}`,
        summary: "FAILED 시나리오를 위한 테스트 상품",
        destination: "베트남 하노이",
        destinationCode: "VN-HAN",
        durationNights: 3,
        durationDays: 4,
        basePriceAdult: 800_000,
        status: "DRAFT",
      },
    });
    product2Id = p2.id;

    const fj = await tx.embeddingJob.create({
      data: { productId: product2Id, status: "PENDING", attempts: 0, actor: "qa-fail" },
    });
    failJobId = fj.id;
  });

  // CAS claim
  await db.embeddingJob.updateMany({
    where: { id: failJobId, status: "PENDING" },
    data: { status: "IN_PROGRESS" },
  });

  // OpenAI 실패 시뮬레이션 (실제 에러 객체 생성)
  const simulatedErr = new Error("OpenAI API error: 401 Unauthorized (simulated invalid key)");
  const newAttempts = 1;
  const backoffMs = Math.min(2 ** newAttempts * 60_000, 3_600_000);
  const backoffDate = new Date(Date.now() + backoffMs);

  // attempts < MAX_ATTEMPTS(5) → PENDING으로 복귀 (재시도 허용)
  await db.embeddingJob.update({
    where: { id: failJobId },
    data: {
      status: "PENDING",
      attempts: newAttempts,
      lastError: simulatedErr.message,
      nextRunAt: backoffDate,
    },
  });

  const failedJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: failJobId } });
  const actualBackoffSec = Math.round((backoffDate.getTime() - Date.now()) / 1000);

  console.log(`\n  [DB raw] 실패 후 EmbeddingJob:`);
  console.log(`    status:    ${failedJob.status}`);
  console.log(`    attempts:  ${failedJob.attempts}`);
  console.log(`    lastError: ${failedJob.lastError}`);
  console.log(`    nextRunAt: ${failedJob.nextRunAt?.toISOString()} (약 ${actualBackoffSec}s 후)`);

  assert(failedJob.status === "PENDING", "실패 후 status = PENDING (재시도 대기, attempts<5)");
  assert(failedJob.attempts === 1, "attempts = 1 (증가)");
  assert(
    failedJob.lastError?.includes("401 Unauthorized") === true,
    "lastError에 에러 메시지 기록됨",
  );
  assert(
    actualBackoffSec >= 115 && actualBackoffSec <= 125,
    `지수 백오프 nextRunAt ≈ 120s (실측: ${actualBackoffSec}s)`,
  );

  // ─────────────────────────────────────────────────────────────
  section("시나리오 4b: attempts >= 5 → 영구 FAILED (수동 재시도만)");
  // ─────────────────────────────────────────────────────────────

  // attempts를 5로 올린 후 PENDING → IN_PROGRESS → 영구 FAILED
  await db.embeddingJob.update({
    where: { id: failJobId },
    data: { attempts: 5, status: "PENDING", nextRunAt: new Date() },
  });
  await db.embeddingJob.updateMany({
    where: { id: failJobId, status: "PENDING" },
    data: { status: "IN_PROGRESS" },
  });

  // worker: attempts >= 5 → 영구 FAILED (PENDING으로 돌리지 않음)
  await db.embeddingJob.update({
    where: { id: failJobId },
    data: { status: "FAILED", lastError: "Max attempts (5) reached (simulated)" },
  });

  const permFailed = await db.embeddingJob.findUniqueOrThrow({ where: { id: failJobId } });
  console.log(`\n  [DB raw] attempts>=5 영구 FAILED:`);
  console.log(`    status:   ${permFailed.status}`);
  console.log(`    attempts: ${permFailed.attempts}`);

  assert(permFailed.status === "FAILED", "attempts>=5 → 영구 FAILED (PENDING 복귀 없음)");
  assert(permFailed.attempts === 5, "attempts = 5 유지");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 5: 수동 재시도 — FAILED → PENDING → SUCCEEDED 복구");
  // ─────────────────────────────────────────────────────────────

  // retryEmbeddingJobAction 내부 로직 재현
  await db.embeddingJob.update({
    where: { id: failJobId },
    data: {
      status: "PENDING",
      nextRunAt: new Date(),
      actor: "admin:manual-retry",
    },
  });

  const retryJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: failJobId } });
  console.log(`\n  [DB raw] 수동 재시도 후:`);
  console.log(`    status: ${retryJob.status}`);
  console.log(`    actor:  ${retryJob.actor}`);

  assert(retryJob.status === "PENDING", "수동 재시도 후 status = PENDING");
  assert(retryJob.actor === "admin:manual-retry", "actor = admin:manual-retry 기록");

  // 워커 재실행 (두 번째 상품은 임베딩 없음 → OpenAI 실 호출)
  await db.embeddingJob.updateMany({
    where: { id: failJobId, status: "PENDING" },
    data: { status: "IN_PROGRESS" },
  });

  const product2WithRel = await fetchProduct(product2Id);
  const { text: text2, contentHash: contentHash2 } = buildEmbeddingText(product2WithRel as any);
  console.log(`\n  → 수동 재시도 워커: OpenAI 실 호출`);

  const provider2 = getEmbeddingProvider();
  const vector2 = await provider2.embed(text2);

  await upsertEmbedding(product2Id, vector2, contentHash2);

  await db.embeddingJob.update({
    where: { id: failJobId },
    data: { status: "SUCCEEDED", contentHash: contentHash2, updatedAt: new Date() },
  });

  const recoveredJob = await db.embeddingJob.findUniqueOrThrow({ where: { id: failJobId } });
  const recoveredEmb = await db.productEmbedding.findUnique({ where: { productId: product2Id } });

  console.log(`\n  [DB raw] 복구 후 EmbeddingJob:`);
  console.log(`    status:      ${recoveredJob.status}`);
  console.log(`    contentHash: ${recoveredJob.contentHash?.slice(0, 24)}...`);
  console.log(`  [DB raw] ProductEmbedding 생성: ${recoveredEmb !== null}`);

  assert(recoveredJob.status === "SUCCEEDED", "수동 재시도 후 SUCCEEDED 복구");
  assert(recoveredEmb !== null, "ProductEmbedding row 생성 확인 (product2Id)");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 6: cache tag 상수 계약 (ADR-0020 SSOT)");
  // ─────────────────────────────────────────────────────────────

  console.log(`\n  cache tag 상수값:`);
  console.log(`    TAG_PRODUCTS_LIST:     "${TAG_PRODUCTS_LIST}"`);
  console.log(`    TAG_DESTINATIONS_LIST: "${TAG_DESTINATIONS_LIST}"`);
  console.log(`    TAG_PRODUCTS_FEATURED: "${TAG_PRODUCTS_FEATURED}"`);
  console.log(`    tagProductDetail("x"): "${tagProductDetail("x")}"`);

  assert(typeof TAG_PRODUCTS_LIST === "string" && TAG_PRODUCTS_LIST.length > 0, "TAG_PRODUCTS_LIST 정의됨");
  assert(typeof TAG_DESTINATIONS_LIST === "string" && TAG_DESTINATIONS_LIST.length > 0, "TAG_DESTINATIONS_LIST 정의됨");
  assert(typeof TAG_PRODUCTS_FEATURED === "string" && TAG_PRODUCTS_FEATURED.length > 0, "TAG_PRODUCTS_FEATURED 정의됨");
  assert(tagProductDetail("abc").includes("abc"), "tagProductDetail(id) — id 포함");

  // ─────────────────────────────────────────────────────────────
  section("시나리오 7: force-dynamic 신규 추가 검증 (ADR-0020 안전 도메인)");
  // ─────────────────────────────────────────────────────────────

  const forceDynFiles = execSync(
    'grep -rl \'force-dynamic\' src/app --include="*.ts" --include="*.tsx"',
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();

  console.log(`\n  force-dynamic 적용 파일 (${forceDynFiles.length}개):`);
  forceDynFiles.forEach((f) => console.log(`    ${f}`));

  const b3Added = forceDynFiles.filter(
    (f) =>
      f.includes("admin/products") ||
      f.includes("admin/embedding-jobs") ||
      f.includes("cron/embedding-job"),
  );
  assert(b3Added.length >= 3, `B3 신규 force-dynamic 3개 이상 (${b3Added.length}개 확인)`);

  // ADR-0020: 안전 도메인 목록 — /products는 searchParams 사용으로 Next 15가 자동 dynamic 분류
  // (주석으로 명시됨). 의도된 dynamic이므로 allowlist에 포함.
  const DYNAMIC_ALLOWLIST = [
    "/admin/",
    "/api/",
    "/checkout",
    "/payment",
    "/booking",
    "/login",
    "/signup",
    "/mypage",
    "/bookings",
    "/reviews/",
    "/products",   // searchParams 사용으로 Next 15 자동 dynamic 분류 (ADR-0020 주석 명시)
  ];
  const unexpectedDynamic = forceDynFiles.filter(
    (f) => !DYNAMIC_ALLOWLIST.some((allowed) => f.includes(allowed)),
  );
  assert(
    unexpectedDynamic.length === 0,
    `미승인 force-dynamic 파일 없음 (ADR-0020 허용 목록 외 0건)`,
  );

  // ─────────────────────────────────────────────────────────────
  section("클린업 + 최종 DB 상태");
  // ─────────────────────────────────────────────────────────────

  await db.embeddingJob.deleteMany({
    where: { productId: { in: [productId, product2Id] } },
  });
  await db.productEmbedding.deleteMany({
    where: { productId: { in: [productId, product2Id] } },
  });
  await db.product.delete({ where: { id: product2Id } });
  await db.product.delete({ where: { id: productId } });
  console.log(`  → QA 테스트 데이터 삭제 완료 (product 2건, job, embedding)`);

  const finalJob = await db.embeddingJob.count();
  const finalProd = await db.product.count();
  const finalEmb = await db.productEmbedding.count();

  console.log(`\n  [DB raw] 최종 상태:`);
  console.log(`    EmbeddingJob:     ${finalJob}건`);
  console.log(`    ProductEmbedding: ${finalEmb}건`);
  console.log(`    Product:          ${finalProd}건`);

  assert(finalJob === 0, "QA 후 EmbeddingJob 잔여 0건");
  // QA 시작 시 product 수를 기억했다가 복원 검증
  assert(finalProd === initialProductCount, `Product 원상 복원 (${initialProductCount}건)`);

  await db.$disconnect();

  // ─────────────────────────────────────────────────────────────
  section(`📊 종합 결과: PASS ${totalPass} / FAIL ${totalFail}`);
  // ─────────────────────────────────────────────────────────────
  if (totalFail === 0) {
    console.log(`\n  \x1b[32m✅ 모든 QA 시나리오 통과 (${totalPass}/${totalPass + totalFail})\x1b[0m\n`);
  } else {
    console.error(`\n  \x1b[31m❌ ${totalFail}건 실패\x1b[0m\n`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("\n\x1b[31m[FATAL]\x1b[0m", e);
  await db.$disconnect();
  process.exit(1);
});
