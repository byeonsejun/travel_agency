/**
 * Mock Toss Payments API server (local-only).
 *
 * 실제 Toss API 호출 없이 100% 자동화 테스트를 가능하게 한다.
 * `MOCK_TOSS_SCENARIO` 환경변수로 응답을 분기:
 *   - success        (기본)  : confirm 200 DONE, totalAmount = req.amount
 *   - amount-tamper          : confirm 200 DONE, totalAmount = req.amount + 1 (보상 cancel 트리거용)
 *   - network-error          : 5초 동안 응답 미반환 후 connection close (timeout 검증용)
 *   - fail                   : confirm 400 + { failure: { code: "INVALID_CARD" } }
 *
 * `--port` 옵션으로 포트 변경(기본 4242).
 *
 * 외부 의존 없음 — `node:http`만 사용. `npx tsx scripts/qa/mock-toss-server.ts`로 실행.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Scenario = "success" | "amount-tamper" | "network-error" | "fail";

function parseScenario(raw: string | undefined): Scenario {
  if (raw === "amount-tamper" || raw === "network-error" || raw === "fail") {
    return raw;
  }
  return "success";
}

function parsePort(argv: string[]): number {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  const envPort = Number(process.env.MOCK_TOSS_PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) return envPort;
  return 4242;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isoNow(): string {
  return new Date().toISOString();
}

const counts = {
  confirm: 0,
  cancel: 0,
  other: 0,
};

function handleConfirm(
  res: ServerResponse,
  body: Record<string, unknown>,
  scenario: Scenario
): void {
  counts.confirm += 1;

  const paymentKey = typeof body.paymentKey === "string" ? body.paymentKey : "mock_pk";
  const orderId = typeof body.orderId === "string" ? body.orderId : "mock_oid";
  const amountIn = typeof body.amount === "number" ? body.amount : 0;

  if (scenario === "fail") {
    send(res, 400, {
      code: "INVALID_CARD",
      message: "mock: 카드 정보가 올바르지 않습니다.",
      failure: { code: "INVALID_CARD", message: "mock: invalid card" },
    });
    return;
  }

  // network-error: 응답을 보내지 않고 5초 후 소켓 종료 → 클라이언트 timeout(8s)에서 잡힘
  if (scenario === "network-error") {
    setTimeout(() => {
      try {
        res.destroy(new Error("mock: forced connection close"));
      } catch {
        /* socket already closed */
      }
    }, 5_000);
    return;
  }

  const totalAmount = scenario === "amount-tamper" ? amountIn + 1 : amountIn;

  send(res, 200, {
    paymentKey,
    orderId,
    status: "DONE",
    totalAmount,
    approvedAt: isoNow(),
    receipt: { url: `https://mock.tosspayments.com/receipt/${paymentKey}` },
  });
}

function handleCancel(
  res: ServerResponse,
  paymentKey: string,
  body: Record<string, unknown>,
  scenario: Scenario
): void {
  counts.cancel += 1;

  if (scenario === "fail") {
    send(res, 400, {
      code: "ALREADY_CANCELED_PAYMENT",
      message: "mock: 이미 취소된 결제입니다.",
    });
    return;
  }

  if (scenario === "network-error") {
    setTimeout(() => {
      try {
        res.destroy(new Error("mock: forced connection close"));
      } catch {
        /* socket already closed */
      }
    }, 5_000);
    return;
  }

  const cancelAmount =
    typeof body.cancelAmount === "number" ? body.cancelAmount : 0;

  send(res, 200, {
    paymentKey,
    status: "CANCELED",
    cancels: [
      {
        cancelAmount,
        canceledAt: isoNow(),
        transactionKey: `mock_txn_${Date.now()}`,
      },
    ],
  });
}

const port = parsePort(process.argv);
const scenario = parseScenario(process.env.MOCK_TOSS_SCENARIO);

const server = createServer((req, res) => {
  // 모든 요청 로그(디버깅용, stderr로 분리하여 jq 파이프 오염 방지)
  process.stderr.write(`[mock-toss] ${req.method} ${req.url}\n`);

  if (req.method !== "POST") {
    counts.other += 1;
    return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
  }

  const url = req.url ?? "";

  readJsonBody(req)
    .then((body) => {
      if (url === "/v1/payments/confirm") {
        return handleConfirm(res, body, scenario);
      }

      const cancelMatch = url.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
      if (cancelMatch) {
        return handleCancel(res, cancelMatch[1]!, body, scenario);
      }

      counts.other += 1;
      send(res, 404, { code: "NOT_FOUND", path: url });
    })
    .catch((err: unknown) => {
      send(res, 400, { code: "BAD_REQUEST", message: String(err) });
    });
});

server.listen(port, () => {
  process.stderr.write(
    `[mock-toss] listening on http://localhost:${port} (scenario=${scenario})\n`
  );
});

function shutdown(reason: string): void {
  process.stderr.write(
    `[mock-toss] shutdown (${reason}) counts=${JSON.stringify(counts)}\n`
  );
  server.close(() => process.exit(0));
  // 안전장치: 1초 내 닫히지 않으면 강제 종료
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
