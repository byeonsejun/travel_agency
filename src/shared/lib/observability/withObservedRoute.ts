/**
 * withObservedRoute — Next.js App Router route handler 관측 래퍼.
 *
 * Node runtime 전용 (AsyncLocalStorage 사용). middleware(Edge)에서 import 금지.
 *
 * 책임:
 *  1. x-trace-id 헤더 전파 (없으면 generateTraceId() 신규 발급)
 *  2. runWithContext로 ALS에 {traceId, routeName} 주입 → logger/captureException 자동 컨텍스트
 *  3. route.start / route.end + durationMs 로그
 *  4. 핸들러 throw → captureException(err, { routeName }) 후 재throw
 *  5. 응답 헤더에 x-trace-id 부착
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runWithContext } from "./context";
import { generateTraceId } from "./generateTraceId";
import { logger } from "./logger";
import { captureException } from "./errorTracker";

type RouteHandler = (
  req: NextRequest,
  ctx: { traceId: string }
) => Promise<NextResponse>;

export function withObservedRoute(
  routeName: string,
  handler: RouteHandler
): (req: NextRequest) => Promise<NextResponse> {
  return (req: NextRequest): Promise<NextResponse> => {
    const traceId = req.headers.get("x-trace-id") ?? generateTraceId();
    const startMs = Date.now();

    return runWithContext({ traceId, routeName }, async () => {
      logger.info("route.start", { method: req.method, url: req.nextUrl.pathname });

      let response: NextResponse;
      try {
        response = await handler(req, { traceId });
      } catch (err) {
        captureException(err, { routeName });
        logger.info("route.end", {
          method: req.method,
          url: req.nextUrl.pathname,
          durationMs: Date.now() - startMs,
          error: true,
        });
        throw err;
      }

      logger.info("route.end", {
        method: req.method,
        url: req.nextUrl.pathname,
        durationMs: Date.now() - startMs,
        status: response.status,
      });

      // 새 Headers 객체로 x-trace-id 부착 — Response 헤더 불변성 안전 처리
      const headers = new Headers(response.headers);
      headers.set("x-trace-id", traceId);
      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  };
}
