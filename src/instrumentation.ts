/**
 * instrumentation.ts — Next 15 표준 register() hook.
 *
 * 서버 cold start 1회 자동 호출. NEXT_RUNTIME 분기로 sentry.{server,edge}.config를
 * dynamic import하여 Edge 번들에 Node-only integration이 섞이지 않게 격리한다.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Next 15 표준 hook — request lifecycle 에러를 instrumentation으로 forwarding.
 * @sentry/nextjs가 자동 hook하지만, ALS context를 머지하기 위해 어댑터로 위임.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  ctx: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: string;
  },
): Promise<void> {
  const { captureException } = await import("@/shared/lib/observability");
  captureException(err, {
    routeName: ctx.routePath,
    extras: { method: request.method, routerKind: ctx.routerKind },
  });
}
