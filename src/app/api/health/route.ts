import { NextRequest, NextResponse } from "next/server";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { withObservedRoute, metrics } from "@/shared/lib/observability";


const DB_TIMEOUT_MS = 1_500;

export const GET = withObservedRoute(
  "health",
  async (_req: NextRequest, { traceId }: { traceId: string }): Promise<NextResponse> => {
    let dbStatus: "ok" | "fail" = "ok";

    try {
      await Promise.race([
        db.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB ping timeout")), DB_TIMEOUT_MS)
        ),
      ]);
    } catch {
      dbStatus = "fail";
    }

    if (dbStatus === "fail") {
      metrics.incr("health.db.fail");
      return NextResponse.json(
        {
          status: "degraded",
          checks: { db: "fail" },
          version: env.APP_VERSION ?? "dev",
          traceId,
        },
        { status: 503 }
      );
    }

    metrics.incr("health.ok");
    return NextResponse.json({
      status: "ok",
      checks: { db: "ok" },
      version: env.APP_VERSION ?? "dev",
      traceId,
    });
  }
);
