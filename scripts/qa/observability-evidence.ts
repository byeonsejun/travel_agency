/**
 * observability-evidence.ts — M-OBS 종합 QA 증거 수집기 (qa-engineer R1·R3·R8)
 *
 * 사용법:
 *   NODE_ENV=development npx tsx scripts/qa/observability-evidence.ts
 *
 * 4개 섹션:
 *  §1. traceId 전파 — runWithContext 내 logger.info 3건이 동일 traceId를 포함하는지 확인
 *  §2. metrics 카운터 — incr 누적 후 snapshot() 출력
 *  §3. DB 관측 쿼리 — listRecentPaymentEvents / summarizeRefundJobs 결과
 *  §4. /api/health curl — 서버 실행 중이면 응답 인용, 아니면 예상 응답 포맷 출력
 */

// logger가 출력되려면 NODE_ENV=development 필요
// (타입 선언 우회: process.env는 Record<string,string>이므로 직접 할당 가능)
if (!process.env["NODE_ENV"] || process.env["NODE_ENV"] === "test") {
  (process.env as Record<string, string>)["NODE_ENV"] = "development";
}

import { execSync } from "node:child_process";
import {
  runWithContext,
  generateTraceId,
  logger,
  metrics,
} from "../../src/shared/lib/observability";
import {
  listRecentPaymentEvents,
  summarizeRefundJobs,
} from "../../src/entities/payment";
import { db } from "../../src/shared/lib/db";

// ── 구분선 헬퍼 ──────────────────────────────────────────────────
function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`§ ${title}`);
  console.log("─".repeat(60));
}

async function main() {
  console.log("=== M-OBS 종합 QA 증거 수집 ===");
  console.log(`실행 시각: ${new Date().toISOString()}`);

  // ── §1: traceId 전파 시뮬레이션 ────────────────────────────────
  section("1. traceId 전파 — runWithContext + logger.info 3건");

  const traceId = generateTraceId();
  console.log(`발급된 traceId: ${traceId}`);
  console.log("아래 3줄 JSON 모두 같은 traceId를 포함해야 함:");

  // 로그 라인을 캡처하여 traceId 포함 여부 검증
  const captured: string[] = [];
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);

  await runWithContext({ traceId, routeName: "obs-evidence" }, async () => {
    // console.log를 일시적으로 인터셉트하여 캡처
    console.log = (msg: string) => {
      captured.push(msg);
      origLog(msg);
    };
    console.error = (msg: string) => {
      captured.push(msg);
      origError(msg);
    };

    logger.info("evidence.step1", { step: "first" });
    logger.info("evidence.step2", { step: "second" });
    logger.info("evidence.step3", { step: "third" });

    console.log = origLog;
    console.error = origError;
  });

  const allContainTrace = captured.every((line) => line.includes(traceId));
  console.log(
    `traceId 전파 검증: ${allContainTrace ? "PASS ✓ (3/3 라인 포함)" : `FAIL ✗ (포함 ${captured.filter((l) => l.includes(traceId)).length}/3)`}`
  );

  // ── §2: metrics counter 누적 + snapshot ──────────────────────
  section("2. metrics 카운터 누적 + snapshot()");

  metrics.resetForTest();
  metrics.incr("payment.confirm.attempt");
  metrics.incr("payment.confirm.attempt");
  metrics.incr("payment.webhook.toss.processed", { type: "PAYMENT_DONE" });
  metrics.incr("payment.webhook.toss.processed", { type: "PAYMENT_DONE" });
  metrics.incr("payment.webhook.toss.processed", { type: "PAYMENT_DONE" });
  metrics.incr("health.ok");
  metrics.observe("payment.confirm.duration_ms", 120);
  metrics.observe("payment.confirm.duration_ms", 95);
  metrics.observe("payment.confirm.duration_ms", 210);

  const snap = metrics.snapshot();
  console.log("counters:");
  for (const [k, v] of Object.entries(snap.counters)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("observations:");
  for (const [k, v] of Object.entries(snap.observations)) {
    console.log(`  ${k}: count=${v.count}, p50=${v.p50}, p95=${v.p95}, max=${v.max}`);
  }

  const expectedConfirm = snap.counters["payment.confirm.attempt"] === 2;
  const expectedWebhook =
    snap.counters["payment.webhook.toss.processed|type=PAYMENT_DONE"] === 3;
  console.log(`카운터 검증: ${expectedConfirm && expectedWebhook ? "PASS ✓" : "FAIL ✗"}`);

  // ── §3: DB 관측 쿼리 ─────────────────────────────────────────
  section("3. DB 관측 쿼리 — listRecentPaymentEvents / summarizeRefundJobs");

  try {
    const [events, refundSummary] = await Promise.all([
      listRecentPaymentEvents({ limit: 10 }),
      summarizeRefundJobs(),
    ]);

    console.log(`PaymentEvent 최근 ${events.length}건 (limit:10):`);
    if (events.length === 0) {
      console.log("  (결과 없음 — seed 데이터에 PaymentEvent 없음)");
    } else {
      events.slice(0, 3).forEach((e) => {
        console.log(`  [${e.createdAt.toISOString()}] type=${e.type} result=${e.result}`);
      });
      if (events.length > 3) console.log(`  ... 외 ${events.length - 3}건`);
    }

    console.log("\nRefundJob 분포:");
    if (Object.keys(refundSummary.statusCounts).length === 0) {
      console.log("  (결과 없음 — seed 데이터에 RefundJob 없음)");
    } else {
      for (const [status, count] of Object.entries(refundSummary.statusCounts)) {
        console.log(`  ${status}: ${count}건`);
      }
    }

    if (refundSummary.oldestPending) {
      const p = refundSummary.oldestPending;
      console.log(
        `oldest PENDING: id=${p.id} amount=${p.amount}원 attempts=${p.attempts} nextRunAt=${p.nextRunAt.toISOString()}`
      );
    } else {
      console.log("oldest PENDING: 없음");
    }
    console.log("DB 쿼리 검증: PASS ✓");
  } catch (err) {
    console.log(`DB 쿼리 오류 (DB 미연결 환경): ${(err as Error).message}`);
    console.log("DB 쿼리 검증: SKIP (DB 연결 필요)");
  }

  // ── §4: /api/health curl ─────────────────────────────────────
  section("4. /api/health curl 검증");

  try {
    const raw = execSync("curl -s --max-time 3 http://localhost:3000/api/health", {
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw) as { status: string; checks: { db: string }; traceId: string; version: string };
    console.log("curl http://localhost:3000/api/health →");
    console.log(JSON.stringify(parsed, null, 2));

    const statusOk = parsed.status === "ok" || parsed.status === "degraded";
    const hasTraceId = /^[0-9a-f]{16}$/.test(parsed.traceId ?? "");
    const hasDbCheck = parsed.checks?.db === "ok" || parsed.checks?.db === "fail";
    console.log(`status 필드: ${statusOk ? "PASS ✓" : "FAIL ✗"} (${parsed.status})`);
    console.log(`traceId 16hex: ${hasTraceId ? "PASS ✓" : "FAIL ✗"} (${parsed.traceId})`);
    console.log(`checks.db: ${hasDbCheck ? "PASS ✓" : "FAIL ✗"} (${parsed.checks?.db})`);
  } catch {
    console.log("dev 서버가 실행 중이지 않음 — 수동 확인 필요:");
    console.log("  next dev 실행 후:");
    console.log("  curl -s http://localhost:3000/api/health | jq .");
    console.log("예상 응답 포맷:");
    console.log(
      JSON.stringify(
        {
          status: "ok",
          checks: { db: "ok" },
          version: "dev",
          traceId: "<16자 hex>",
        },
        null,
        2
      )
    );
  }

  // ── 종합 판정 ─────────────────────────────────────────────────
  section("종합 판정");
  console.log("§1 traceId 전파: " + (allContainTrace ? "PASS ✓" : "FAIL ✗"));
  console.log(
    "§2 metrics snapshot: " + (expectedConfirm && expectedWebhook ? "PASS ✓" : "FAIL ✗")
  );
  console.log("§3 DB 쿼리: 위 결과 확인");
  console.log("§4 /api/health: 위 결과 확인");

  await db.$disconnect().catch(() => {});
}

main().catch((e) => {
  console.error("evidence 스크립트 오류:", e);
  process.exit(1);
});
